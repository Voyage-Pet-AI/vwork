export interface DisplayToolCall {
  id: string;
  name: string;
  displayName: string;
  summary: string;
  status: "running" | "done" | "error";
  resultSummary?: string;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolCall: DisplayToolCall };

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  blocks: ContentBlock[];
}

export type AppStatus = "idle" | "streaming" | "tool_running";

// API response types
export interface AuthStatus {
  services: Record<string, { connected: boolean }>;
}

export interface Schedule {
  name: string;
  prompt: string;
  cron: string;
  frequencyLabel: string;
  createdAt: string;
}

export interface AgentTodo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
}
