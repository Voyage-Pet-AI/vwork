import OpenAI from "openai";
import type {
  LLMProvider,
  LLMTool,
  LLMResponse,
  Message,
  ToolResult,
  ToolCall,
  StreamCallbacks,
} from "./provider.js";
import type { Config } from "../config.js";
import { resolveSecret } from "../config.js";
import { loadStoredOpenAIAuth, refreshOpenAIToken } from "../auth/openai.js";

const CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";

type AuthMode = "codex" | "apikey";

// --- Message types for OpenAI format ---

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  tool_call_id?: string;
}

export class OpenAIProvider implements LLMProvider {
  readonly providerName = "openai";
  private client: OpenAI;
  model: string;
  private authMode: AuthMode;
  private accountId: string;

  constructor(config: Config) {
    this.model = config.llm.model;
    this.accountId = "";

    // Auth precedence: Stored OAuth (Codex) → config api_key_env → error
    const oauthTokens = loadStoredOpenAIAuth();
    if (oauthTokens) {
      this.authMode = "codex";
      this.accountId = oauthTokens.account_id;

      // Custom fetch that rewrites to Codex endpoint
      const accountId = oauthTokens.account_id;
      const accessToken = oauthTokens.access_token;
      this.client = new OpenAI({
        apiKey: "codex-placeholder",
        fetch: (url: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = typeof url === "string" ? url : url.toString();
          let targetUrl = urlStr;
          if (urlStr.includes("/chat/completions")) {
            targetUrl = CODEX_URL;
          }
          const headers = new Headers(init?.headers);
          headers.set("Authorization", `Bearer ${accessToken}`);
          if (accountId) {
            headers.set("ChatGPT-Account-Id", accountId);
          }
          return globalThis.fetch(targetUrl, { ...init, headers });
        },
      });
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
      `  Run "reporter login openai" for ChatGPT Pro/Plus OAuth (recommended)\n` +
      `  Or set api_key_env in config / OPENAI_API_KEY env var`
    );
  }

  setModel(model: string): void {
    this.model = model;
  }

  private async ensureFreshToken(): Promise<void> {
    if (this.authMode !== "codex") return;

    const fresh = await refreshOpenAIToken();
    if (fresh) {
      this.accountId = fresh.account_id;
      const accountId = fresh.account_id;
      const accessToken = fresh.access_token;
      this.client = new OpenAI({
        apiKey: "codex-placeholder",
        fetch: (url: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = typeof url === "string" ? url : url.toString();
          let targetUrl = urlStr;
          if (urlStr.includes("/chat/completions")) {
            targetUrl = CODEX_URL;
          }
          const headers = new Headers(init?.headers);
          headers.set("Authorization", `Bearer ${accessToken}`);
          if (accountId) {
            headers.set("ChatGPT-Account-Id", accountId);
          }
          return globalThis.fetch(targetUrl, { ...init, headers });
        },
      });
    }
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

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: LLMTool[]
  ): Promise<LLMResponse> {
    await this.ensureFreshToken();

    const openaiTools = this.convertTools(tools);
    const openaiMessages = this.flattenMessages(systemPrompt, messages);

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 16384,
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

    const openaiTools = this.convertTools(tools);
    const openaiMessages = this.flattenMessages(systemPrompt, messages);

    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 16384,
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

    // Map OpenAI finish_reason to Reporter's stop_reason
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
}
