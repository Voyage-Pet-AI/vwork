export type TodoStatus = "active" | "blocked" | "done";

export interface Todo {
  id: string;
  title: string;
  tags: string[];
  status: TodoStatus;
  description?: string;
  note?: string;
  lineNumber?: number;
}

export interface TodoList {
  active: Todo[];
  blocked: Todo[];
  completedToday: Todo[];
}

export interface NotebookMeta {
  date: string;
  path: string;
}

export interface ParsedNotebook {
  todos: TodoList;
  renderedMarkdown: string;
}
