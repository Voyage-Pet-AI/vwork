import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { join, dirname } from "path";
import { existsSync } from "fs";
import type { Config } from "../config.js";
import type { LLMProvider } from "../llm/provider.js";
import type { MCPClientManager } from "../mcp/client.js";
import { ChatSession } from "../chat/session.js";
import { chatRoutes, type ChatState } from "./routes/chat.js";
import { reportRoutes } from "./routes/report.js";
import { todoRoutes } from "./routes/todo.js";
import { authRoutes } from "./routes/auth.js";
import { scheduleRoutes } from "./routes/schedule.js";
import { configRoutes } from "./routes/config.js";
import { mcpRoutes } from "./routes/mcp.js";
import { log } from "../utils/log.js";

interface StartWebServerOptions {
  config: Config;
  provider: LLMProvider;
  mcpClient: MCPClientManager;
  customServerNames: string[];
  serverNames: string[];
  port?: number;
}

export async function startWebServer(opts: StartWebServerOptions): Promise<void> {
  const port = opts.port ?? 3141;

  const session = new ChatSession(
    opts.provider,
    opts.mcpClient,
    opts.config,
    opts.customServerNames
  );

  const chatState: ChatState = {
    session,
    status: "idle",
    abortController: null,
    sseClients: new Set(),
  };

  const app = new Hono();

  // CORS for Vite dev server and Tauri WebView
  app.use("/api/*", cors({
    origin: ["http://localhost:5173", "http://tauri.localhost", "tauri://localhost"],
  }));

  // API routes
  app.route("/api/chat", chatRoutes(chatState));
  app.route("/api/report", reportRoutes({
    config: opts.config,
    provider: opts.provider,
    mcpClient: opts.mcpClient,
    customServerNames: opts.customServerNames,
  }));
  app.route("/api/todo", todoRoutes(opts.config));
  app.route("/api/auth", authRoutes(opts.config));
  app.route("/api/schedule", scheduleRoutes());
  app.route("/api/config", configRoutes(opts.config));
  app.route("/api/mcp", mcpRoutes(opts.mcpClient, opts.serverNames));

  // Serve built frontend — try standard path first, then .app bundle Resources
  let distWebPath = join(import.meta.dir, "../../dist/web");
  if (!existsSync(distWebPath)) {
    // Inside a Tauri .app bundle: binary is at Contents/MacOS/vwork-server-*,
    // resources are at Contents/Resources/web/
    const execDir = dirname(process.execPath);
    const bundlePath = join(execDir, "../Resources/web");
    if (existsSync(bundlePath)) {
      distWebPath = bundlePath;
    }
  }
  app.use("/*", serveStatic({ root: distWebPath }));
  // SPA fallback — serve index.html for non-API, non-file routes
  app.use("/*", serveStatic({ root: distWebPath, path: "index.html" }));

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: app.fetch,
  });

  log(`Web server running at http://localhost:${server.port}`);
  log(`Connected services: ${opts.serverNames.join(", ") || "none"}`);

  // Keep process alive
  await new Promise(() => {});
}
