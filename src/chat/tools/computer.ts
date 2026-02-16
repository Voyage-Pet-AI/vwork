import type { Config } from "../../config.js";
import { runComputerSession } from "../../computer/session.js";
import type { ComputerSessionEvent } from "../../computer/types.js";
import type { LLMProvider, LLMTool, ToolCall } from "../../llm/provider.js";

export interface ComputerToolContext {
  provider?: LLMProvider;
  config?: Config;
  requestComputerApproval?: (input: {
    task: string;
    startUrl?: string;
    maxSteps: number;
  }) => Promise<boolean>;
  registerComputerAbortController?: (controller: AbortController | null) => void;
  onComputerSessionEvent?: (event: ComputerSessionEvent) => void;
}

export const computerTools: LLMTool[] = [
  {
    name: "vwork__computer",
    description:
      "Run the computer-use subagent for interactive browser tasks (click/type/navigate). " +
      "Use this for setup flows and pages that require UI interaction.",
    input_schema: {
      type: "object" as const,
      properties: {
        task: {
          type: "string",
          description: "What the computer subagent should achieve.",
        },
        start_url: {
          type: "string",
          description: "Optional URL where the browser session should begin.",
        },
        max_steps: {
          type: "number",
          description: "Optional maximum steps for this run (capped by config).",
        },
      },
      required: ["task"],
    },
  },
];

function jsonError(code: string, message: string): string {
  return JSON.stringify(
    {
      ok: false,
      summary: "Computer task failed.",
      actions: [],
      artifacts: [],
      visited_urls: [],
      error_code: code,
      error_message: message,
    },
    null,
    2
  );
}

export async function executeComputerTool(
  tc: ToolCall,
  signal?: AbortSignal,
  context?: ComputerToolContext
): Promise<string> {
  if (!context?.provider || !context?.config) {
    return jsonError(
      "COMPUTER_CONTEXT_MISSING",
      "Computer tool requires provider and config context."
    );
  }

  const task = typeof tc.input.task === "string" ? tc.input.task.trim() : "";
  if (!task) {
    return jsonError("INVALID_INPUT", "Input field 'task' is required.");
  }

  const startUrl =
    typeof tc.input.start_url === "string" && tc.input.start_url.trim()
      ? tc.input.start_url.trim()
      : undefined;

  if (!context.config.computer.enabled) {
    return jsonError("COMPUTER_DISABLED", "Computer tool is disabled in config.");
  }

  const requestedSteps =
    Number.isFinite(tc.input.max_steps as number) && (tc.input.max_steps as number) > 0
      ? Math.floor(tc.input.max_steps as number)
      : context.config.computer.max_steps;
  const maxSteps = Math.min(requestedSteps, context.config.computer.max_steps);

  if (context.config.computer.require_session_approval) {
    if (!context.requestComputerApproval) {
      return jsonError(
        "APPROVAL_HANDLER_MISSING",
        "Computer session approval is required but no approval handler is configured."
      );
    }
    const approved = await context.requestComputerApproval({
      task,
      startUrl,
      maxSteps,
    });
    if (!approved) {
      return jsonError("APPROVAL_DENIED", "Computer session was denied by the user.");
    }
  }

  const controller = new AbortController();
  context.registerComputerAbortController?.(controller);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const result = await runComputerSession(
      {
        task,
        start_url: startUrl,
        max_steps: maxSteps,
        max_duration_sec: context.config.computer.max_duration_sec,
      },
      {
        provider: context.provider,
        config: context.config,
        signal: controller.signal,
        onEvent: context.onComputerSessionEvent,
      }
    );
    return JSON.stringify(result, null, 2);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    context.registerComputerAbortController?.(null);
  }
}

