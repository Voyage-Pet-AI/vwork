import { parse } from "smol-toml";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { loadStoredGitHubToken } from "./auth/github.js";

export interface LLMConfig {
  provider: "anthropic" | "openai";
  model: string;
  api_key_env?: string;
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
  channels: string[];
}

export interface ReportConfig {
  lookback_days: number;
  output_dir: string;
  memory_depth: number;
}

export interface ChatConfig {
  report_postprocess_enabled: boolean;
  report_inbox_replay_limit: number;
}

export interface ComputerConfig {
  enabled: boolean;
  require_session_approval: boolean;
  max_steps: number;
  max_duration_sec: number;
  allow_domains: string[];
  block_domains: string[];
}

export interface MemoryConfig {
  enabled: boolean;
  embedding_model: string;
  api_key_env: string;
  db_path: string;
}

export interface Config {
  llm: LLMConfig;
  github: GitHubConfig;
  jira: JiraConfig;
  slack: SlackConfig;
  report: ReportConfig;
  chat: ChatConfig;
  computer: ComputerConfig;
  memory?: MemoryConfig;
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

  // Resolve ~ in memory.db_path
  if (parsed.memory?.db_path?.startsWith("~")) {
    parsed.memory.db_path = parsed.memory.db_path.replace("~", homedir());
  }

  if (!parsed.chat) {
    parsed.chat = {
      report_postprocess_enabled: false,
      report_inbox_replay_limit: 20,
    };
  } else {
    parsed.chat.report_postprocess_enabled = Boolean(parsed.chat.report_postprocess_enabled);
    parsed.chat.report_inbox_replay_limit = Number.isFinite(parsed.chat.report_inbox_replay_limit)
      ? Math.max(1, Math.floor(parsed.chat.report_inbox_replay_limit))
      : 20;
  }

  if (!parsed.computer) {
    parsed.computer = {
      enabled: true,
      require_session_approval: true,
      max_steps: 150,
      max_duration_sec: 900,
      allow_domains: [],
      block_domains: [],
    };
  } else {
    parsed.computer.enabled = parsed.computer.enabled !== false;
    parsed.computer.require_session_approval =
      parsed.computer.require_session_approval !== false;
    parsed.computer.max_steps = Number.isFinite(parsed.computer.max_steps)
      ? Math.max(1, Math.floor(parsed.computer.max_steps))
      : 150;
    parsed.computer.max_duration_sec = Number.isFinite(parsed.computer.max_duration_sec)
      ? Math.max(10, Math.floor(parsed.computer.max_duration_sec))
      : 900;
    parsed.computer.allow_domains = Array.isArray(parsed.computer.allow_domains)
      ? parsed.computer.allow_domains.map(String)
      : [];
    parsed.computer.block_domains = Array.isArray(parsed.computer.block_domains)
      ? parsed.computer.block_domains.map(String)
      : [];
  }

  return parsed;
}

const DEFAULT_CONFIG = `[llm]
provider = "anthropic"
model = "claude-sonnet-4-5-20250929"
# Auth: run "reporter login anthropic" for browser-based OAuth (recommended)
# Or set an API key — env var name like "ANTHROPIC_API_KEY" or the key directly
# api_key_env = "ANTHROPIC_API_KEY"
#
# To use OpenAI instead:
# provider = "openai"
# model = "gpt-4o"
# Auth: run "reporter login openai" for ChatGPT Pro/Plus OAuth (free via Codex)
# Or set: api_key_env = "OPENAI_API_KEY"

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
# Auth: run "reporter auth slack" to paste your Bot User OAuth Token (recommended)
# Or set a token manually — env var name like "SLACK_BOT_TOKEN" or the token directly
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

[chat]
# Optional second-pass summary after report subagent output
report_postprocess_enabled = false
# Number of unread scheduled-run lifecycle messages to replay when chat starts
report_inbox_replay_limit = 20

[computer]
# Enable the browser-use computer subagent
enabled = true
# Require one explicit approval in chat before a computer session starts
require_session_approval = true
# Hard cap for number of browser actions per task
max_steps = 150
# Hard cap for wall-clock session duration in seconds
max_duration_sec = 900
# Optional allow/block domain controls (supports exact domains and *.wildcards)
allow_domains = []
block_domains = []

# [memory]
# Semantic memory — uses vector search to find relevant past reports and notes
# enabled = true
# embedding_model = "voyage-3.5-lite"
# api_key_env = "VOYAGE_API_KEY"
# db_path = "~/reporter/memory.db"
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

export interface SlackInitConfig {
  channels: string[];
}

export function initConfig(): string {
  mkdirSync(REPORTER_DIR, { recursive: true });
  mkdirSync(join(REPORTER_DIR, "reports"), { recursive: true });
  mkdirSync(join(REPORTER_DIR, "auth"), { recursive: true });

  if (existsSync(CONFIG_PATH)) {
    return `Config already exists at ${CONFIG_PATH}`;
  }

  writeFileSync(CONFIG_PATH, DEFAULT_CONFIG);
  return `Config created at ${CONFIG_PATH}\nEdit it to add your API keys and preferences.`;
}

export function updateSlackConfig(slack: SlackInitConfig): void {
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const channelsStr = JSON.stringify(slack.channels);
  const updated = raw.replace(
    /\[slack\][\s\S]*?(?=\n\[|$)/,
    `[slack]\nenabled = true\nchannels = ${channelsStr}\n`
  );
  writeFileSync(CONFIG_PATH, updated);
}
