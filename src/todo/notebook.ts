import type { AgentTodo, TodoList } from "./types.js";
import {
  buildTodoContextFromAgentTodos,
  deriveTodoList,
  formatDate,
  getNotebookPathForDate,
  getYesterdayDate,
  loadAgentTodos,
  parseDate,
  projectNotebookMarkdown,
  saveAgentTodos,
  syncNotebookFromStore,
} from "./store.js";

export {
  buildTodoContextFromAgentTodos,
  deriveTodoList,
  formatDate,
  getNotebookPathForDate,
  getYesterdayDate,
  loadAgentTodos,
  parseDate,
  projectNotebookMarkdown,
  saveAgentTodos,
  syncNotebookFromStore,
};

export function buildTodoContext(todos: TodoList): string {
  const asAgent: AgentTodo[] = [
    ...todos.active,
    ...todos.blocked,
    ...todos.completedToday,
  ];
  return buildTodoContextFromAgentTodos(asAgent);
}
