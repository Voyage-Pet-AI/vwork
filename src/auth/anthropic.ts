import { readFileSync, writeFileSync, unlinkSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { getReporterDir } from "../config.js";
import { readLine } from "../utils/readline.js";
import { log, error } from "../utils/log.js";

// Same client ID as Claude CLI
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

// URLs matching Claude Code's current production config
const CONSOLE_AUTHORIZE_URL = "https://platform.claude.com/oauth/authorize";
const MANUAL_REDIRECT_URL = "https://platform.claude.com/oauth/code/callback";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const API_KEY_URL = "https://api.anthropic.com/api/oauth/claude_cli/create_api_key";

const KEY_FILE = () => join(getReporterDir(), "auth", "anthropic-key.json");
const OAUTH_FILE = () => join(getReporterDir(), "auth", "anthropic-oauth.json");

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

// --- Storage types ---

interface StoredApiKey {
  api_key: string;
  created_at: string;
}

interface StoredOAuth {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  created_at: string;
}

// --- Split login: URL generation + code exchange ---

export interface AnthropicLoginHandle {
  authUrl: string;
  complete: (rawCode: string) => Promise<void>;
}

export async function startAnthropicLogin(): Promise<AnthropicLoginHandle> {
  const { verifier, challenge } = await generatePKCE();
  const state = randomState();

  const authUrl = new URL(CONSOLE_AUTHORIZE_URL);
  authUrl.searchParams.set("code", "true");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", MANUAL_REDIRECT_URL);
  authUrl.searchParams.set("scope", "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  return {
    authUrl: authUrl.toString(),
    complete: async (rawCode: string) => {
      // Anthropic returns code#state — split if present
      const code = rawCode.split("#")[0];

      // Exchange code for token
      log("Exchanging authorization code...");
      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          code,
          redirect_uri: MANUAL_REDIRECT_URL,
          code_verifier: verifier,
          state,
        }),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`);
      }

      const tokenData = await tokenRes.json() as { access_token: string };

      // Create a permanent API key
      log("Creating API key...");
      const keyRes = await fetch(API_KEY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "reporter-cli" }),
      });

      if (!keyRes.ok) {
        const body = await keyRes.text();
        throw new Error(`API key creation failed (${keyRes.status}): ${body}`);
      }

      const keyData = await keyRes.json() as { api_key: string };

      // Store key
      const stored: StoredApiKey = {
        api_key: keyData.api_key,
        created_at: new Date().toISOString(),
      };
      const keyPath = KEY_FILE();
      writeFileSync(keyPath, JSON.stringify(stored, null, 2));
      chmodSync(keyPath, 0o600);

      log("Anthropic API key created and stored.");
    },
  };
}

// --- OAuth → API Key flow (platform.claude.com) ---

export async function loginAnthropicApiKey(): Promise<void> {
  log("Starting Anthropic OAuth login (API key)...");

  const handle = await startAnthropicLogin();

  process.stderr.write(`\nVisit this URL to authorize:\n  ${handle.authUrl}\n\n`);
  process.stderr.write(
    "After clicking Authorize, copy the code from the browser and paste it here: "
  );
  const rawCode = (await readLine()).trim();
  if (!rawCode) {
    throw new Error("No authorization code provided.");
  }

  await handle.complete(rawCode);
}

// --- Token refresh ---

export async function refreshAnthropicOAuth(): Promise<string | undefined> {
  const stored = loadStoredAnthropicOAuth();
  if (!stored) return undefined;

  // Refresh if within 5 minutes of expiry
  const BUFFER_MS = 5 * 60 * 1000;
  if (Date.now() < stored.expires_at - BUFFER_MS) {
    return stored.access_token;
  }

  log("Refreshing Anthropic OAuth token...");
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
    error(`Token refresh failed (${tokenRes.status}). Run "reporter login anthropic" again.`);
    return undefined;
  }

  const tokenData = await tokenRes.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const updated: StoredOAuth = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: Date.now() + tokenData.expires_in * 1000,
    created_at: stored.created_at,
  };
  const oauthPath = OAUTH_FILE();
  writeFileSync(oauthPath, JSON.stringify(updated, null, 2));
  chmodSync(oauthPath, 0o600);

  return tokenData.access_token;
}

// --- Load / check helpers ---

export function loadStoredAnthropicKey(): string | undefined {
  const keyPath = KEY_FILE();
  if (!existsSync(keyPath)) return undefined;
  try {
    const raw = readFileSync(keyPath, "utf-8");
    const stored: StoredApiKey = JSON.parse(raw);
    return stored.api_key || undefined;
  } catch {
    return undefined;
  }
}

export function loadStoredAnthropicOAuth(): StoredOAuth | undefined {
  const oauthPath = OAUTH_FILE();
  if (!existsSync(oauthPath)) return undefined;
  try {
    const raw = readFileSync(oauthPath, "utf-8");
    return JSON.parse(raw) as StoredOAuth;
  } catch {
    return undefined;
  }
}

export function logoutAnthropic(): void {
  let removed = false;
  const keyPath = KEY_FILE();
  if (existsSync(keyPath)) {
    unlinkSync(keyPath);
    removed = true;
  }
  const oauthPath = OAUTH_FILE();
  if (existsSync(oauthPath)) {
    unlinkSync(oauthPath);
    removed = true;
  }
  if (removed) {
    log("Anthropic auth tokens removed.");
  } else {
    log("No stored Anthropic tokens found.");
  }
}

export function hasAnthropicAuth(): { mode: "oauth" | "key" | "config" | "none" } {
  if (loadStoredAnthropicOAuth()) return { mode: "oauth" };
  if (loadStoredAnthropicKey()) return { mode: "key" };
  return { mode: "none" };
}
