import { loadTokens, saveTokens, getSlackToken } from "./tokens.js";
import type { SlackTokenData } from "./tokens.js";
import { log, error } from "../utils/log.js";
import { readLine } from "../utils/readline.js";

/** Returns true if a Slack token is stored. */
export function hasSlackAuth(): boolean {
  return !!getSlackToken();
}

/** Remove stored Slack token. */
export function logoutSlack(): void {
  const store = loadTokens();
  if (!store.slack) {
    log("No stored Slack token found.");
    return;
  }
  delete store.slack;
  saveTokens(store);
  log("Slack token removed.");
}

/** Validate a Slack bot token by calling auth.test. Returns team/user info. */
export async function validateSlackToken(token: string): Promise<{ team: string; user: string; teamId: string }> {
  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    team?: string;
    team_id?: string;
    user?: string;
  };

  if (!data.ok) {
    throw new Error(`Slack auth.test failed: ${data.error ?? "unknown error"}`);
  }

  return {
    team: data.team ?? "unknown",
    user: data.user ?? "unknown",
    teamId: data.team_id ?? "unknown",
  };
}

/**
 * Prompt the user to paste their Slack Bot User OAuth Token.
 * Validates the token format and saves it to ~/reporter/tokens.json.
 */
export async function promptSlackToken(): Promise<void> {
  printSlackSetupGuide();

  process.stderr.write("  Paste your Bot User OAuth Token (xoxb-...): ");
  const token = (await readLine()).trim();

  if (!token) {
    error("No token provided. Skipping Slack auth.");
    return;
  }

  if (!token.startsWith("xoxb-")) {
    error(
      `Token should start with "xoxb-". Got "${token.slice(0, 8)}..."\n` +
      `  Make sure you copy the "Bot User OAuth Token", not the signing secret.`
    );
    return;
  }

  const tokenData: SlackTokenData = {
    access_token: token,
    token_type: "bot",
    scope: "",
    team: { id: "unknown", name: "unknown" },
    obtained_at: new Date().toISOString(),
  };

  // Validate token and backfill team metadata
  try {
    const info = await validateSlackToken(token);
    tokenData.team = { id: info.teamId, name: info.team };
    log(`Authenticated as "${info.user}" in workspace "${info.team}"`);
  } catch (e) {
    error(`Token validation failed: ${e instanceof Error ? e.message : e}`);
    error("Saving token anyway — you can re-auth later if needed.");
  }

  const store = loadTokens();
  store.slack = tokenData;
  saveTokens(store);

  log("Slack token saved.");
}

const SLACK_APP_MANIFEST = {
  display_information: {
    name: "Reporter",
    description: "AI-powered work reporting assistant",
  },
  features: {
    bot_user: {
      display_name: "reporter",
      always_online: false,
    },
  },
  oauth_config: {
    scopes: {
      bot: ["channels:history", "channels:read", "users:read", "search:read"],
    },
  },
  settings: {
    org_deploy_enabled: false,
    socket_mode_enabled: false,
  },
};

function getManifestUrl(): string {
  const encoded = encodeURIComponent(JSON.stringify(SLACK_APP_MANIFEST));
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encoded}`;
}

function printSlackSetupGuide() {
  const manifestUrl = getManifestUrl();
  const manifestJson = JSON.stringify(SLACK_APP_MANIFEST, null, 2);

  console.error(
    `\n  To set up Slack:\n\n` +
    `  Option A — Create app with one click (recommended):\n` +
    `  Open this URL to create a pre-configured Slack app:\n\n` +
    `  ${manifestUrl}\n\n` +
    `  Option B — Create app manually with manifest:\n` +
    `  1. Go to https://api.slack.com/apps → "Create New App" → "From an app manifest"\n` +
    `  2. Select your workspace, switch to JSON, and paste:\n\n` +
    manifestJson.split("\n").map((l) => `     ${l}`).join("\n") + `\n\n` +
    `  Then:\n` +
    `  1. Select your workspace and click "Create"\n` +
    `  2. Click "Install to Workspace" and approve the permissions\n` +
    `  3. Go to "OAuth & Permissions" and copy the "Bot User OAuth Token" (starts with xoxb-)\n`
  );
}
