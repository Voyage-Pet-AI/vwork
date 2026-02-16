import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import type { Config } from "../config.js";
import {
  deriveTodoList,
  formatDate,
  getNotebookPathForDate,
  getTodoStorePath,
  loadAgentTodos,
  projectNotebookMarkdown,
  saveAgentTodos,
} from "./store.js";

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
  testRoot = mkdtempSync(join(tmpdir(), "reporter-todo-store-test-"));
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("todo sidecar store", () => {
  test("roundtrip preserves id/status/priority/content and projects markdown", () => {
    const config = buildConfig(join(testRoot, "notebook"));
    const date = "2026-02-16";
    const todos = [
      { id: "a", content: "Ship feature", status: "pending", priority: "high" as const },
      { id: "b", content: "Fix tests", status: "in_progress", priority: "medium" as const },
      { id: "c", content: "Blocked on API", status: "cancelled", priority: "low" as const },
      { id: "d", content: "Done task", status: "completed", priority: "medium" as const },
    ];

    saveAgentTodos(config, date, todos);
    const loaded = loadAgentTodos(config, date);
    expect(loaded).toEqual(todos);

    const storePath = getTodoStorePath(config, date);
    const notebookPath = getNotebookPathForDate(config, date);
    expect(existsSync(storePath)).toBe(true);
    expect(existsSync(notebookPath)).toBe(true);

    const notebook = readFileSync(notebookPath, "utf-8");
    expect(notebook).toContain("## Active");
    expect(notebook).toContain("[in_progress] Fix tests");
    expect(notebook).toContain("## Blocked");
    expect(notebook).toContain("Blocked on API");
    expect(notebook).toContain("## Completed Today");
    expect(notebook).toContain("- [x] Done task");
  });

  test("migrates legacy markdown when sidecar is missing", () => {
    const config = buildConfig(join(testRoot, "notebook"));
    const date = "2026-02-16";
    mkdirSync(config.todo.notebook_dir, { recursive: true });

    writeFileSync(
      getNotebookPathForDate(config, date),
      [
        "# Daily",
        "",
        "## Active",
        "- [ ] Build todo list #reporter",
        "## Blocked",
        "- [ ] Waiting on release",
        "## Completed Today",
        "- [x] Fixed login",
      ].join("\n") + "\n",
    );

    const loaded = loadAgentTodos(config, date);
    expect(loaded.length).toBe(3);
    expect(loaded.some((t) => t.status === "pending")).toBe(true);
    expect(loaded.some((t) => t.status === "cancelled")).toBe(true);
    expect(loaded.some((t) => t.status === "completed")).toBe(true);

    const storePath = getTodoStorePath(config, date);
    expect(existsSync(storePath)).toBe(true);
  });

  test("deriveTodoList maps statuses correctly", () => {
    const mapped = deriveTodoList([
      { id: "1", content: "a", status: "pending", priority: "medium" },
      { id: "2", content: "b", status: "in_progress", priority: "medium" },
      { id: "3", content: "c", status: "cancelled", priority: "medium" },
      { id: "4", content: "d", status: "completed", priority: "medium" },
    ]);
    expect(mapped.active.length).toBe(2);
    expect(mapped.blocked.length).toBe(1);
    expect(mapped.completedToday.length).toBe(1);
  });

  test("projectNotebookMarkdown can render from scratch", () => {
    const rendered = projectNotebookMarkdown([
      { id: "1", content: "task", status: "pending", priority: "high" },
    ]);
    expect(rendered).toContain("## Active");
    expect(rendered).toContain("- [ ] task");
  });

  test("store path includes date", () => {
    const config = buildConfig(join(testRoot, "notebook"));
    const date = formatDate(new Date("2026-02-16T00:00:00Z"));
    expect(getTodoStorePath(config, date).endsWith("store/2026-02-16.json")).toBe(true);
  });
});
