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
  vworkGenerateReportTools,
  executeVworkGenerateReportTool,
} from "./vwork-generate-report.js";
import {
  reportScheduleTools,
  executeReportScheduleTool,
} from "./report-schedule.js";
import { todoTools, executeTodoTool } from "./todo.js";
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
    ...vworkGenerateReportTools,
    ...reportScheduleTools,
    ...todoTools,
  ];
}

export async function executeBuiltinTool(
  tc: ToolCall,
  signal?: AbortSignal,
  context?: BuiltinToolContext
): Promise<string> {
  switch (tc.name) {
    case "vwork__read_file":
    case "vwork__write_file":
    case "vwork__list_files":
      return executeFileTool(tc);

    case "vwork__bash":
      return executeBashTool(tc, signal);

    case "vwork__glob":
      return executeGlobTool(tc);

    case "vwork__grep":
      return executeGrepTool(tc, signal);

    case "vwork__webfetch":
      return executeWebfetchTool(tc, signal);

    case "vwork__computer":
      return executeComputerTool(tc, signal, {
        provider: context?.provider,
        config: context?.config,
        requestComputerApproval: context?.requestComputerApproval,
        registerComputerAbortController: context?.registerComputerAbortController,
        onComputerSessionEvent: context?.onComputerSessionEvent,
      });

    case "vwork__generate_report":
      if (!context?.provider || !context?.mcpClient || !context?.config) {
        throw new Error("vwork__generate_report requires provider, MCP client, and config context");
      }
      return executeVworkGenerateReportTool(tc.input, {
        provider: context.provider,
        mcpClient: context.mcpClient,
        config: context.config,
        customServerNames: context.customServerNames ?? [],
      });

    case "vwork__report_list_schedules":
    case "vwork__report_add_schedule":
    case "vwork__report_remove_schedule":
    case "vwork__report_update_schedule":
      return executeReportScheduleTool(tc);

    case "vwork__todo_read":
    case "vwork__todo_write":
      if (!context?.config) {
        throw new Error("todo tools require config context");
      }
      return executeTodoTool(tc, context.config);

    default:
      throw new Error(`Unknown built-in tool: ${tc.name}`);
  }
}
