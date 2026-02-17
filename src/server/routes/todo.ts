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
    const body = await c.req.json<{ todos: AgentTodo[] }>();
    const { todos, agentTodos } = replaceCurrentTodos(config, body.todos);
    return c.json({ todos, agentTodos });
  });

  return app;
}
