import { describe, expect, test } from "bun:test";
import type { Config } from "../../config.js";
import type {
  ComputerUseCapabilities,
  ComputerUseTask,
  ComputerUseTaskResult,
  LLMProvider,
  LLMResponse,
  LLMTool,
  Message,
  StreamCallbacks,
  ToolResult,
} from "../../llm/provider.js";
import { executeComputerTool } from "./computer.js";

class MockProvider implements LLMProvider {
  readonly providerName = "openai";
  model = "test-model";

  setModel(model: string): void {
    this.model = model;
  }

  async chat(_s: string, _m: Message[], _t: LLMTool[]): Promise<LLMResponse> {
    return { stop_reason: "end_turn", text: "", tool_calls: [] };
  }

  async chatStream(
    _s: string,
    _m: Message[],
    _t: LLMTool[],
    _c: StreamCallbacks
  ): Promise<LLMResponse> {
    return { stop_reason: "end_turn", text: "", tool_calls: [] };
  }

  makeAssistantMessage(_response: LLMResponse): Message {
    return { role: "assistant", content: "" };
  }

  makeToolResultMessage(_results: ToolResult[]): Message {
    return { role: "user", content: "" };
  }

  getComputerUseCapabilities(): ComputerUseCapabilities {
    return { supported: false, reason: "unsupported in test" };
  }

  async runComputerUseTask(_task: ComputerUseTask): Promise<ComputerUseTaskResult> {
    return {
      ok: true,
      summary: "done",
      actions: [],
      artifacts: [],
      visitedUrls: [],
    };
  }
}

const baseConfig: Config = {
  llm: { provider: "openai", model: "gpt-5.2-codex" },
  github: { enabled: false, orgs: [] },
  jira: { enabled: false, url: "https://example.com" },
  slack: { enabled: false, channels: [] },
  report: { lookback_days: 1, output_dir: "~/reporter/reports", memory_depth: 5 },
  chat: { report_postprocess_enabled: false, report_inbox_replay_limit: 20 },
  todo: {
    enabled: true,
    notebook_dir: "~/reporter/notebook",
    default_mode: "minimal",
    carryover_prompt: true,
  },
  computer: {
    enabled: true,
    require_session_approval: true,
    max_steps: 10,
    max_duration_sec: 60,
    allow_domains: [],
    block_domains: [],
  },
};

describe("reporter__computer tool", () => {
  test("validates required task input", async () => {
    const result = await executeComputerTool(
      { id: "1", name: "reporter__computer", input: {} },
      undefined,
      { provider: new MockProvider(), config: baseConfig }
    );
    const parsed = JSON.parse(result) as { ok: boolean; error_code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error_code).toBe("INVALID_INPUT");
  });

  test("caps max_steps and denies without approval", async () => {
    const result = await executeComputerTool(
      {
        id: "1",
        name: "reporter__computer",
        input: { task: "setup slack", max_steps: 9999 },
      },
      undefined,
      {
        provider: new MockProvider(),
        config: baseConfig,
        requestComputerApproval: async ({ maxSteps }) => {
          expect(maxSteps).toBe(baseConfig.computer.max_steps);
          return false;
        },
      }
    );
    const parsed = JSON.parse(result) as { ok: boolean; error_code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error_code).toBe("APPROVAL_DENIED");
  });

  test("fail-fast when provider lacks computer-use support", async () => {
    const result = await executeComputerTool(
      {
        id: "1",
        name: "reporter__computer",
        input: { task: "click connect button", start_url: "https://slack.com" },
      },
      undefined,
      {
        provider: new MockProvider(),
        config: baseConfig,
        requestComputerApproval: async () => true,
      }
    );
    const parsed = JSON.parse(result) as { ok: boolean; error_code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error_code).toBe("COMPUTER_USE_UNSUPPORTED");
  });
});
