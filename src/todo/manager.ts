import type { Config } from "../config.js";
import type { ParsedNotebook, Todo, TodoList } from "./types.js";
import {
  buildTodoContext,
  formatDate,
  getYesterdayDate,
  loadTodoList,
  saveTodoList,
} from "./notebook.js";

function normalizeTags(tags: string[]): string[] {
  const set = new Set<string>();
  for (const tag of tags) {
    const cleaned = tag.replace(/^#/, "").trim();
    if (cleaned) set.add(cleaned);
  }
  return [...set];
}

function extractTagsFromText(input: string): { title: string; tags: string[] } {
  const tags: string[] = [];
  const title = input.replace(/#([A-Za-z0-9_-]+)/g, (_m, tag: string) => {
    tags.push(tag);
    return "";
  });
  return {
    title: title.replace(/\s+/g, " ").trim(),
    tags: normalizeTags(tags),
  };
}

function allOpenTodos(todos: TodoList): Todo[] {
  return [...todos.active, ...todos.blocked];
}

interface ResolveResult {
  todo: Todo;
  source: "active" | "blocked";
}

function resolveTodoSelector(todos: TodoList, selector: string): ResolveResult {
  const open = allOpenTodos(todos);
  const trimmed = selector.trim();

  const indexMatch = trimmed.match(/^\d+$/);
  if (indexMatch) {
    const index = parseInt(trimmed, 10);
    if (index < 1 || index > open.length) {
      throw new Error(`No todo at index ${index}.`);
    }
    const todo = open[index - 1];
    return {
      todo,
      source: todos.active.some((t) => t.id === todo.id) ? "active" : "blocked",
    };
  }

  const lowered = trimmed.toLowerCase();
  const matches = open.filter((todo) => todo.title.toLowerCase().includes(lowered));
  if (matches.length === 0) {
    throw new Error(`No todo matched "${selector}".`);
  }
  if (matches.length > 1) {
    const sample = matches.slice(0, 5).map((todo) => `"${todo.title}"`).join(", ");
    throw new Error(`Ambiguous todo selector "${selector}". Matches: ${sample}`);
  }

  const todo = matches[0];
  return {
    todo,
    source: todos.active.some((t) => t.id === todo.id) ? "active" : "blocked",
  };
}

function withIds(date: string, todos: TodoList): TodoList {
  return {
    active: todos.active.map((todo, idx) => ({
      ...todo,
      id: `${date}:active:${todo.lineNumber ?? idx + 1}`,
      status: "active",
    })),
    blocked: todos.blocked.map((todo, idx) => ({
      ...todo,
      id: `${date}:blocked:${todo.lineNumber ?? idx + 1}`,
      status: "blocked",
    })),
    completedToday: todos.completedToday.map((todo, idx) => ({
      ...todo,
      id: `${date}:done:${todo.lineNumber ?? idx + 1}`,
      status: "done",
    })),
  };
}

function persist(config: Config, date: string, todos: TodoList): TodoList {
  saveTodoList(config, date, todos);
  return withIds(date, todos);
}

export function getCurrentTodos(config: Config, now: Date = new Date()): ParsedNotebook {
  return loadTodoList(config, formatDate(now));
}

export function addTodo(
  config: Config,
  titleOrText: string,
  tags: string[] = [],
  description?: string,
  now: Date = new Date(),
): { todos: TodoList; added: Todo } {
  const date = formatDate(now);
  const parsed = loadTodoList(config, date);
  const fromText = extractTagsFromText(titleOrText);
  const title = fromText.title;
  const mergedTags = normalizeTags([...fromText.tags, ...tags]);

  if (!title) {
    throw new Error("Todo title cannot be empty.");
  }

  const added: Todo = {
    id: "",
    title,
    tags: mergedTags,
    status: "active",
    description,
  };

  const next: TodoList = {
    active: [...parsed.todos.active, added],
    blocked: [...parsed.todos.blocked],
    completedToday: [...parsed.todos.completedToday],
  };

  const withRuntime = persist(config, date, next);
  return {
    todos: withRuntime,
    added: withRuntime.active[withRuntime.active.length - 1],
  };
}

export function markTodoDone(
  config: Config,
  selector: string,
  now: Date = new Date(),
): { todos: TodoList; updated: Todo } {
  const date = formatDate(now);
  const parsed = loadTodoList(config, date);
  const resolved = resolveTodoSelector(parsed.todos, selector);

  const nextActive = parsed.todos.active.filter((todo) => todo.id !== resolved.todo.id);
  const nextBlocked = parsed.todos.blocked.filter((todo) => todo.id !== resolved.todo.id);

  const doneTodo: Todo = {
    ...resolved.todo,
    status: "done",
  };

  const next: TodoList = {
    active: nextActive,
    blocked: nextBlocked,
    completedToday: [...parsed.todos.completedToday, doneTodo],
  };

  const withRuntime = persist(config, date, next);
  return {
    todos: withRuntime,
    updated: doneTodo,
  };
}

export function markTodoBlocked(
  config: Config,
  selector: string,
  note?: string,
  now: Date = new Date(),
): { todos: TodoList; updated: Todo } {
  const date = formatDate(now);
  const parsed = loadTodoList(config, date);
  const resolved = resolveTodoSelector(parsed.todos, selector);

  const nextActive = parsed.todos.active.filter((todo) => todo.id !== resolved.todo.id);
  const nextBlocked = parsed.todos.blocked.filter((todo) => todo.id !== resolved.todo.id);

  const updatedTitle = note
    ? `${resolved.todo.title.replace(/\s*\([^()]*\)\s*$/, "")} (${note.trim()})`
    : resolved.todo.title;

  const blockedTodo: Todo = {
    ...resolved.todo,
    title: updatedTitle,
    status: "blocked",
  };

  const next: TodoList = {
    active: nextActive,
    blocked: [...nextBlocked, blockedTodo],
    completedToday: [...parsed.todos.completedToday],
  };

  const withRuntime = persist(config, date, next);
  return {
    todos: withRuntime,
    updated: blockedTodo,
  };
}

export function markTodoActive(
  config: Config,
  selector: string,
  now: Date = new Date(),
): { todos: TodoList; updated: Todo } {
  const date = formatDate(now);
  const parsed = loadTodoList(config, date);

  const blockedOnly: TodoList = {
    active: [],
    blocked: parsed.todos.blocked,
    completedToday: [],
  };
  const resolved = resolveTodoSelector(blockedOnly, selector);

  const nextBlocked = parsed.todos.blocked.filter((todo) => todo.id !== resolved.todo.id);
  const activeTitle = resolved.todo.title.replace(/\s*\([^()]*\)\s*$/, "").trim();
  const activeTodo: Todo = {
    ...resolved.todo,
    title: activeTitle,
    status: "active",
  };

  const next: TodoList = {
    active: [...parsed.todos.active, activeTodo],
    blocked: nextBlocked,
    completedToday: [...parsed.todos.completedToday],
  };

  const withRuntime = persist(config, date, next);
  return {
    todos: withRuntime,
    updated: activeTodo,
  };
}

export function carryOverFromYesterday(
  config: Config,
  now: Date = new Date(),
): { carried: number; todos: TodoList; alreadyHadOpenTodos: boolean } {
  const today = formatDate(now);
  const yesterday = getYesterdayDate(now);

  const todayState = loadTodoList(config, today);
  const alreadyOpen = todayState.todos.active.length + todayState.todos.blocked.length > 0;
  if (alreadyOpen) {
    return {
      carried: 0,
      todos: todayState.todos,
      alreadyHadOpenTodos: true,
    };
  }

  const yesterdayState = loadTodoList(config, yesterday);
  const carry = allOpenTodos(yesterdayState.todos).map((todo) => ({
    ...todo,
    status: "active" as const,
  }));

  if (carry.length === 0) {
    return {
      carried: 0,
      todos: todayState.todos,
      alreadyHadOpenTodos: false,
    };
  }

  const next: TodoList = {
    active: [...todayState.todos.active, ...carry],
    blocked: [...todayState.todos.blocked],
    completedToday: [...todayState.todos.completedToday],
  };

  const withRuntime = persist(config, today, next);
  return {
    carried: carry.length,
    todos: withRuntime,
    alreadyHadOpenTodos: false,
  };
}

export function buildCurrentTodoContext(config: Config, now: Date = new Date()): string {
  const todos = getCurrentTodos(config, now).todos;
  return buildTodoContext(todos);
}
