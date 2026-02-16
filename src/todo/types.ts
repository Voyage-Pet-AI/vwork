export type TodoAgentStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type TodoPriority = "high" | "medium" | "low";

export interface AgentTodo {
  id: string;
  content: string;
  status: TodoAgentStatus;
  priority: TodoPriority;
}

export interface TodoList {
  active: AgentTodo[];
  blocked: AgentTodo[];
  completedToday: AgentTodo[];
}

export interface ParsedTodoState {
  date: string;
  todos: AgentTodo[];
  notebookPath: string;
  storePath: string;
}
