import type { Config } from "../../config.js";
import type { LLMTool, ToolCall } from "../../llm/provider.js";
import type { AgentTodo } from "../../todo/types.js";
import { formatDate, loadAgentTodos, saveAgentTodos } from "../../todo/store.js";

export const todoTools: LLMTool[] = [
  {
    name: "reporter__todo_read",
    description:
      "Read current todo list. Use this before todo updates so you can preserve untouched items and indices.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "reporter__todo_write",
    description:
      "Replace the current todo list with the provided full list. Keep untouched items from reporter__todo_read.",
    input_schema: {
      type: "object" as const,
      properties: {
        todos: {
          type: "array",
          description: "Full updated todo list",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              content: { type: "string" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "cancelled"],
              },
              priority: {
                type: "string",
                enum: ["high", "medium", "low"],
              },
            },
            required: ["id", "content", "status", "priority"],
          },
        },
      },
      required: ["todos"],
    },
  },
];

function getDate(input: Record<string, unknown>): string {
  const raw = input.date;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return formatDate(new Date());
}

function normalizeTodos(raw: unknown): AgentTodo[] {
  if (!Array.isArray(raw)) throw new Error("todos must be an array");
  return raw.map((item) => {
    const todo = item as Record<string, unknown>;
    if (!todo || typeof todo !== "object") throw new Error("invalid todo item");

    const id = typeof todo.id === "string" && todo.id.trim() ? todo.id.trim() : crypto.randomUUID();
    const content = typeof todo.content === "string" ? todo.content.trim() : "";
    if (!content) throw new Error("todo content cannot be empty");

    const status = todo.status;
    if (status !== "pending" && status !== "in_progress" && status !== "completed" && status !== "cancelled") {
      throw new Error(`invalid todo status: ${String(status)}`);
    }

    const priority = todo.priority;
    if (priority !== "high" && priority !== "medium" && priority !== "low") {
      throw new Error(`invalid todo priority: ${String(priority)}`);
    }

    return {
      id,
      content,
      status,
      priority,
    };
  });
}

export async function executeTodoTool(tc: ToolCall, config: Config): Promise<string> {
  const date = getDate(tc.input);

  switch (tc.name) {
    case "reporter__todo_read": {
      const todos = loadAgentTodos(config, date);
      return JSON.stringify(
        {
          date,
          todos,
          open_count: todos.filter((x) => x.status === "pending" || x.status === "in_progress").length,
        },
        null,
        2,
      );
    }

    case "reporter__todo_write": {
      const todos = normalizeTodos(tc.input.todos);
      saveAgentTodos(config, date, todos);
      const canonical = loadAgentTodos(config, date);
      return JSON.stringify(
        {
          date,
          todos: canonical,
          open_count: canonical.filter((x) => x.status === "pending" || x.status === "in_progress").length,
          summary: `${canonical.filter((x) => x.status === "pending" || x.status === "in_progress").length} open todos`,
        },
        null,
        2,
      );
    }

    default:
      throw new Error(`Unknown todo tool: ${tc.name}`);
  }
}
