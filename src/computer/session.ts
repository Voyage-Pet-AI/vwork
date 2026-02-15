import type { Config } from "../config.js";
import type { LLMProvider } from "../llm/provider.js";
import { debug, log } from "../utils/log.js";
import { redactRunResult, redactSecrets } from "./audit.js";
import { validateComputerUrlPolicy } from "./policy.js";
import type {
  ComputerRunResult,
  ComputerSessionEvent,
  ComputerTaskInput,
} from "./types.js";

export interface RunComputerSessionOptions {
  provider: LLMProvider;
  config: Config;
  signal?: AbortSignal;
  onEvent?: (event: ComputerSessionEvent) => void;
}

function makeSessionId(): string {
  return `computer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function emit(
  sessionId: string,
  event: Omit<ComputerSessionEvent, "sessionId" | "timestamp">,
  onEvent?: (event: ComputerSessionEvent) => void
): void {
  const withMeta: ComputerSessionEvent = {
    ...event,
    sessionId,
    timestamp: new Date().toISOString(),
  };
  onEvent?.(withMeta);
  log(JSON.stringify(withMeta));
}

export async function runComputerSession(
  input: ComputerTaskInput,
  options: RunComputerSessionOptions
): Promise<ComputerRunResult> {
  const sessionId = makeSessionId();
  const caps = options.provider.getComputerUseCapabilities();
  const startedAt = Date.now();

  emit(
    sessionId,
    {
      type: "computer_session_start",
      message: `Starting computer session: ${redactSecrets(input.task)}`,
      maxSteps: input.max_steps,
    },
    options.onEvent
  );

  if (!caps.supported) {
    const reason = caps.reason ?? "Provider/model does not support computer use.";
    const unsupported: ComputerRunResult = {
      ok: false,
      summary: "Computer use unavailable for current provider/model.",
      actions: [],
      artifacts: [],
      visited_urls: [],
      error_code: "COMPUTER_USE_UNSUPPORTED",
      error_message: reason,
    };
    emit(
      sessionId,
      {
        type: "computer_session_end",
        message: `Computer session failed fast: ${reason}`,
      },
      options.onEvent
    );
    return unsupported;
  }

  const policy = {
    allowDomains: options.config.computer.allow_domains,
    blockDomains: options.config.computer.block_domains,
  };

  if (input.start_url) {
    const check = validateComputerUrlPolicy(input.start_url, policy);
    if (!check.ok) {
      const blocked: ComputerRunResult = {
        ok: false,
        summary: "Computer session blocked by policy before start.",
        actions: [],
        artifacts: [],
        visited_urls: [input.start_url],
        error_code: check.code ?? "POLICY_BLOCKED",
        error_message: check.message ?? "Blocked by policy.",
      };
      emit(
        sessionId,
        {
          type: "computer_policy_block",
          message: blocked.error_message ?? "Blocked by policy.",
          url: input.start_url,
        },
        options.onEvent
      );
      emit(
        sessionId,
        {
          type: "computer_session_end",
          message: "Computer session ended: policy block.",
        },
        options.onEvent
      );
      return blocked;
    }
  }

  const timeoutMs = input.max_duration_sec * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const result = await options.provider.runComputerUseTask(
      {
        task: input.task,
        startUrl: input.start_url,
        maxSteps: input.max_steps,
        maxDurationSec: input.max_duration_sec,
      },
      controller.signal
    );

    const redacted = redactRunResult({
      ok: result.ok,
      summary: result.summary,
      actions: result.actions.map((a) => ({
        type: a.type,
        timestamp: a.timestamp,
        url: a.url,
        detail: a.detail,
      })),
      artifacts: result.artifacts.map((a) => ({
        type: a.type,
        path: a.path,
        label: a.label,
      })),
      visited_urls: result.visitedUrls,
      error_code: result.errorCode,
      error_message: result.errorMessage,
    });

    for (let i = 0; i < redacted.actions.length; i++) {
      const action = redacted.actions[i];
      emit(
        sessionId,
        {
          type: "computer_action",
          message: action.detail ?? action.type,
          url: action.url,
          step: i + 1,
          maxSteps: input.max_steps,
        },
        options.onEvent
      );
    }

    emit(
      sessionId,
      {
        type: "computer_session_end",
        message: `Computer session completed in ${Date.now() - startedAt}ms`,
      },
      options.onEvent
    );

    return redacted;
  } catch (e) {
    const aborted = controller.signal.aborted;
    const msg = e instanceof Error ? e.message : String(e);
    const failure: ComputerRunResult = {
      ok: false,
      summary: aborted ? "Computer session aborted." : "Computer session failed.",
      actions: [],
      artifacts: [],
      visited_urls: [],
      error_code: aborted ? "COMPUTER_SESSION_ABORTED" : "COMPUTER_SESSION_FAILED",
      error_message: msg,
    };
    emit(
      sessionId,
      {
        type: "computer_session_end",
        message: failure.summary,
      },
      options.onEvent
    );
    debug(`computer session error: ${msg}`);
    return redactRunResult(failure);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

