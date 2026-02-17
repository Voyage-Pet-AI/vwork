import { Hono } from "hono";
import type { Config } from "../../config.js";
import { getCurrentTodos, replaceCurrentTodos } from "../../todo/manager.js";
import type { AgentTodo } from "../../todo/types.js";

export function todoRoutes(config: Config) {
  const app = new Hono();

  app.get("/", (c) => {
    const { todos, agentTodos } = getCurrentTodos(config);
    return c.json({ todos, agentTodos });
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.todos)) {
      return c.json({ error: "body.todos must be an array" }, 400);
    }
    const { todos, agentTodos } = replaceCurrentTodos(config, body.todos as AgentTodo[]);
    return c.json({ todos, agentTodos });
  });

  return app;
}
