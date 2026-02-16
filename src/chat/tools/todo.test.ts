import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Config } from "../../config.js";
import type { ToolCall } from "../../llm/provider.js";
import { executeTodoTool } from "./todo.js";

let testRoot = "";

function buildConfig(notebookDir: string): Config {
  return {
    llm: { provider: "anthropic", model: "claude-sonnet-4-5-20250929" },
    github: { enabled: false, orgs: [] },
    jira: { enabled: false, url: "" },
    slack: { enabled: false, channels: [] },
    report: { lookback_days: 1, output_dir: join(notebookDir, "reports"), memory_depth: 5 },
    chat: { report_postprocess_enabled: false, report_inbox_replay_limit: 20 },
    todo: {
      enabled: true,
      notebook_dir: notebookDir,
      default_mode: "minimal",
      carryover_prompt: true,
    },
    computer: {
      enabled: true,
      require_session_approval: true,
      max_steps: 150,
      max_duration_sec: 900,
      allow_domains: [],
      block_domains: [],
    },
  };
}

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "vwork-todo-tool-test-"));
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("todo tools", () => {
  test("todo_write then todo_read", async () => {
    const config = buildConfig(join(testRoot, "notebook"));

    const writeCall: ToolCall = {
      id: "1",
      name: "vwork__todo_write",
      input: {
        todos: [
          { id: "a", content: "Build UI", status: "pending", priority: "high" },
          { id: "b", content: "Fix tests", status: "completed", priority: "medium" },
        ],
      },
    };

    const writeOut = JSON.parse(await executeTodoTool(writeCall, config)) as {
      open_count: number;
      todos: Array<{ id: string; content: string }>;
    };
    expect(writeOut.open_count).toBe(1);
    expect(writeOut.todos.length).toBe(2);

    const readCall: ToolCall = { id: "2", name: "vwork__todo_read", input: {} };
    const readOut = JSON.parse(await executeTodoTool(readCall, config)) as {
      open_count: number;
      todos: Array<{ id: string; content: string }>;
    };
    expect(readOut.open_count).toBe(1);
    expect(readOut.todos[0].content).toBe("Build UI");
  });

  test("todo_write rejects invalid status", async () => {
    const config = buildConfig(join(testRoot, "notebook"));
    const writeCall: ToolCall = {
      id: "1",
      name: "vwork__todo_write",
      input: {
        todos: [
          { id: "a", content: "bad", status: "active", priority: "high" },
        ],
      },
    };

    await expect(executeTodoTool(writeCall, config)).rejects.toThrow(/invalid todo status/i);
  });
});
