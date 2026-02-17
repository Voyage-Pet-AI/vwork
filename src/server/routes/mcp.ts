import { Hono } from "hono";
import type { MCPClientManager } from "../../mcp/client.js";

export function mcpRoutes(mcpClient: MCPClientManager, serverNames: string[]) {
  const app = new Hono();

  app.get("/servers", (c) => {
    return c.json({ servers: serverNames });
  });

  app.get("/tools", (c) => {
    const tools = mcpClient.getAllTools().map((t) => ({
      name: t.name,
      description: t.description ?? "",
    }));
    return c.json({ tools });
  });

  return app;
}
