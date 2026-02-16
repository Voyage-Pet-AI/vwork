import type { Config } from "../config.js";
import { resolveSecret, resolveGitHubToken } from "../config.js";
import { getSlackToken } from "../auth/tokens.js";
import { hasAtlassianAuth } from "../auth/atlassian.js";

export interface StdioServerEntry {
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface HttpServerEntry {
  name: string;
  transport: "http";
  url: string;
  auth?: "atlassian";
  headers?: Record<string, string>;
}

export type ServerEntry = StdioServerEntry | HttpServerEntry;

export function getEnabledServers(config: Config): ServerEntry[] {
  const servers: ServerEntry[] = [];

  if (config.github.enabled) {
    const token = resolveGitHubToken(config);
    if (!token) {
      throw new Error(
        `GitHub enabled but token not configured — run "vwork login github" or set token_env in config`
      );
    }
    servers.push({
      name: "github",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: token },
    });
  }

  if (config.jira.enabled) {
    if (!hasAtlassianAuth()) {
      throw new Error(
        `Jira enabled but not authenticated — run "vwork auth login" first`
      );
    }
    servers.push({
      name: "jira",
      transport: "http",
      url: config.jira.url,
      auth: "atlassian",
    });
  }

  if (config.slack.enabled) {
    // Token priority: token_env (explicit) → stored OAuth token → error
    const token = config.slack.token_env
      ? resolveSecret(config.slack.token_env)
      : getSlackToken();
    if (!token) {
      throw new Error(
        `Slack enabled but token not configured — run "vwork auth slack" or set token_env in config`
      );
    }
    servers.push({
      name: "slack",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: { SLACK_BOT_TOKEN: token },
    });
  }

  return servers;
}
