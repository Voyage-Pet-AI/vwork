import { readFileSync, writeFileSync, unlinkSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { getReporterDir } from "../config.js";
import { log, error } from "../utils/log.js";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const AUTHORIZE_URL = `${ISSUER}/oauth/authorize`;
const TOKEN_URL = `${ISSUER}/oauth/token`;
const DEVICE_AUTH_URL = `${ISSUER}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${ISSUER}/api/accounts/deviceauth/token`;
const DEVICE_LOGIN_URL = `${ISSUER}/codex/device`;

const CALLBACK_PORT = 1455;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`;

const OAUTH_FILE = () => join(getReporterDir(), "auth", "openai-oauth.json");

// --- PKCE ---

interface PKCE {
  verifier: string;
  challenge: string;
}

async function generatePKCE(): Promise<PKCE> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = base64url(bytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(digest));
  return { verifier, challenge };
}

function base64url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

// --- Storage ---

interface StoredOpenAIOAuth {
  access_token: string;
  refresh_token: string;
  account_id: string;
  expires_at: number; // epoch ms
  created_at: string;
}

// --- JWT decode (minimal, no verification) ---

function decodeJWTPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2) return {};
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

function extractAccountId(idToken: string): string {
  const claims = decodeJWTPayload(idToken);
  // Try direct claim first
  if (typeof claims.chatgpt_account_id === "string") {
    return claims.chatgpt_account_id;
  }
  // Try nested under https://api.openai.com/auth
  const auth = claims["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
  if (auth && typeof auth.chatgpt_account_id === "string") {
    return auth.chatgpt_account_id;
  }
  // Fallback — use first org account if available
  const orgs = (auth?.organizations ?? claims.organizations) as Array<{ id: string }> | undefined;
  if (orgs && orgs.length > 0) {
    return orgs[0].id;
  }
  return "";
}

// --- Browser OAuth (PKCE) ---

async function loginBrowser(): Promise<StoredOpenAIOAuth> {
  const { verifier, challenge } = await generatePKCE();
  const state = randomState();

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", "openid profile email offline_access");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("id_token_add_organizations", "true");
  authUrl.searchParams.set("originator", "reporter");

  // Wait for callback via local server
  const codePromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.stop();
      reject(new Error("OAuth callback timed out after 120s"));
    }, 120_000);

    const server = Bun.serve({
      port: CALLBACK_PORT,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/auth/callback") {
          return new Response("Not found", { status: 404 });
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const err = url.searchParams.get("error");

        if (err) {
          clearTimeout(timeout);
          server.stop();
          reject(new Error(`OAuth error: ${err}`));
          return new Response(
            "<html><body><h2>Authentication failed</h2><p>You can close this tab.</p></body></html>",
            { headers: { "Content-Type": "text/html" } }
          );
        }

        if (!code || returnedState !== state) {
          clearTimeout(timeout);
          server.stop();
          reject(new Error("Invalid callback: missing code or state mismatch"));
          return new Response(
            "<html><body><h2>Authentication failed</h2><p>Invalid callback.</p></body></html>",
            { headers: { "Content-Type": "text/html" } }
          );
        }

        clearTimeout(timeout);
        server.stop();
        resolve(code);
        return new Response(
          "<html><body><h2>Authenticated!</h2><p>You can close this tab and return to Reporter.</p></body></html>",
          { headers: { "Content-Type": "text/html" } }
        );
      },
    });
  });

  // Open browser
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  Bun.spawn([opener, authUrl.toString()], { stdio: ["ignore", "ignore", "ignore"] });
  log("Opening browser for OpenAI authorization...");

  const code = await codePromise;

  // Exchange code for tokens
  log("Exchanging authorization code...");
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`);
  }

  const tokenData = await tokenRes.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    id_token?: string;
  };

  const accountId = tokenData.id_token ? extractAccountId(tokenData.id_token) : "";

  return {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    account_id: accountId,
    expires_at: Date.now() + tokenData.expires_in * 1000,
    created_at: new Date().toISOString(),
  };
}

// --- Device flow (headless/SSH) ---

async function loginDevice(): Promise<StoredOpenAIOAuth> {
  log("Starting device code flow...");

  const deviceRes = await fetch(DEVICE_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });

  if (!deviceRes.ok) {
    const body = await deviceRes.text();
    throw new Error(`Device auth request failed (${deviceRes.status}): ${body}`);
  }

  const deviceData = await deviceRes.json() as {
    device_auth_id: string;
    user_code: string;
    interval: number;
  };

  process.stderr.write(`\nYour code: ${deviceData.user_code}\n`);
  process.stderr.write(`Visit: ${DEVICE_LOGIN_URL}\n`);
  process.stderr.write("Waiting for authorization...\n");

  // Try to open browser
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  Bun.spawn([opener, DEVICE_LOGIN_URL], { stdio: ["ignore", "ignore", "ignore"] });

  // Poll for token
  const interval = (deviceData.interval || 5) * 1000;
  const maxAttempts = 120_000 / interval; // 2 min timeout

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, interval));

    const pollRes = await fetch(DEVICE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_auth_id: deviceData.device_auth_id,
        user_code: deviceData.user_code,
      }),
    });

    if (!pollRes.ok) {
      // Still pending — keep polling
      continue;
    }

    const pollData = await pollRes.json() as {
      authorization_code?: string;
      code_verifier?: string;
      error?: string;
    };

    if (pollData.error) continue;

    if (!pollData.authorization_code || !pollData.code_verifier) continue;

    // Exchange for tokens
    log("Device authorized. Exchanging code...");
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code: pollData.authorization_code,
        code_verifier: pollData.code_verifier,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`);
    }

    const tokenData = await tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      id_token?: string;
    };

    const accountId = tokenData.id_token ? extractAccountId(tokenData.id_token) : "";

    return {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      account_id: accountId,
      expires_at: Date.now() + tokenData.expires_in * 1000,
      created_at: new Date().toISOString(),
    };
  }

  throw new Error("Device authorization timed out.");
}

// --- Public API ---

export async function loginOpenAI(): Promise<void> {
  log("Starting OpenAI OAuth login...");

  // Detect headless — no TTY or SSH without display
  const isHeadless = !process.stdin.isTTY || (!!process.env.SSH_CLIENT && !process.env.DISPLAY);
  const stored = isHeadless ? await loginDevice() : await loginBrowser();

  const oauthPath = OAUTH_FILE();
  writeFileSync(oauthPath, JSON.stringify(stored, null, 2));
  chmodSync(oauthPath, 0o600);

  log("OpenAI OAuth tokens stored.");
}

export function logoutOpenAI(): void {
  const oauthPath = OAUTH_FILE();
  if (existsSync(oauthPath)) {
    unlinkSync(oauthPath);
    log("OpenAI auth tokens removed.");
  } else {
    log("No stored OpenAI tokens found.");
  }
}

export function hasOpenAIAuth(): { mode: "oauth" | "none" } {
  if (loadStoredOpenAIAuth()) return { mode: "oauth" };
  return { mode: "none" };
}

export function loadStoredOpenAIAuth(): StoredOpenAIOAuth | undefined {
  const oauthPath = OAUTH_FILE();
  if (!existsSync(oauthPath)) return undefined;
  try {
    const raw = readFileSync(oauthPath, "utf-8");
    return JSON.parse(raw) as StoredOpenAIOAuth;
  } catch {
    return undefined;
  }
}

export async function refreshOpenAIToken(): Promise<StoredOpenAIOAuth | undefined> {
  const stored = loadStoredOpenAIAuth();
  if (!stored) return undefined;

  // Refresh if within 5 minutes of expiry
  const BUFFER_MS = 5 * 60 * 1000;
  if (Date.now() < stored.expires_at - BUFFER_MS) {
    return stored;
  }

  log("Refreshing OpenAI OAuth token...");
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: stored.refresh_token,
    }),
  });

  if (!tokenRes.ok) {
    error(`Token refresh failed (${tokenRes.status}). Run "reporter login openai" again.`);
    return undefined;
  }

  const tokenData = await tokenRes.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const updated: StoredOpenAIOAuth = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    account_id: stored.account_id,
    expires_at: Date.now() + tokenData.expires_in * 1000,
    created_at: stored.created_at,
  };
  const oauthPath = OAUTH_FILE();
  writeFileSync(oauthPath, JSON.stringify(updated, null, 2));
  chmodSync(oauthPath, 0o600);

  return updated;
}
