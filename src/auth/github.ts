import { readFileSync, writeFileSync, unlinkSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { getVworkDir } from "../config.js";
import { log } from "../utils/log.js";

// GitHub OAuth App client ID (public — no secret needed for device flow)
const CLIENT_ID = "Ov23liYMgQyQCfTxPdOp";
const SCOPES = "repo read:org";

const TOKEN_FILE = () => join(getVworkDir(), "github_token.json");

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
}

interface StoredToken {
  access_token: string;
  created_at: string;
}

/**
 * Full GitHub OAuth Device Flow:
 * 1. Request device code
 * 2. Show user code + open browser
 * 3. Poll for token
 * 4. Store token
 * 5. Validate and print username
 */
export async function loginGitHub(): Promise<void> {
  log("Starting GitHub OAuth login...");

  // Step 1: Request device code
  const deviceRes = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPES }),
  });

  if (!deviceRes.ok) {
    throw new Error(`Failed to start device flow: ${deviceRes.status} ${deviceRes.statusText}`);
  }

  const device: DeviceCodeResponse = await deviceRes.json();

  // Step 2: Show user code and open browser
  process.stderr.write(`\nOpen this URL in your browser:\n\n  ${device.verification_uri}\n\n`);
  process.stderr.write(`Enter code: ${device.user_code}\n\n`);

  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  Bun.spawn([opener, device.verification_uri], { stdio: ["ignore", "ignore", "ignore"] });

  log("Waiting for authorization...");

  // Step 3: Poll for token
  let interval = device.interval * 1000; // convert to ms
  const deadline = Date.now() + device.expires_in * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data: TokenResponse = await tokenRes.json();

    if (data.access_token) {
      // Step 4: Store token
      const stored: StoredToken = {
        access_token: data.access_token,
        created_at: new Date().toISOString(),
      };
      const tokenPath = TOKEN_FILE();
      writeFileSync(tokenPath, JSON.stringify(stored, null, 2));
      chmodSync(tokenPath, 0o600);

      // Step 5: Validate
      const userRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });

      if (userRes.ok) {
        const user = (await userRes.json()) as { login: string };
        log(`Authenticated as ${user.login}`);
      } else {
        log("Token stored (could not verify username)");
      }
      return;
    }

    switch (data.error) {
      case "authorization_pending":
        // Keep polling
        break;
      case "slow_down":
        interval += 5000;
        break;
      case "expired_token":
        throw new Error("Device code expired. Please try again.");
      case "access_denied":
        throw new Error("Authorization denied by user.");
      default:
        throw new Error(`Unexpected error: ${data.error}`);
    }
  }

  throw new Error("Device code expired. Please try again.");
}

/**
 * Read stored OAuth token from disk.
 * Returns undefined if missing or corrupt.
 */
export function loadStoredGitHubToken(): string | undefined {
  const tokenPath = TOKEN_FILE();
  if (!existsSync(tokenPath)) return undefined;

  try {
    const raw = readFileSync(tokenPath, "utf-8");
    const stored: StoredToken = JSON.parse(raw);
    return stored.access_token || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Delete stored OAuth token.
 */
export function logoutGitHub(): void {
  const tokenPath = TOKEN_FILE();
  if (existsSync(tokenPath)) {
    unlinkSync(tokenPath);
    log("GitHub token removed.");
  } else {
    log("No stored GitHub token found.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
