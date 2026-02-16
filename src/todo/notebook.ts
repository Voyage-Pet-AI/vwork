import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Config } from "../config.js";
import type { ParsedNotebook, Todo, TodoList } from "./types.js";

const HEADING_ACTIVE = "## Active";
const HEADING_BLOCKED = "## Blocked";
const HEADING_DONE = "## Completed Today";

const CHECKBOX_RE = /^\s*- \[( |x|X)\]\s+(.*)$/;
const TAG_RE = /#([A-Za-z0-9_-]+)/g;

const EMPTY_TODOS: TodoList = {
  active: [],
  blocked: [],
  completedToday: [],
};

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

function previousDateString(input: string): string {
  const dt = parseDate(input);
  dt.setDate(dt.getDate() - 1);
  return formatDate(dt);
}

export function getNotebookPathForDate(config: Config, date: string): string {
  return join(config.todo.notebook_dir, `${date}.md`);
}

export function getTodayNotebookPath(config: Config, now: Date = new Date()): string {
  return getNotebookPathForDate(config, formatDate(now));
}

function cloneTodos(todos: TodoList): TodoList {
  return {
    active: [...todos.active],
    blocked: [...todos.blocked],
    completedToday: [...todos.completedToday],
  };
}

function sectionFromHeading(line: string): "active" | "blocked" | "done" | null {
  const trimmed = line.trim();
  if (trimmed === HEADING_ACTIVE) return "active";
  if (trimmed === HEADING_BLOCKED) return "blocked";
  if (trimmed === HEADING_DONE) return "done";
  return null;
}

function parseTodoLine(raw: string, statusFromSection: "active" | "blocked" | "done", lineNumber: number): Todo | null {
  const match = raw.match(CHECKBOX_RE);
  if (!match) return null;

  const checked = match[1].toLowerCase() === "x";
  const text = match[2].trim();
  const status = checked ? "done" : statusFromSection;

  const tags: string[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    tags.push(m[1]);
  }

  const title = text.replace(TAG_RE, "").replace(/\s+/g, " ").trim();
  const noteMatch = title.match(/^(.*)\(([^()]*)\)\s*$/);
  const note = noteMatch ? noteMatch[2].trim() : undefined;

  return {
    id: `line:${lineNumber}`,
    title,
    tags,
    note,
    status,
    lineNumber,
  };
}

function todoLine(todo: Todo, checked: boolean): string {
  const tags = todo.tags.length > 0 ? ` ${todo.tags.map((t) => `#${t}`).join(" ")}` : "";
  return `- [${checked ? "x" : " "}] ${todo.title}${tags}`;
}

function renderSectionBody(todos: Todo[], checked: boolean): string[] {
  const lines: string[] = [];
  for (const todo of todos) {
    lines.push(todoLine(todo, checked));
    if (todo.description) {
      for (const line of todo.description.split("\n")) {
        lines.push(`  - ${line}`);
      }
    }
  }
  if (lines.length === 0) lines.push("<!-- none -->");
  return lines;
}

function assignRuntimeIds(date: string, todos: TodoList): TodoList {
  const withIds = cloneTodos(todos);
  withIds.active = withIds.active.map((todo) => ({
    ...todo,
    id: `${date}:active:${todo.lineNumber ?? 0}`,
  }));
  withIds.blocked = withIds.blocked.map((todo) => ({
    ...todo,
    id: `${date}:blocked:${todo.lineNumber ?? 0}`,
  }));
  withIds.completedToday = withIds.completedToday.map((todo) => ({
    ...todo,
    id: `${date}:done:${todo.lineNumber ?? 0}`,
  }));
  return withIds;
}

export function parseTodos(markdown: string): TodoList {
  const lines = markdown.split("\n");
  const todos: TodoList = { active: [], blocked: [], completedToday: [] };

  let currentSection: "active" | "blocked" | "done" | null = null;
  let lastTodo: Todo | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const section = sectionFromHeading(line);
    if (section) {
      currentSection = section;
      lastTodo = null;
      continue;
    }

    if (!currentSection) continue;

    const todo = parseTodoLine(line, currentSection, i + 1);
    if (todo) {
      if (todo.status === "active") todos.active.push(todo);
      else if (todo.status === "blocked") todos.blocked.push(todo);
      else todos.completedToday.push(todo);
      lastTodo = todo;
      continue;
    }

    if (lastTodo && /^\s{2,}-\s+/.test(line)) {
      const chunk = line.replace(/^\s{2,}-\s+/, "").trimEnd();
      if (chunk) {
        lastTodo.description = lastTodo.description
          ? `${lastTodo.description}\n${chunk}`
          : chunk;
      }
    }
  }

  return todos;
}

function collectSectionRanges(lines: string[]): {
  active?: { start: number; end: number };
  blocked?: { start: number; end: number };
  done?: { start: number; end: number };
} {
  const ranges: {
    active?: { start: number; end: number };
    blocked?: { start: number; end: number };
    done?: { start: number; end: number };
  } = {};

  for (let i = 0; i < lines.length; i++) {
    const section = sectionFromHeading(lines[i]);
    if (!section) continue;

    let end = lines.length - 1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,6}\s+/.test(lines[j])) {
        end = j - 1;
        break;
      }
    }
    ranges[section] = { start: i, end };
  }

  return ranges;
}

export function formatNotebook(existingMarkdown: string, todoList: TodoList): string {
  const lines = existingMarkdown.length > 0 ? existingMarkdown.split("\n") : [];
  const ranges = collectSectionRanges(lines);

  const sectionText = (heading: string, body: string[]): string[] => [heading, ...body, ""];

  const activeBlock = sectionText(HEADING_ACTIVE, renderSectionBody(todoList.active, false));
  const blockedBlock = sectionText(HEADING_BLOCKED, renderSectionBody(todoList.blocked, false));
  const doneBlock = sectionText(HEADING_DONE, renderSectionBody(todoList.completedToday, true));

  const hasAnySection = Boolean(ranges.active || ranges.blocked || ranges.done);
  if (!hasAnySection) {
    const prefix = existingMarkdown.trimEnd();
    return [prefix, "", ...activeBlock, ...blockedBlock, ...doneBlock]
      .filter((chunk, idx, arr) => !(chunk === "" && (idx === 0 || arr[idx - 1] === "")))
      .join("\n")
      .trimEnd() + "\n";
  }

  const sortedRanges = [ranges.active, ranges.blocked, ranges.done]
    .filter((r): r is { start: number; end: number } => Boolean(r))
    .sort((a, b) => a.start - b.start);

  const firstStart = sortedRanges[0].start;
  const lastEnd = sortedRanges[sortedRanges.length - 1].end;

  const before = lines.slice(0, firstStart);
  const after = lines.slice(lastEnd + 1);

  const merged = [...before];
  if (merged.length > 0 && merged[merged.length - 1] !== "") merged.push("");
  merged.push(...activeBlock, ...blockedBlock, ...doneBlock);
  if (after.length > 0 && merged[merged.length - 1] !== "") merged.push("");
  merged.push(...after);

  return merged.join("\n").trimEnd() + "\n";
}

export function loadTodoList(config: Config, date: string = formatDate(new Date())): ParsedNotebook {
  const path = getNotebookPathForDate(config, date);
  if (!existsSync(path)) {
    const rendered = formatNotebook("", EMPTY_TODOS);
    return {
      todos: assignRuntimeIds(date, EMPTY_TODOS),
      renderedMarkdown: rendered,
    };
  }

  const raw = readFileSync(path, "utf-8");
  const todos = parseTodos(raw);
  return {
    todos: assignRuntimeIds(date, todos),
    renderedMarkdown: raw,
  };
}

export function saveTodoList(config: Config, date: string, todoList: TodoList): string {
  mkdirSync(config.todo.notebook_dir, { recursive: true });
  const path = getNotebookPathForDate(config, date);
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const rendered = formatNotebook(existing, todoList);
  writeFileSync(path, rendered);
  return path;
}

export function getYesterdayDate(now: Date = new Date()): string {
  return previousDateString(formatDate(now));
}

export function buildTodoContext(todos: TodoList): string {
  const active = todos.active.map((t) => t.title).join(", ");
  const blocked = todos.blocked.map((t) => t.title).join(", ");
  if (!active && !blocked) return "";

  return [
    "User's current todos:",
    `Active: ${active || "none"}`,
    `Blocked: ${blocked || "none"}`,
  ].join("\n");
}
