export interface DisplayToolCall {
  id: string;
  name: string;
  displayName: string; // "github → search_issues"
  summary: string;     // e.g. "ls -la /foo" for bash, "/path" for read_file
  status: "running" | "done" | "error";
  resultSummary?: string;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolCall: DisplayToolCall };

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  blocks: ContentBlock[];       // chronologically ordered
  queued?: boolean;
  files?: string[];           // attached file paths for display
  _sendContent?: string;      // enhanced text with file data (internal)
}

/** Extract concatenated text content from a message's blocks. */
export function getTextContent(msg: DisplayMessage): string {
  return msg.blocks
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Extract all tool calls from a message's blocks. */
export function getToolCalls(msg: DisplayMessage): DisplayToolCall[] {
  return msg.blocks
    .filter((b): b is Extract<ContentBlock, { type: "tool_call" }> => b.type === "tool_call")
    .map((b) => b.toolCall);
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
