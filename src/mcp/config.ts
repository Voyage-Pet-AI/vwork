import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ServerEntry } from "./registry.js";

export interface MCPServerDef {
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerDef>;
}

const MCP_CONFIG_PATH = join(homedir(), "vwork", ".mcp.json");

export function getMCPConfigPath(): string {
  return MCP_CONFIG_PATH;
}

export function loadMCPConfig(): MCPConfig {
  if (!existsSync(MCP_CONFIG_PATH)) {
    return { mcpServers: {} };
  }
  const raw = readFileSync(MCP_CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as MCPConfig;
}

export function saveMCPConfig(config: MCPConfig): void {
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Expand `${VAR}` (required) and `${VAR:-default}` (with fallback) in a string.
 * Throws if a required variable is not set.
 */
export function expandEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const sepIdx = expr.indexOf(":-");
    if (sepIdx !== -1) {
      const varName = expr.slice(0, sepIdx);
      const fallback = expr.slice(sepIdx + 2);
      return process.env[varName] ?? fallback;
    }
    const value = process.env[expr];
    if (value === undefined) {
      throw new Error(
        `Environment variable ${expr} is not set (referenced in .mcp.json)`
      );
    }
    return value;
  });
}

function expandRecord(
  record: Record<string, string> | undefined
): Record<string, string> {
  if (!record) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = expandEnvVars(value);
  }
  return result;
}

/**
 * Convert MCPConfig entries into ServerEntry[] with env expansion applied.
 */
export function mcpConfigToServers(config: MCPConfig): ServerEntry[] {
  const entries: ServerEntry[] = [];
  for (const [name, def] of Object.entries(config.mcpServers)) {
    if (def.type === "stdio") {
      if (!def.command) {
        throw new Error(`MCP server "${name}" (stdio) is missing "command"`);
      }
      entries.push({
        name,
        transport: "stdio",
        command: expandEnvVars(def.command),
        args: (def.args ?? []).map(expandEnvVars),
        env: expandRecord(def.env),
      });
    } else if (def.type === "http") {
      if (!def.url) {
        throw new Error(`MCP server "${name}" (http) is missing "url"`);
      }
      entries.push({
        name,
        transport: "http",
        url: expandEnvVars(def.url),
        headers: expandRecord(def.headers),
      });
    }
  }
  return entries;
}
