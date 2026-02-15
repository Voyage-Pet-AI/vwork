import type { LLMProvider, Message, LLMTool, StreamCallbacks } from "../llm/provider.js";
import type { MCPClientManager } from "../mcp/client.js";
import type { Config } from "../config.js";
import { filterTools } from "../llm/agent.js";
import { getFileTools, executeFileTool } from "./tools.js";
import { buildChatSystemPrompt } from "./prompt.js";
import { error, debug } from "../utils/log.js";

const MAX_TOOL_ROUNDS = 20;

export class ChatSession {
  private messages: Message[] = [];
  private systemPrompt: string;
  private tools: LLMTool[];
  private provider: LLMProvider;
  private mcpClient: MCPClientManager;

  constructor(
    provider: LLMProvider,
    mcpClient: MCPClientManager,
    config: Config,
    customServerNames: string[]
  ) {
    this.provider = provider;
    this.mcpClient = mcpClient;

    // Combine MCP tools (filtered) + built-in file tools
    const mcpTools = filterTools(mcpClient.getAllTools());
    const fileTools = getFileTools();
    this.tools = [...mcpTools, ...fileTools];

    this.systemPrompt = buildChatSystemPrompt(config, customServerNames);
  }

  /** Clear conversation history. */
  clear(): void {
    this.messages = [];
  }

  /** Send a user message and stream the response. Handles tool call loops internally. */
  async send(userMessage: string, callbacks: StreamCallbacks): Promise<void> {
    this.messages.push({ role: "user", content: userMessage });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      debug(`Chat round ${round + 1}/${MAX_TOOL_ROUNDS}`);

      const response = await this.provider.chatStream(
        this.systemPrompt,
        this.messages,
        this.tools,
        callbacks
      );

      // Always append assistant message to history
      this.messages.push(this.provider.makeAssistantMessage(response));

      // If no tool calls, we're done
      if (response.stop_reason === "end_turn" || response.tool_calls.length === 0) {
        return;
      }

      // Execute tool calls
      const results = await Promise.all(
        response.tool_calls.map(async (tc) => {
          callbacks.onToolStart(tc);
          try {
            let result: string;
            if (tc.name.startsWith("reporter__")) {
              result = await executeFileTool(tc);
            } else {
              const raw = await this.mcpClient.callTool(tc.name, tc.input);
              result = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
            }
            callbacks.onToolEnd(tc);
            return { tool_use_id: tc.id, content: result };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            error(`Tool ${tc.name} failed: ${msg}`);
            callbacks.onToolEnd(tc);
            return { tool_use_id: tc.id, content: `Error: ${msg}`, is_error: true as const };
          }
        })
      );

      this.messages.push(this.provider.makeToolResultMessage(results));
      // Loop continues — next iteration streams the next LLM response
    }

    error("Max tool rounds reached in chat");
  }
}
