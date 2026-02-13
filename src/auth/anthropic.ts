import { readFileSync, writeFileSync, unlinkSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { getReporterDir } from "../config.js";
import { readLine } from "../utils/readline.js";
import { log, error } from "../utils/log.js";

// Same client ID as Claude CLI
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

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

// --- OAuth → API Key flow (console.anthropic.com) ---

export async function loginAnthropicApiKey(): Promise<void> {
  log("Starting Anthropic OAuth login (API key)...");

  const { verifier, challenge } = await generatePKCE();
  const state = randomState();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: "https://console.anthropic.com/oauth/code/callback",
    scope: "org:create_api_key",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const authUrl = `https://console.anthropic.com/oauth/authorize?${params}`;

  process.stderr.write(`\nOpening browser for Anthropic authorization...\n`);
  process.stderr.write(`If it doesn't open, visit:\n  ${authUrl}\n\n`);

  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  Bun.spawn([opener, authUrl], { stdio: ["ignore", "ignore", "ignore"] });

  process.stderr.write("Paste the authorization code from the browser: ");
  const code = (await readLine()).trim();
  if (!code) {
    throw new Error("No authorization code provided.");
  }

  // Exchange code for token
  log("Exchanging authorization code...");
  const tokenRes = await fetch("https://console.anthropic.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: "https://console.anthropic.com/oauth/code/callback",
      code_verifier: verifier,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`);
  }

  const tokenData = await tokenRes.json() as { access_token: string };

  // Create a permanent API key
  log("Creating API key...");
  const keyRes = await fetch("https://api.anthropic.com/api/oauth/claude_cli/create_api_key", {
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
}

// --- Pro/Max OAuth flow (claude.ai) ---

export async function loginAnthropicMax(): Promise<void> {
  log("Starting Anthropic Pro/Max OAuth login...");

  const { verifier, challenge } = await generatePKCE();
  const state = randomState();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: "https://console.anthropic.com/oauth/code/callback",
    scope: "user:inference user:profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const authUrl = `https://claude.ai/oauth/authorize?${params}`;

  process.stderr.write(`\nOpening browser for Anthropic Pro/Max authorization...\n`);
  process.stderr.write(`If it doesn't open, visit:\n  ${authUrl}\n\n`);

  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  Bun.spawn([opener, authUrl], { stdio: ["ignore", "ignore", "ignore"] });

  process.stderr.write("Paste the authorization code from the browser: ");
  const code = (await readLine()).trim();
  if (!code) {
    throw new Error("No authorization code provided.");
  }

  // Exchange code for tokens
  log("Exchanging authorization code...");
  const tokenRes = await fetch("https://claude.ai/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: "https://console.anthropic.com/oauth/code/callback",
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
  };

  // Store tokens
  const stored: StoredOAuth = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: Date.now() + tokenData.expires_in * 1000,
    created_at: new Date().toISOString(),
  };
  const oauthPath = OAUTH_FILE();
  writeFileSync(oauthPath, JSON.stringify(stored, null, 2));
  chmodSync(oauthPath, 0o600);

  log("Anthropic Pro/Max OAuth tokens stored.");
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
  const tokenRes = await fetch("https://claude.ai/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: stored.refresh_token,
    }),
  });

  if (!tokenRes.ok) {
    error(`Token refresh failed (${tokenRes.status}). Run "reporter login anthropic --max" again.`);
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
