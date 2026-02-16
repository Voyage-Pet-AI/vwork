import type { Config } from "../config.js";
import type { AgentTodo, TodoList } from "./types.js";
import {
  buildTodoContextFromAgentTodos,
  deriveTodoList,
  formatDate,
  getYesterdayDate,
  loadAgentTodos,
  saveAgentTodos,
} from "./store.js";

function isOpenStatus(status: AgentTodo["status"]): boolean {
  return status === "pending" || status === "in_progress";
}

function cloneTodoForCarryover(todo: AgentTodo): AgentTodo {
  return {
    id: crypto.randomUUID(),
    content: todo.content,
    priority: todo.priority,
    status: "pending",
  };
}

export function getCurrentAgentTodos(config: Config, now: Date = new Date()): AgentTodo[] {
  return loadAgentTodos(config, formatDate(now));
}

export function getCurrentTodos(config: Config, now: Date = new Date()): { todos: TodoList; agentTodos: AgentTodo[] } {
  const agentTodos = getCurrentAgentTodos(config, now);
  return {
    agentTodos,
    todos: deriveTodoList(agentTodos),
  };
}

export function replaceCurrentTodos(
  config: Config,
  todos: AgentTodo[],
  now: Date = new Date(),
): { todos: TodoList; agentTodos: AgentTodo[] } {
  const date = formatDate(now);
  saveAgentTodos(config, date, todos);
  const loaded = loadAgentTodos(config, date);
  return {
    agentTodos: loaded,
    todos: deriveTodoList(loaded),
  };
}

export function carryOverFromYesterday(
  config: Config,
  now: Date = new Date(),
): { carried: number; todos: TodoList; agentTodos: AgentTodo[]; alreadyHadOpenTodos: boolean } {
  const today = formatDate(now);
  const yesterday = getYesterdayDate(now);

  const todayTodos = loadAgentTodos(config, today);
  if (todayTodos.some((todo) => isOpenStatus(todo.status))) {
    return {
      carried: 0,
      agentTodos: todayTodos,
      todos: deriveTodoList(todayTodos),
      alreadyHadOpenTodos: true,
    };
  }

  const yesterdayTodos = loadAgentTodos(config, yesterday);
  const carry = yesterdayTodos.filter((todo) => isOpenStatus(todo.status)).map(cloneTodoForCarryover);

  if (carry.length === 0) {
    return {
      carried: 0,
      agentTodos: todayTodos,
      todos: deriveTodoList(todayTodos),
      alreadyHadOpenTodos: false,
    };
  }

  const merged = [...todayTodos, ...carry];
  saveAgentTodos(config, today, merged);

  const loaded = loadAgentTodos(config, today);
  return {
    carried: carry.length,
    agentTodos: loaded,
    todos: deriveTodoList(loaded),
    alreadyHadOpenTodos: false,
  };
}

export function buildCurrentTodoContext(config: Config, now: Date = new Date()): string {
  return buildTodoContextFromAgentTodos(getCurrentAgentTodos(config, now));
}
