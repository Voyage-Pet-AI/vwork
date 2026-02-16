import { describe, expect, test } from "bun:test";
import type { Config } from "../config.js";
import { buildChatSystemPrompt } from "./prompt.js";

const config: Config = {
  llm: { provider: "anthropic", model: "claude-sonnet-4-5-20250929" },
  github: { enabled: false, orgs: [] },
  jira: { enabled: false, url: "" },
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
    max_steps: 150,
    max_duration_sec: 900,
    allow_domains: [],
    block_domains: [],
  },
};

describe("buildChatSystemPrompt", () => {
  test("includes todo context when provided", () => {
    const prompt = buildChatSystemPrompt(
      config,
      [],
      "User's current todos:\nActive: Build feature\nBlocked: none",
    );
    expect(prompt).toContain("## Todo Context");
    expect(prompt).toContain("Active: Build feature");
  });

  test("omits todo context when empty", () => {
    const prompt = buildChatSystemPrompt(config, [], "");
    expect(prompt.includes("## Todo Context")).toBe(false);
  });
});
