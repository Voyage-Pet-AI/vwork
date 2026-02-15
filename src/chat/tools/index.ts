import type { LLMTool, ToolCall } from "../../llm/provider.js";
import type { Config } from "../../config.js";
import type { LLMProvider } from "../../llm/provider.js";
import type { MCPClientManager } from "../../mcp/client.js";
import { fileTools, executeFileTool } from "./file.js";
import { bashTools, executeBashTool } from "./bash.js";
import { globTools, executeGlobTool } from "./glob.js";
import { grepTools, executeGrepTool } from "./grep.js";
import { webfetchTools, executeWebfetchTool } from "./webfetch.js";
import { computerTools, executeComputerTool } from "./computer.js";
import {
  reporterGenerateReportTools,
  executeReporterGenerateReportTool,
} from "./reporter-generate-report.js";
import {
  reportScheduleTools,
  executeReportScheduleTool,
} from "./report-schedule.js";
import type { ComputerSessionEvent } from "../../computer/types.js";

export interface BuiltinToolContext {
  provider?: LLMProvider;
  mcpClient?: MCPClientManager;
  config?: Config;
  customServerNames?: string[];
  requestComputerApproval?: (input: {
    task: string;
    startUrl?: string;
    maxSteps: number;
  }) => Promise<boolean>;
  registerComputerAbortController?: (controller: AbortController | null) => void;
  onComputerSessionEvent?: (event: ComputerSessionEvent) => void;
}

export function getBuiltinTools(): LLMTool[] {
  return [
    ...fileTools,
    ...bashTools,
    ...globTools,
    ...grepTools,
    ...webfetchTools,
    ...computerTools,
    ...reporterGenerateReportTools,
    ...reportScheduleTools,
  ];
}

export async function executeBuiltinTool(
  tc: ToolCall,
  signal?: AbortSignal,
  context?: BuiltinToolContext
): Promise<string> {
  switch (tc.name) {
    case "reporter__read_file":
    case "reporter__write_file":
    case "reporter__list_files":
      return executeFileTool(tc);

    case "reporter__bash":
      return executeBashTool(tc, signal);

    case "reporter__glob":
      return executeGlobTool(tc);

    case "reporter__grep":
      return executeGrepTool(tc, signal);

    case "reporter__webfetch":
      return executeWebfetchTool(tc, signal);

    case "reporter__computer":
      return executeComputerTool(tc, signal, {
        provider: context?.provider,
        config: context?.config,
        requestComputerApproval: context?.requestComputerApproval,
        registerComputerAbortController: context?.registerComputerAbortController,
        onComputerSessionEvent: context?.onComputerSessionEvent,
      });

    case "reporter__generate_report":
      if (!context?.provider || !context?.mcpClient || !context?.config) {
        throw new Error("reporter__generate_report requires provider, MCP client, and config context");
      }
      return executeReporterGenerateReportTool(tc.input, {
        provider: context.provider,
        mcpClient: context.mcpClient,
        config: context.config,
        customServerNames: context.customServerNames ?? [],
      });

    case "reporter__report_list_schedules":
    case "reporter__report_add_schedule":
    case "reporter__report_remove_schedule":
    case "reporter__report_update_schedule":
      return executeReportScheduleTool(tc);

    default:
      throw new Error(`Unknown built-in tool: ${tc.name}`);
  }
}
