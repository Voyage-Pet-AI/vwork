import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Config } from "../config.js";
import type { AgentTodo, TodoAgentStatus, TodoList, TodoPriority } from "./types.js";

const HEADING_ACTIVE = "## Active";
const HEADING_BLOCKED = "## Blocked";
const HEADING_DONE = "## Completed Today";

const CHECKBOX_RE = /^\s*- \[( |x|X)\]\s+(.*)$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseDate(input: string): Date {
  const [y, m, d] = input.split("-").map((v) => parseInt(v, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

export function getYesterdayDate(now: Date = new Date()): string {
  const dt = new Date(now);
  dt.setDate(dt.getDate() - 1);
  return formatDate(dt);
}

function normalizeStatus(input: unknown): TodoAgentStatus {
  if (input === "pending" || input === "in_progress" || input === "completed" || input === "cancelled") {
    return input;
  }
  throw new Error(`Invalid todo status: ${String(input)}`);
}

function normalizePriority(input: unknown): TodoPriority {
  if (input === "high" || input === "medium" || input === "low") return input;
  return "medium";
}

function normalizeTodo(raw: unknown): AgentTodo {
  const todo = raw as Record<string, unknown>;
  if (!todo || typeof todo !== "object") {
    throw new Error("Invalid todo object");
  }

  const id = typeof todo.id === "string" && todo.id.trim() ? todo.id.trim() : crypto.randomUUID();
  const content = typeof todo.content === "string" ? todo.content.trim() : "";
  if (!content) {
    throw new Error("Todo content cannot be empty");
  }

  return {
    id,
    content,
    status: normalizeStatus(todo.status),
    priority: normalizePriority(todo.priority),
  };
}

function headingSection(line: string): "active" | "blocked" | "done" | null {
  const trimmed = line.trim();
  if (trimmed === HEADING_ACTIVE) return "active";
  if (trimmed === HEADING_BLOCKED) return "blocked";
  if (trimmed === HEADING_DONE) return "done";
  return null;
}

function parseLegacyNotebook(markdown: string): AgentTodo[] {
  const lines = markdown.split("\n");
  const todos: AgentTodo[] = [];
  let section: "active" | "blocked" | "done" | null = null;

  for (const line of lines) {
    const nextSection = headingSection(line);
    if (nextSection) {
      section = nextSection;
      continue;
    }
    if (!section) continue;

    const match = line.match(CHECKBOX_RE);
    if (!match) continue;

    const checked = match[1].toLowerCase() === "x";
    const content = match[2].trim().replace(/\s+/g, " ");
    if (!content) continue;

    let status: TodoAgentStatus;
    if (checked || section === "done") status = "completed";
    else if (section === "blocked") status = "cancelled";
    else status = "pending";

    todos.push({
      id: crypto.randomUUID(),
      content,
      status,
      priority: "medium",
    });
  }

  return todos;
}

function ensureBaseDirs(config: Config): void {
  mkdirSync(config.todo.notebook_dir, { recursive: true });
  mkdirSync(join(config.todo.notebook_dir, "store"), { recursive: true });
}

export function getNotebookPathForDate(config: Config, date: string): string {
  return join(config.todo.notebook_dir, `${date}.md`);
}

export function getTodoStorePath(config: Config, date: string): string {
  return join(config.todo.notebook_dir, "store", `${date}.json`);
}

export function deriveTodoList(todos: AgentTodo[]): TodoList {
  return {
    active: todos.filter((t) => t.status === "pending" || t.status === "in_progress"),
    blocked: todos.filter((t) => t.status === "cancelled"),
    completedToday: todos.filter((t) => t.status === "completed"),
  };
}

export function buildTodoContextFromAgentTodos(todos: AgentTodo[]): string {
  const list = deriveTodoList(todos);
  const active = list.active.map((t) => t.content).join(", ");
  const blocked = list.blocked.map((t) => t.content).join(", ");
  if (!active && !blocked) return "";
  return [
    "User's current todos:",
    `Active: ${active || "none"}`,
    `Blocked: ${blocked || "none"}`,
  ].join("\n");
}

function renderActiveLine(todo: AgentTodo): string {
  const marker = todo.status === "in_progress" ? "[in_progress] " : "";
  return `- [ ] ${marker}${todo.content}`;
}

function renderCancelledLine(todo: AgentTodo): string {
  return `- [ ] ${todo.content}`;
}

function renderCompletedLine(todo: AgentTodo): string {
  return `- [x] ${todo.content}`;
}

export function projectNotebookMarkdown(todos: AgentTodo[], existingMarkdown = ""): string {
  const lines: string[] = [];
  const prefix = existingMarkdown.trimEnd();
  if (prefix) lines.push(prefix, "");

  const view = deriveTodoList(todos);

  lines.push(HEADING_ACTIVE);
  if (view.active.length === 0) lines.push("<!-- none -->");
  else for (const todo of view.active) lines.push(renderActiveLine(todo));

  lines.push("", HEADING_BLOCKED);
  if (view.blocked.length === 0) lines.push("<!-- none -->");
  else for (const todo of view.blocked) lines.push(renderCancelledLine(todo));

  lines.push("", HEADING_DONE);
  if (view.completedToday.length === 0) lines.push("<!-- none -->");
  else for (const todo of view.completedToday) lines.push(renderCompletedLine(todo));

  return lines.join("\n").trimEnd() + "\n";
}

function readAndNormalizeStore(path: string): AgentTodo[] {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  if (!Array.isArray(raw)) throw new Error("Invalid todo store format");
  return raw.map((item) => normalizeTodo(item));
}

function writeStore(path: string, todos: AgentTodo[]): void {
  writeFileSync(path, JSON.stringify(todos, null, 2) + "\n");
}

export function loadAgentTodos(config: Config, date: string = formatDate(new Date())): AgentTodo[] {
  ensureBaseDirs(config);
  const storePath = getTodoStorePath(config, date);
  const notebookPath = getNotebookPathForDate(config, date);

  if (existsSync(storePath)) {
    return readAndNormalizeStore(storePath);
  }

  if (existsSync(notebookPath)) {
    const markdown = readFileSync(notebookPath, "utf-8");
    const migrated = parseLegacyNotebook(markdown);
    writeStore(storePath, migrated);
    const projected = projectNotebookMarkdown(migrated, markdown);
    writeFileSync(notebookPath, projected);
    return migrated;
  }

  return [];
}

export function saveAgentTodos(config: Config, date: string, todos: AgentTodo[]): void {
  ensureBaseDirs(config);
  const normalized = todos.map((todo) => normalizeTodo(todo));
  const storePath = getTodoStorePath(config, date);
  writeStore(storePath, normalized);
  syncNotebookFromStore(config, date);
}

export function syncNotebookFromStore(config: Config, date: string): void {
  ensureBaseDirs(config);
  const storePath = getTodoStorePath(config, date);
  const notebookPath = getNotebookPathForDate(config, date);
  const todos = existsSync(storePath) ? readAndNormalizeStore(storePath) : [];
  const existing = existsSync(notebookPath) ? readFileSync(notebookPath, "utf-8") : "";
  const rendered = projectNotebookMarkdown(todos, existing);
  writeFileSync(notebookPath, rendered);
}
