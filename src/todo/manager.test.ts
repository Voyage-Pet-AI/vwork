import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Config } from "../config.js";
import { carryOverFromYesterday, getCurrentTodos, replaceCurrentTodos } from "./manager.js";

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
  testRoot = mkdtempSync(join(tmpdir(), "vwork-todo-manager-test-"));
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("todo manager", () => {
  test("replaceCurrentTodos persists canonical list", () => {
    const config = buildConfig(join(testRoot, "notebook"));
    const now = new Date("2026-02-16T10:00:00.000Z");

    const out = replaceCurrentTodos(
      config,
      [
        { id: "1", content: "One", status: "pending", priority: "high" },
        { id: "2", content: "Two", status: "completed", priority: "medium" },
      ],
      now,
    );

    expect(out.agentTodos.length).toBe(2);
    expect(out.todos.active.length).toBe(1);
    expect(out.todos.completedToday.length).toBe(1);
  });

  test("carry over copies pending and in_progress only", () => {
    const config = buildConfig(join(testRoot, "notebook"));
    const yesterday = new Date("2026-02-15T10:00:00.000Z");
    const today = new Date("2026-02-16T10:00:00.000Z");

    replaceCurrentTodos(
      config,
      [
        { id: "a", content: "pending", status: "pending", priority: "medium" },
        { id: "b", content: "in progress", status: "in_progress", priority: "medium" },
        { id: "c", content: "cancelled", status: "cancelled", priority: "medium" },
        { id: "d", content: "completed", status: "completed", priority: "medium" },
      ],
      yesterday,
    );

    const result = carryOverFromYesterday(config, today);
    expect(result.carried).toBe(2);

    const current = getCurrentTodos(config, today).agentTodos;
    expect(current.length).toBe(2);
    expect(current.every((t) => t.status === "pending")).toBe(true);
  });

  test("carry over skips if today already has open todo", () => {
    const config = buildConfig(join(testRoot, "notebook"));
    const yesterday = new Date("2026-02-15T10:00:00.000Z");
    const today = new Date("2026-02-16T10:00:00.000Z");

    replaceCurrentTodos(config, [{ id: "a", content: "old", status: "pending", priority: "medium" }], yesterday);
    replaceCurrentTodos(config, [{ id: "b", content: "today", status: "in_progress", priority: "medium" }], today);

    const result = carryOverFromYesterday(config, today);
    expect(result.carried).toBe(0);
    expect(result.alreadyHadOpenTodos).toBe(true);
  });
});
