export interface DisplayToolCall {
  id: string;
  name: string;
  displayName: string; // "github → search_issues"
  summary: string;     // e.g. "ls -la /foo" for bash, "/path" for read_file
  status: "running" | "done" | "error";
  resultSummary?: string;
}

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: DisplayToolCall[];
  queued?: boolean;
  files?: string[];           // attached file paths for display
  _sendContent?: string;      // enhanced text with file data (internal)
}

export type AppStatus = "idle" | "streaming" | "tool_running";

export interface ActivityInfo {
  startTime: number;      // Date.now() when request started
  outputChars: number;    // characters received (tokens ≈ chars/4)
  lastToolName?: string;  // friendly name of currently running tool, if any
}

export interface ConnectedService {
  name: string;
}
