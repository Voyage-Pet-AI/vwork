import type { LLMTool, ToolCall } from "../../llm/provider.js";
import { fileTools, executeFileTool } from "./file.js";
import { bashTools, executeBashTool } from "./bash.js";
import { globTools, executeGlobTool } from "./glob.js";
import { grepTools, executeGrepTool } from "./grep.js";
import { webfetchTools, executeWebfetchTool } from "./webfetch.js";

export function getBuiltinTools(): LLMTool[] {
  return [...fileTools, ...bashTools, ...globTools, ...grepTools, ...webfetchTools];
}

export async function executeBuiltinTool(tc: ToolCall, signal?: AbortSignal): Promise<string> {
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

    default:
      throw new Error(`Unknown built-in tool: ${tc.name}`);
  }
}
