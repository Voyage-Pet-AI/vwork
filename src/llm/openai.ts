import OpenAI from "openai";
import type {
  LLMProvider,
  LLMTool,
  LLMResponse,
  Message,
  ToolResult,
  ToolCall,
  StreamCallbacks,
  ComputerUseCapabilities,
  ComputerUseTask,
  ComputerUseTaskResult,
} from "./provider.js";
import type { Config } from "../config.js";
import { resolveSecret } from "../config.js";
import { loadStoredOpenAIAuth, refreshOpenAIToken } from "../auth/openai.js";

// --- Message types for OpenAI format ---
const CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_REQUIRED_SYSTEM_PROMPT =
  "You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's machine.";

type AuthMode = "oauth" | "apikey";

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  tool_call_id?: string;
}

interface OAuthInputMessage {
  role: "user" | "assistant";
  content: Array<{ type: "input_text" | "output_text"; text: string }>;
}

interface OAuthFunctionCallOutput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

interface OAuthFunctionCallInput {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

type OAuthInputItem = OAuthInputMessage | OAuthFunctionCallOutput | OAuthFunctionCallInput;

export class OpenAIProvider implements LLMProvider {
  readonly providerName = "openai";
  private client: OpenAI;
  model: string;
  private authMode: AuthMode;
  private accountId: string;
  private oauthAccessToken: string;

  constructor(config: Config) {
    this.model = config.llm.model;
    this.accountId = "";
    this.oauthAccessToken = "";

    // Auth precedence: OpenAI OAuth (Codex) → config api_key_env.
    const oauthTokens = loadStoredOpenAIAuth();
    if (oauthTokens) {
      this.authMode = "oauth";
      this.accountId = oauthTokens.account_id;
      this.oauthAccessToken = oauthTokens.access_token;
      this.client = this.createOAuthClient(
        oauthTokens.access_token,
        oauthTokens.account_id,
      );
      return;
    }

    if (config.llm.api_key_env) {
      const apiKey = resolveSecret(config.llm.api_key_env);
      if (apiKey) {
        this.authMode = "apikey";
        this.client = new OpenAI({ apiKey });
        return;
      }
    }

    throw new Error(
      `No OpenAI auth configured.\n` +
      `  Run "vwork login openai" for ChatGPT Pro/Plus OAuth (recommended)\n` +
      `  Or set api_key_env in config / OPENAI_API_KEY env var`
    );
  }

  setModel(model: string): void {
    this.model = model;
  }

  private createOAuthClient(accessToken: string, accountId: string): OpenAI {
    return new OpenAI({
      apiKey: "oauth-placeholder",
      fetch: (url: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl = typeof url === "string" ? url : url.toString();
        let targetUrl = requestUrl;
        if (requestUrl.includes("/chat/completions") || requestUrl.includes("/v1/responses")) {
          targetUrl = CODEX_URL;
        }

        const headers = new Headers(init?.headers);
        headers.delete("authorization");
        headers.delete("Authorization");
        headers.set("authorization", `Bearer ${accessToken}`);
        if (accountId) {
          headers.set("ChatGPT-Account-Id", accountId);
        }

        return globalThis.fetch(targetUrl, {
          ...init,
          headers,
        });
      },
    });
  }

  private withOAuthSystemPrompt(systemPrompt: string): string {
    if (this.authMode !== "oauth") return systemPrompt;
    if (systemPrompt.includes(CODEX_REQUIRED_SYSTEM_PROMPT)) return systemPrompt;
    return `${CODEX_REQUIRED_SYSTEM_PROMPT}\n\n${systemPrompt}`;
  }

  private async ensureFreshToken(): Promise<void> {
    if (this.authMode !== "oauth") return;

    const fresh = await refreshOpenAIToken();
    if (!fresh) return;

    this.accountId = fresh.account_id;
    this.oauthAccessToken = fresh.access_token;
    this.client = this.createOAuthClient(fresh.access_token, fresh.account_id);
  }

  private convertTools(tools: LLMTool[]): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: t.input_schema,
      },
    }));
  }

  private flattenMessages(systemPrompt: string, messages: Message[]): OpenAIMessage[] {
    const result: OpenAIMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    for (const msg of messages) {
      if (msg.role === "user") {
        // User messages: could be a string or an array with tool_result items
        if (typeof msg.content === "string") {
          result.push({ role: "user", content: msg.content });
        } else if (Array.isArray(msg.content)) {
          // Tool results — spread into individual tool messages
          for (const item of msg.content as Array<{ type: string; tool_call_id?: string; tool_use_id?: string; content: string }>) {
            if (item.type === "tool_result") {
              result.push({
                role: "tool",
                tool_call_id: item.tool_use_id ?? item.tool_call_id ?? "",
                content: item.content,
              });
            }
          }
        }
      } else if (msg.role === "assistant") {
        // Assistant messages with potential tool_calls
        const content = msg.content as OpenAIMessage;
        if (content && typeof content === "object" && "tool_calls" in content) {
          result.push(content);
        } else if (typeof msg.content === "string") {
          result.push({ role: "assistant", content: msg.content });
        } else {
          // Push as-is (already shaped correctly by makeAssistantMessage)
          result.push(msg.content as OpenAIMessage);
        }
      }
    }

    return result;
  }

  private buildOAuthInput(messages: Message[]): OAuthInputItem[] {
    const input: OAuthInputItem[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        if (typeof msg.content === "string") {
          input.push({
            role: "user",
            content: [{ type: "input_text", text: msg.content }],
          });
          continue;
        }
        if (Array.isArray(msg.content)) {
          for (const item of msg.content as Array<{ type: string; tool_use_id?: string; tool_call_id?: string; content: string }>) {
            if (item.type !== "tool_result") continue;
            const callId = item.tool_use_id ?? item.tool_call_id ?? "";
            if (!callId) continue;
            input.push({
              type: "function_call_output",
              call_id: callId,
              output: item.content,
            });
          }
        }
        continue;
      }

      if (msg.role === "assistant") {
        if (typeof msg.content === "string") {
          input.push({
            role: "assistant",
            content: [{ type: "output_text", text: msg.content }],
          });
          continue;
        }

        const content = msg.content as OpenAIMessage;
        if (content?.content) {
          input.push({
            role: "assistant",
            content: [{ type: "output_text", text: content.content }],
          });
        }
        if (content?.tool_calls) {
          for (const toolCall of content.tool_calls) {
            if (toolCall.type !== "function") continue;
            input.push({
              type: "function_call",
              call_id: toolCall.id,
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            });
          }
        }
      }
    }

    return input;
  }

  private async oauthChat(
    systemPrompt: string,
    messages: Message[],
    tools: LLMTool[],
    callbacks?: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    const oauthTools = tools.map((t) => ({
      type: "function" as const,
      name: t.name,
      description: t.description ?? "",
      parameters: t.input_schema,
    }));

    const body = {
      model: this.model,
      instructions: this.withOAuthSystemPrompt(systemPrompt),
      input: this.buildOAuthInput(messages),
      tools: oauthTools,
      store: false,
      stream: true,
    };

    const headers = new Headers({
      "content-type": "application/json",
      authorization: `Bearer ${this.oauthAccessToken}`,
    });
    if (this.accountId) {
      headers.set("ChatGPT-Account-Id", this.accountId);
    }

    const response = await globalThis.fetch(CODEX_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new Error(
        text
          ? `OpenAI Codex request failed (${response.status}): ${text}`
          : `OpenAI Codex request failed (${response.status})`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    const toolCalls: ToolCall[] = [];

    const consumeEvent = (chunk: string) => {
      let eventName = "";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data || data === "[DONE]") return;

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(data) as Record<string, unknown>;
      } catch {
        return;
      }

      if (eventName === "response.output_text.delta") {
        const delta = typeof payload.delta === "string" ? payload.delta : "";
        if (!delta) return;
        text += delta;
        callbacks?.onText(delta);
        return;
      }

      if (eventName === "response.completed") {
        const completed = payload.response as { output?: Array<Record<string, unknown>> } | undefined;
        for (const item of completed?.output ?? []) {
          if (item.type !== "function_call") continue;
          const id = String(item.call_id ?? "");
          const name = String(item.name ?? "");
          const rawArgs = String(item.arguments ?? "{}");
          if (!id || !name) continue;
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(rawArgs);
          } catch {}
          toolCalls.push({ id, name, input: parsed });
        }
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf("\n\n");
        while (idx >= 0) {
          const eventChunk = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (eventChunk) consumeEvent(eventChunk);
          idx = buffer.indexOf("\n\n");
        }
      }
      if (buffer.trim()) consumeEvent(buffer.trim());
    } catch (e) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const err = e instanceof Error ? e : new Error(String(e));
      callbacks?.onError(err);
      throw err;
    }

    callbacks?.onComplete();
    return { stop_reason: toolCalls.length > 0 ? "tool_use" : "end_turn", text, tool_calls: toolCalls };
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: LLMTool[]
  ): Promise<LLMResponse> {
    await this.ensureFreshToken();
    if (this.authMode === "oauth") {
      return this.oauthChat(systemPrompt, messages, tools);
    }

    const openaiTools = this.convertTools(tools);
    const openaiMessages = this.flattenMessages(
      this.withOAuthSystemPrompt(systemPrompt),
      messages,
    );

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 16384,
      ...(this.authMode === "oauth" ? { store: false } : {}),
      messages: openaiMessages as OpenAI.Chat.ChatCompletionMessageParam[],
      tools: openaiTools.length > 0 ? openaiTools : undefined,
    });

    return this.parseResponse(response);
  }

  async chatStream(
    systemPrompt: string,
    messages: Message[],
    tools: LLMTool[],
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<LLMResponse> {
    await this.ensureFreshToken();
    if (this.authMode === "oauth") {
      return this.oauthChat(systemPrompt, messages, tools, callbacks, signal);
    }

    const openaiTools = this.convertTools(tools);
    const openaiMessages = this.flattenMessages(
      this.withOAuthSystemPrompt(systemPrompt),
      messages,
    );

    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 16384,
      ...(this.authMode === "oauth" ? { store: false } : {}),
      messages: openaiMessages as OpenAI.Chat.ChatCompletionMessageParam[],
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      stream: true,
    });

    let text = "";
    const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      for await (const chunk of stream) {
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Text content
        if (delta.content) {
          text += delta.content;
          callbacks.onText(delta.content);
        }

        // Tool calls (streamed incrementally)
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallsMap.has(idx)) {
              toolCallsMap.set(idx, {
                id: tc.id ?? "",
                name: tc.function?.name ?? "",
                arguments: "",
              });
            }
            const existing = toolCallsMap.get(idx)!;
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          }
        }
      }
    } catch (e) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const err = e instanceof Error ? e : new Error(String(e));
      callbacks.onError(err);
      throw err;
    }

    callbacks.onComplete();

    const toolCalls: ToolCall[] = [];
    for (const [, tc] of toolCallsMap) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.arguments || "{}");
      } catch {}
      toolCalls.push({ id: tc.id, name: tc.name, input });
    }

    const stopReason = toolCalls.length > 0 ? "tool_use" : "end_turn";

    return { stop_reason: stopReason, text, tool_calls: toolCalls };
  }

  private parseResponse(response: OpenAI.Chat.ChatCompletion): LLMResponse {
    const choice = response.choices[0];
    const message = choice?.message;

    const text = message?.content ?? "";
    const toolCalls: ToolCall[] = [];

    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.type !== "function") continue;
        const fn = tc as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(fn.function.arguments || "{}");
        } catch {}
        toolCalls.push({
          id: fn.id,
          name: fn.function.name,
          input,
        });
      }
    }

    // Map OpenAI finish_reason to VWork's stop_reason
    const finishReason = choice?.finish_reason;
    let stopReason: string;
    if (finishReason === "tool_calls") {
      stopReason = "tool_use";
    } else if (finishReason === "stop") {
      stopReason = "end_turn";
    } else {
      stopReason = finishReason ?? "end_turn";
    }

    return { stop_reason: stopReason, text, tool_calls: toolCalls };
  }

  makeAssistantMessage(response: LLMResponse): Message {
    const openaiToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] = response.tool_calls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.input),
      },
    }));

    const msg: OpenAIMessage = {
      role: "assistant",
      content: response.text || null,
      ...(openaiToolCalls.length > 0 ? { tool_calls: openaiToolCalls } : {}),
    };

    return { role: "assistant", content: msg };
  }

  makeToolResultMessage(results: ToolResult[]): Message {
    // OpenAI expects individual tool messages — we store them as an array
    // and flattenMessages() will spread them out
    return {
      role: "user",
      content: results.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.tool_use_id,
        content: r.content,
        is_error: r.is_error ?? false,
      })),
    };
  }

  getComputerUseCapabilities(): ComputerUseCapabilities {
    return {
      supported: false,
      reason:
        `OpenAI computer-use execution is not yet enabled in VWork for model "${this.model}".`,
    };
  }

  async runComputerUseTask(
    _task: ComputerUseTask,
    _signal?: AbortSignal
  ): Promise<ComputerUseTaskResult> {
    throw new Error(
      `Computer use is unavailable for provider "${this.providerName}" on model "${this.model}".`
    );
  }
}
