import { parse } from "smol-toml";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { loadStoredGitHubToken } from "./auth/github.js";

export interface LLMConfig {
  provider: "anthropic";
  model: string;
  api_key_env: string;
}

export interface GitHubConfig {
  enabled: boolean;
  token_env?: string;
  orgs: string[];
}

export interface JiraConfig {
  enabled: boolean;
  url: string;
}

export interface SlackConfig {
  enabled: boolean;
  token_env?: string;
  client_id?: string;
  client_secret_env?: string;
  channels: string[];
}

export interface ReportConfig {
  lookback_days: number;
  output_dir: string;
  memory_depth: number;
}

export interface Config {
  llm: LLMConfig;
  github: GitHubConfig;
  jira: JiraConfig;
  slack: SlackConfig;
  report: ReportConfig;
}

const REPORTER_DIR = join(homedir(), "reporter");
const CONFIG_PATH = join(REPORTER_DIR, "config.toml");

export function getReporterDir(): string {
  return REPORTER_DIR;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `Config not found at ${CONFIG_PATH}. Run "reporter init" first.`
    );
  }

  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const parsed = parse(raw) as unknown as Config;

  // Resolve ~ in output_dir
  if (parsed.report?.output_dir?.startsWith("~")) {
    parsed.report.output_dir = parsed.report.output_dir.replace(
      "~",
      homedir()
    );
  }

  return parsed;
}

const DEFAULT_CONFIG = `[llm]
provider = "anthropic"
model = "claude-sonnet-4-5-20250929"
# Anthropic API key — env var name like "ANTHROPIC_API_KEY" or the key directly
api_key_env = "ANTHROPIC_API_KEY"

[github]
enabled = true
# Auth: run "reporter login github" for browser-based OAuth (recommended)
# Or set a token manually — env var name like "GITHUB_TOKEN" or the token directly
# token_env = "GITHUB_TOKEN"
# GitHub orgs to pull activity from, e.g. ["my-company", "my-oss-org"]
orgs = []

[jira]
enabled = false
# Run "reporter auth login" before enabling
url = "https://mcp.atlassian.com/v1/mcp"

[slack]
enabled = false
# Option 1 (recommended): OAuth — run "reporter auth slack" for browser-based login
# client_id = "your-slack-app-client-id"
# client_secret_env = "SLACK_CLIENT_SECRET"
# Option 2: Manual token — env var name like "SLACK_BOT_TOKEN" or the token directly
# token_env = "SLACK_BOT_TOKEN"
# Slack channels to read messages from, e.g. ["#engineering", "#standup"]
channels = []

[report]
# How many days back to look for activity (1 = daily, 7 = weekly)
lookback_days = 1
# Where to save generated reports
output_dir = "~/reporter/reports"
# Number of past reports to include as context for continuity
memory_depth = 5
`;

/**
 * Resolve a secret value: if it looks like an env var name (all caps, underscores),
 * look it up in process.env. Otherwise treat it as the literal secret value.
 */
export function resolveSecret(value: string): string | undefined {
  if (/^[A-Z_][A-Z0-9_]*$/.test(value)) {
    return process.env[value];
  }
  return value;
}

/**
 * Resolve GitHub token with precedence:
 * 1. OAuth stored token (from `reporter login github`)
 * 2. token_env (env var name or literal token from config)
 * 3. undefined
 */
export function resolveGitHubToken(config: Config): string | undefined {
  const oauthToken = loadStoredGitHubToken();
  if (oauthToken) return oauthToken;

  if (config.github.token_env) {
    return resolveSecret(config.github.token_env);
  }

  return undefined;
}

export interface SlackOAuthInit {
  client_id: string;
  client_secret_env: string;
  channels: string[];
}

export function initConfig(slackOAuth?: SlackOAuthInit): string {
  mkdirSync(REPORTER_DIR, { recursive: true });
  mkdirSync(join(REPORTER_DIR, "reports"), { recursive: true });
  mkdirSync(join(REPORTER_DIR, "auth"), { recursive: true });

  if (existsSync(CONFIG_PATH)) {
    return `Config already exists at ${CONFIG_PATH}`;
  }

  let config = DEFAULT_CONFIG;
  if (slackOAuth) {
    const channelsStr = JSON.stringify(slackOAuth.channels);
    config = config.replace(
      /\[slack\][\s\S]*?\n\n/,
      `[slack]\nenabled = true\nclient_id = "${slackOAuth.client_id}"\nclient_secret_env = "${slackOAuth.client_secret_env}"\nchannels = ${channelsStr}\n\n`
    );
  }

  writeFileSync(CONFIG_PATH, config);
  return `Config created at ${CONFIG_PATH}\nEdit it to add your API keys and preferences.`;
}

export function updateSlackConfig(slack: SlackOAuthInit): void {
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const channelsStr = JSON.stringify(slack.channels);
  const updated = raw.replace(
    /\[slack\][\s\S]*?(?=\n\[|$)/,
    `[slack]\nenabled = true\nclient_id = "${slack.client_id}"\nclient_secret_env = "${slack.client_secret_env}"\nchannels = ${channelsStr}\n`
  );
  writeFileSync(CONFIG_PATH, updated);
}
