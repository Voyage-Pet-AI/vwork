import type { LLMProvider, Message, LLMTool, StreamCallbacks } from "../llm/provider.js";
import type { MCPClientManager } from "../mcp/client.js";
import type { Config } from "../config.js";
import { filterTools } from "../llm/agent.js";
import { getBuiltinTools, executeBuiltinTool } from "./tools/index.js";
import { executeReporterGenerateReportTool } from "./tools/reporter-generate-report.js";
import { buildChatSystemPrompt } from "./prompt.js";
import { error, debug } from "../utils/log.js";
import type { ReportKind, ReportResult } from "../report/types.js";
import type { ComputerSessionEvent } from "../computer/types.js";

const MAX_TOOL_ROUNDS = 20;

export class ChatSession {
  private messages: Message[] = [];
  private systemPrompt: string;
  private tools: LLMTool[];
  private provider: LLMProvider;
  private mcpClient: MCPClientManager;
  private config: Config;
  private customServerNames: string[];
  private computerApprovalHandler?: (input: {
    task: string;
    startUrl?: string;
    maxSteps: number;
  }) => Promise<boolean>;
  private computerEventHandler?: (event: ComputerSessionEvent) => void;
  private activeComputerAbortController: AbortController | null = null;

  constructor(
    provider: LLMProvider,
    mcpClient: MCPClientManager,
    config: Config,
    customServerNames: string[]
  ) {
    this.provider = provider;
    this.mcpClient = mcpClient;
    this.config = config;
    this.customServerNames = customServerNames;

    // Combine MCP tools (filtered) + built-in file tools
    const mcpTools = filterTools(mcpClient.getAllTools());
    const builtinTools = getBuiltinTools();
    this.tools = [...mcpTools, ...builtinTools];

    this.systemPrompt = buildChatSystemPrompt(config, customServerNames);
  }

  /** Clear conversation history. */
  clear(): void {
    this.messages = [];
  }

  getModel(): string {
    return this.provider.model;
  }

  setModel(model: string): void {
    this.provider.setModel(model);
  }

  setProvider(provider: LLMProvider): void {
    this.provider = provider;
    this.messages = [];
  }

  getProviderName(): string {
    return this.provider.providerName;
  }

  setComputerApprovalHandler(
    handler?: (input: { task: string; startUrl?: string; maxSteps: number }) => Promise<boolean>
  ): void {
    this.computerApprovalHandler = handler;
  }

  setComputerEventHandler(handler?: (event: ComputerSessionEvent) => void): void {
    this.computerEventHandler = handler;
  }

  abortComputerSession(): void {
    this.activeComputerAbortController?.abort();
  }

  async runReportToolDirect(
    input: {
      kind: ReportKind;
      lookback_days: number;
      prompt: string;
      save: boolean;
      source: "chat" | "cli" | "schedule";
      schedule_name?: string;
    }
  ): Promise<ReportResult> {
    const raw = await executeReporterGenerateReportTool(input, {
      provider: this.provider,
      mcpClient: this.mcpClient,
      config: this.config,
      customServerNames: this.customServerNames,
    });

    const parsed = JSON.parse(raw) as {
      content: string;
      saved_path: string | null;
      save_error: string | null;
      run_id: string;
      kind: ReportKind;
      lookback_days: number;
    };

    this.messages.push({ role: "user", content: input.prompt });
    this.messages.push({
      role: "assistant",
      content: [{ type: "text", text: parsed.content }],
    });

    return {
      content: parsed.content,
      savedPath: parsed.saved_path ?? undefined,
      saveError: parsed.save_error ?? undefined,
      runId: parsed.run_id,
      kind: parsed.kind,
      lookbackDays: parsed.lookback_days,
    };
  }

  async postProcessReport(
    report: ReportResult,
    signal?: AbortSignal
  ): Promise<string> {
    const prompt = [
      "Rephrase this for the user in 3-5 concise bullets.",
      "Do not change facts.",
      report.savedPath ? `Saved path: ${report.savedPath}` : "Saved path: not saved.",
      "",
      "Report content:",
      report.content,
    ].join("\n");

    const response = await this.provider.chatStream(
      this.systemPrompt,
      [{ role: "user", content: prompt }],
      [],
      {
        onText: () => {},
        onToolStart: () => {},
        onToolEnd: () => {},
        onComplete: () => {},
        onError: () => {},
      },
      signal
    );
    return response.text.trim();
  }

  /** Send a user message and stream the response. Handles tool call loops internally. */
  async send(userMessage: string, callbacks: StreamCallbacks, signal?: AbortSignal): Promise<void> {
    this.messages.push({ role: "user", content: userMessage });

    let partialText = "";
    const wrappedCallbacks: StreamCallbacks = {
      ...callbacks,
      onText: (delta: string) => {
        partialText += delta;
        callbacks.onText(delta);
      },
    };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (signal?.aborted) return;

      debug(`Chat round ${round + 1}/${MAX_TOOL_ROUNDS}`);

      let response;
      try {
        response = await this.provider.chatStream(
          this.systemPrompt,
          this.messages,
          this.tools,
          wrappedCallbacks,
          signal
        );
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          // Save partial response to history so context isn't lost
          if (partialText) {
            this.messages.push({
              role: "assistant",
              content: [{ type: "text", text: partialText + "\n[aborted]" }],
            });
          }
          return;
        }
        throw e;
      }

      partialText = ""; // Reset for next round

      // Always append assistant message to history
      this.messages.push(this.provider.makeAssistantMessage(response));

      // If no tool calls, we're done
      if (response.stop_reason === "end_turn" || response.tool_calls.length === 0) {
        return;
      }

      // Execute tool calls
      const results = await Promise.all(
        response.tool_calls.map(async (tc) => {
          if (signal?.aborted) {
            return { tool_use_id: tc.id, content: "Aborted", is_error: true as const };
          }
          callbacks.onToolStart(tc);
          try {
            let result: string;
            if (tc.name.startsWith("reporter__")) {
              result = await executeBuiltinTool(tc, signal, {
                provider: this.provider,
                mcpClient: this.mcpClient,
                config: this.config,
                customServerNames: this.customServerNames,
                requestComputerApproval: this.computerApprovalHandler,
                registerComputerAbortController: (controller) => {
                  this.activeComputerAbortController = controller;
                },
                onComputerSessionEvent: this.computerEventHandler,
              });
            } else {
              const raw = await this.mcpClient.callTool(tc.name, tc.input);
              result = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
            }
            callbacks.onToolEnd(tc, result, false);
            return { tool_use_id: tc.id, content: result };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            error(`Tool ${tc.name} failed: ${msg}`);
            callbacks.onToolEnd(tc, `Error: ${msg}`, true);
            return { tool_use_id: tc.id, content: `Error: ${msg}`, is_error: true as const };
          }
        })
      );

      if (signal?.aborted) return;

      this.messages.push(this.provider.makeToolResultMessage(results));
      // Loop continues — next iteration streams the next LLM response
    }

    error("Max tool rounds reached in chat");
  }
}
