import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  LLMTool,
  LLMResponse,
  Message,
  ToolResult,
  ToolCall,
} from "./provider.js";
import type { Config } from "../config.js";
import { resolveSecret } from "../config.js";
import {
  loadStoredAnthropicOAuth,
  loadStoredAnthropicKey,
  refreshAnthropicOAuth,
} from "../auth/anthropic.js";

type AuthMode = "oauth" | "key" | "config";

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;
  private authMode: AuthMode;

  constructor(config: Config) {
    this.model = config.llm.model;

    // Auth precedence: Pro/Max OAuth → OAuth-created API key → config api_key_env
    const oauthTokens = loadStoredAnthropicOAuth();
    if (oauthTokens) {
      this.authMode = "oauth";
      this.client = new Anthropic({
        authToken: oauthTokens.access_token,
        defaultHeaders: {
          "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14",
        },
      });
      return;
    }

    const storedKey = loadStoredAnthropicKey();
    if (storedKey) {
      this.authMode = "key";
      this.client = new Anthropic({ apiKey: storedKey });
      return;
    }

    if (config.llm.api_key_env) {
      const apiKey = resolveSecret(config.llm.api_key_env);
      if (apiKey) {
        this.authMode = "config";
        this.client = new Anthropic({ apiKey });
        return;
      }
    }

    throw new Error(
      `No Anthropic auth configured.\n` +
      `  Run "reporter login anthropic" for browser-based OAuth (recommended)\n` +
      `  Or set api_key_env in config / ANTHROPIC_API_KEY env var`
    );
  }

  private async ensureFreshToken(): Promise<void> {
    if (this.authMode !== "oauth") return;

    const freshToken = await refreshAnthropicOAuth();
    if (freshToken) {
      // Recreate client with fresh token
      this.client = new Anthropic({
        authToken: freshToken,
        defaultHeaders: {
          "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14",
        },
      });
    }
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: LLMTool[]
  ): Promise<LLMResponse> {
    await this.ensureFreshToken();

    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16384,
      system: systemPrompt,
      messages: messages as Anthropic.MessageParam[],
      tools: anthropicTools,
    });

    // Extract text and tool calls from response
    let text = "";
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      stop_reason: response.stop_reason ?? "end_turn",
      text,
      tool_calls: toolCalls,
    };
  }

  makeAssistantMessage(response: LLMResponse): Message {
    const content: Anthropic.ContentBlockParam[] = [];

    if (response.text) {
      content.push({ type: "text" as const, text: response.text });
    }

    for (const tc of response.tool_calls) {
      content.push({
        type: "tool_use" as const,
        id: tc.id,
        name: tc.name,
        input: tc.input,
      });
    }

    return { role: "assistant", content };
  }

  makeToolResultMessage(results: ToolResult[]): Message {
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
