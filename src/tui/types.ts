export interface DisplayToolCall {
  id: string;
  name: string;
  displayName: string; // "github → search_issues"
  status: "running" | "done" | "error";
}

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: DisplayToolCall[];
  queued?: boolean;
}

export type AppStatus = "idle" | "streaming" | "tool_running";

export interface ConnectedService {
  name: string;
}
