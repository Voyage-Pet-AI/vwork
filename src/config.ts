import { parse } from "smol-toml";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface LLMConfig {
  provider: "anthropic";
  model: string;
  api_key_env: string;
}

export interface GitHubConfig {
  enabled: boolean;
  token_env: string;
  orgs: string[];
}

export interface JiraConfig {
  enabled: boolean;
  url: string;
}

export interface SlackConfig {
  enabled: boolean;
  token_env: string;
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

const REPORTER_DIR = join(homedir(), ".reporter");
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
# Environment variable name that holds your Anthropic API key
api_key_env = "ANTHROPIC_API_KEY"

[github]
enabled = true
# Environment variable name that holds your GitHub personal access token
token_env = "GITHUB_TOKEN"
# GitHub orgs to pull activity from, e.g. ["my-company", "my-oss-org"]
orgs = []

[jira]
enabled = false
# Atlassian MCP endpoint (uses OAuth, browser login on first run)
url = "https://mcp.atlassian.com/v1/mcp"

[slack]
enabled = false
# Environment variable name that holds your Slack bot token
token_env = "SLACK_BOT_TOKEN"
# Slack channels to read messages from, e.g. ["#engineering", "#standup"]
channels = []

[report]
# How many days back to look for activity (1 = daily, 7 = weekly)
lookback_days = 1
# Where to save generated reports
output_dir = "~/.reporter/reports"
# Number of past reports to include as context for continuity
memory_depth = 5
`;

export function initConfig(): string {
  mkdirSync(REPORTER_DIR, { recursive: true });
  mkdirSync(join(REPORTER_DIR, "reports"), { recursive: true });

  if (existsSync(CONFIG_PATH)) {
    return `Config already exists at ${CONFIG_PATH}`;
  }

  writeFileSync(CONFIG_PATH, DEFAULT_CONFIG);
  return `Config created at ${CONFIG_PATH}\nEdit it to add your API keys and preferences.`;
}
