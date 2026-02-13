import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ServerEntry } from "./registry.js";
import { AtlassianOAuthProvider } from "../auth/atlassian.js";
import { waitForOAuthCallback } from "../auth/callback.js";
import { log, error, debug } from "../utils/log.js";

export interface MCPTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

interface ConnectedServer {
  name: string;
  client: Client;
  transport: Transport;
  tools: MCPTool[];
}

const CALLBACK_PORT = 32191;

export class MCPClientManager {
  private servers: ConnectedServer[] = [];
  private githubOrgs: string[];

  constructor(githubOrgs: string[] = []) {
    this.githubOrgs = githubOrgs;
  }

  async connect(entries: ServerEntry[]): Promise<void> {
    for (const entry of entries) {
      try {
        log(`Connecting to ${entry.name} MCP server...`);

        let transport: Transport;

        if (entry.transport === "http" && entry.auth === "atlassian") {
          transport = await this.connectHttpWithAuth(entry.url);
        } else if (entry.transport === "http") {
          transport = new StreamableHTTPClientTransport(
            new URL(entry.url),
            entry.headers ? { requestInit: { headers: entry.headers } } : undefined
          );
        } else {
          transport = new StdioClientTransport({
            command: entry.command,
            args: entry.args,
            env: { ...(process.env as Record<string, string>), ...entry.env },
            stderr: "pipe",
          });
        }

        const client = new Client({
          name: "reporter",
          version: "0.1.0",
        });

        await client.connect(transport);

        const result = await client.listTools();
        const tools: MCPTool[] = result.tools.map((t) => ({
          name: `${entry.name}__${t.name}`,
          description: `[${entry.name}] ${t.description ?? t.name}`,
          input_schema: t.inputSchema as Record<string, unknown>,
        }));

        this.servers.push({ name: entry.name, client, transport, tools });
        log(`${entry.name}: ${tools.length} tools available`);
        debug(
          `${entry.name} tools: ${tools.map((t) => t.name).join(", ")}`
        );
      } catch (e) {
        error(
          `Failed to connect to ${entry.name}: ${e instanceof Error ? e.message : e}`
        );
      }
    }
  }

  private async connectHttpWithAuth(url: string): Promise<StreamableHTTPClientTransport> {
    const provider = new AtlassianOAuthProvider();
    const transport = new StreamableHTTPClientTransport(
      new URL(url),
      { authProvider: provider }
    );

    try {
      await transport.start();
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        log("Authorization required — opening browser...");
        const code = await waitForOAuthCallback(CALLBACK_PORT);
        await transport.finishAuth(code);
        await transport.start();
      } else {
        throw e;
      }
    }

    return transport;
  }

  getAllTools(): MCPTool[] {
    return this.servers.flatMap((s) => s.tools);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const sep = name.indexOf("__");
    if (sep === -1) throw new Error(`Invalid tool name: ${name}`);

    const serverName = name.slice(0, sep);
    const toolName = name.slice(sep + 2);

    const server = this.servers.find((s) => s.name === serverName);
    if (!server) throw new Error(`No server connected for: ${serverName}`);

    // Inject org: qualifiers into GitHub search queries
    if (
      serverName === "github" &&
      toolName === "search_issues" &&
      this.githubOrgs.length > 0
    ) {
      const q = args.q as string | undefined;
      if (q && !q.includes("org:")) {
        const orgFilter = this.githubOrgs.map((o) => `org:${o}`).join(" ");
        args = { ...args, q: `${orgFilter} ${q}` };
      }
    }

    debug(`Calling ${serverName}/${toolName} with ${JSON.stringify(args)}`);

    const result = await server.client.callTool({
      name: toolName,
      arguments: args,
    });

    return result;
  }

  async disconnect(): Promise<void> {
    for (const server of this.servers) {
      try {
        await server.transport.close();
      } catch {
        // best effort
      }
    }
    this.servers = [];
  }
}
