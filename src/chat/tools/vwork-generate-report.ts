import type { Config } from "../../config.js";
import type { LLMProvider, LLMTool } from "../../llm/provider.js";
import type { MCPClientManager } from "../../mcp/client.js";
import { runReportSubagent } from "../../report/runner.js";
import type { ReportKind, ReportRequest } from "../../report/types.js";

export interface VworkGenerateReportContext {
  provider: LLMProvider;
  mcpClient: MCPClientManager;
  config: Config;
  customServerNames: string[];
}

export const vworkGenerateReportTools: LLMTool[] = [
  {
    name: "vwork__generate_report",
    description:
      "Generate a work report using the report subagent. Returns report content and save result.",
    input_schema: {
      type: "object" as const,
      properties: {
        kind: {
          type: "string",
          enum: ["daily", "weekly", "custom"],
          description: "Report type",
        },
        lookback_days: {
          type: "number",
          description: "Days of history to include",
        },
        prompt: {
          type: "string",
          description: "Custom report instruction",
        },
        save: {
          type: "boolean",
          description: "Whether to persist report to file",
        },
        source: {
          type: "string",
          enum: ["chat", "cli", "schedule"],
          description: "Origin of request",
        },
        schedule_name: {
          type: "string",
          description: "Schedule name when source is schedule",
        },
      },
      required: ["kind", "lookback_days", "prompt", "save", "source"],
    },
  },
];

interface RawInput {
  kind?: unknown;
  lookback_days?: unknown;
  prompt?: unknown;
  save?: unknown;
  source?: unknown;
  schedule_name?: unknown;
  run_id?: unknown;
}

function normalizeKind(input: unknown): ReportKind {
  if (input === "daily" || input === "weekly" || input === "custom") return input;
  return "custom";
}

function normalizeSource(input: unknown): "chat" | "cli" | "schedule" {
  if (input === "chat" || input === "cli" || input === "schedule") return input;
  return "chat";
}

export async function executeVworkGenerateReportTool(
  input: RawInput,
  ctx: VworkGenerateReportContext
): Promise<string> {
  const kind = normalizeKind(input.kind);
  const lookback = Number.isFinite(input.lookback_days as number)
    ? Math.max(1, Math.floor(input.lookback_days as number))
    : kind === "daily"
      ? 1
      : kind === "weekly"
        ? 7
        : ctx.config.report.lookback_days;

  const request: ReportRequest = {
    kind,
    lookbackDays: lookback,
    prompt: typeof input.prompt === "string" ? input.prompt : `Generate my ${kind} work report.`,
    save: typeof input.save === "boolean" ? input.save : true,
    source: normalizeSource(input.source),
    scheduleName: typeof input.schedule_name === "string" ? input.schedule_name : undefined,
    runId: typeof input.run_id === "string" ? input.run_id : undefined,
  };

  const result = await runReportSubagent(request, {
    provider: ctx.provider,
    mcpClient: ctx.mcpClient,
    config: ctx.config,
    customServerNames: ctx.customServerNames,
  });

  return JSON.stringify(
    {
      content: result.content,
      saved_path: result.savedPath ?? null,
      save_error: result.saveError ?? null,
      run_id: result.runId,
      kind: result.kind,
      lookback_days: result.lookbackDays,
    },
    null,
    2
  );
}
