import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Config } from "../config.js";
import {
  addTodo,
  carryOverFromYesterday,
  getCurrentTodos,
  markTodoActive,
  markTodoBlocked,
  markTodoDone,
} from "./manager.js";

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
  testRoot = mkdtempSync(join(tmpdir(), "reporter-todo-test-"));
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("todo manager", () => {
  test("add todo and mark done", () => {
    const config = buildConfig(join(testRoot, "notebook"));
    const now = new Date("2026-02-16T10:00:00.000Z");

    addTodo(config, "Build todo feature #reporter", [], undefined, now);
    const done = markTodoDone(config, "build todo", now);

    expect(done.todos.active.length).toBe(0);
    expect(done.todos.completedToday.length).toBe(1);
    expect(done.todos.completedToday[0].title).toContain("Build todo feature");
  });

  test("block and unblock todo", () => {
    const config = buildConfig(join(testRoot, "notebook"));
    const now = new Date("2026-02-16T10:00:00.000Z");

    addTodo(config, "Deploy auth service #infra", [], undefined, now);
    const blocked = markTodoBlocked(config, "1", "waiting on secret", now);
    expect(blocked.todos.blocked.length).toBe(1);
    expect(blocked.todos.blocked[0].title).toContain("waiting on secret");

    const active = markTodoActive(config, "1", now);
    expect(active.todos.blocked.length).toBe(0);
    expect(active.todos.active.length).toBe(1);
  });

  test("ambiguous selector returns error", () => {
    const config = buildConfig(join(testRoot, "notebook"));
    const now = new Date("2026-02-16T10:00:00.000Z");

    addTodo(config, "Fix auth flow", [], undefined, now);
    addTodo(config, "Fix auth tests", [], undefined, now);

    expect(() => markTodoDone(config, "fix auth", now)).toThrow(/Ambiguous/);
  });

  test("carry over open todos from yesterday only", () => {
    const config = buildConfig(join(testRoot, "notebook"));
    const yesterday = new Date("2026-02-15T10:00:00.000Z");
    const today = new Date("2026-02-16T10:00:00.000Z");

    addTodo(config, "Task one", [], undefined, yesterday);
    addTodo(config, "Task two", [], undefined, yesterday);
    markTodoDone(config, "task two", yesterday);

    const result = carryOverFromYesterday(config, today);
    expect(result.carried).toBe(1);

    const current = getCurrentTodos(config, today).todos;
    expect(current.active.length).toBe(1);
    expect(current.completedToday.length).toBe(0);
  });
});
