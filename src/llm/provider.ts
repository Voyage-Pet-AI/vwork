// BYOK provider interface.
// Start with Anthropic. Add more when needed. Don't over-abstract.

export interface LLMTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMResponse {
  // "end_turn" means the model is done. "tool_use" means it wants to call tools.
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | string;
  text: string;
  tool_calls: ToolCall[];
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface Message {
  role: "user" | "assistant";
  content: unknown; // provider-specific content shape
}

export interface StreamCallbacks {
  onText: (delta: string) => void;
  onToolStart: (toolCall: ToolCall) => void;
  onToolEnd: (toolCall: ToolCall, result: string, isError?: boolean) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

export interface LLMProvider {
  chat(
    systemPrompt: string,
    messages: Message[],
    tools: LLMTool[]
  ): Promise<LLMResponse>;

  chatStream(
    systemPrompt: string,
    messages: Message[],
    tools: LLMTool[],
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<LLMResponse>;

  // Build the appropriate message types for the provider
  makeAssistantMessage(response: LLMResponse): Message;
  makeToolResultMessage(results: ToolResult[]): Message;
}
