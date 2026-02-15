import type { Config } from "../config.js";
import type { LLMProvider } from "../llm/provider.js";
import type { MCPClientManager } from "../mcp/client.js";
import { runAgent } from "../llm/agent.js";
import { loadRelevantReports, saveReport } from "./memory.js";
import { buildSystemPrompt } from "./prompt.js";
import type { ReportRequest, ReportResult } from "./types.js";
import { appendRunEvent, finishRunFailure, finishRunSuccess, startRun } from "./runs.js";

interface RunReportSubagentOptions {
  provider: LLMProvider;
  mcpClient: MCPClientManager;
  config: Config;
  customServerNames: string[];
}

function withLookback(config: Config, lookbackDays: number): Config {
  return {
    ...config,
    report: {
      ...config.report,
      lookback_days: lookbackDays,
    },
  };
}

export async function runReportSubagent(
  request: ReportRequest,
  options: RunReportSubagentOptions
): Promise<ReportResult> {
  const runId =
    request.runId ??
    startRun({
      runId: request.runId,
      source: request.source,
      scheduleName: request.scheduleName,
      kind: request.kind,
      lookbackDays: request.lookbackDays,
      prompt: request.prompt,
    });

  const effectiveConfig = withLookback(options.config, request.lookbackDays);

  try {
    const { content: pastReports, usedVectorSearch } = await loadRelevantReports(effectiveConfig);
    const systemPrompt = buildSystemPrompt(
      effectiveConfig,
      pastReports,
      options.customServerNames,
      usedVectorSearch
    );

    const userMessage = request.prompt.trim()
      ? `${request.prompt}\n\nLook back ${request.lookbackDays} day(s).`
      : `Generate my ${request.kind} work report. Look back ${request.lookbackDays} day(s).`;

    const content = await runAgent(options.provider, options.mcpClient, systemPrompt, userMessage);
    appendRunEvent(runId, "generated", "Reporter generated report content.");

    let savedPath: string | undefined;
    let saveError: string | undefined;

    if (request.save) {
      try {
        savedPath = await saveReport(effectiveConfig, content, { kind: request.kind });
        appendRunEvent(runId, "saved", `Saved report to ${savedPath}`, {
          savedPath,
        });
      } catch (e) {
        saveError = e instanceof Error ? e.message : String(e);
        appendRunEvent(runId, "save_failed", `Failed to save report: ${saveError}`, {
          error: saveError,
        });
      }
    }

    const result: ReportResult = {
      content,
      savedPath,
      saveError,
      kind: request.kind,
      lookbackDays: request.lookbackDays,
      runId,
    };

    finishRunSuccess(runId, result);
    return result;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    finishRunFailure(runId, err);
    throw e;
  }
}
