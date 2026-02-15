import type { LLMProvider, Message, LLMTool } from "./provider.js";
import type { MCPClientManager, MCPTool } from "../mcp/client.js";
import { log, error, debug } from "../utils/log.js";

const MAX_ITERATIONS = 20;

/** GitHub tools allowed for report generation (read-only, report-relevant). */
const GITHUB_TOOL_WHITELIST = new Set([
  "github__get_the_authenticated_user",
  "github__search_issues",
  "github__get_pull_request",
  "github__list_commits",
  "github__get_issue",
  "github__list_pull_requests_for_repo",
]);

/** Slack tools allowed for report generation (read-only). */
const SLACK_TOOL_WHITELIST = new Set([
  "slack__slack_list_channels",
  "slack__slack_get_channel_history",
  "slack__slack_get_thread_replies",
  "slack__slack_get_users",
  "slack__slack_get_user_profile",
  "slack__slack_search_messages",
]);

export function filterTools(tools: MCPTool[]): MCPTool[] {
  return tools.filter((t) => {
    if (t.name.startsWith("github__")) return GITHUB_TOOL_WHITELIST.has(t.name);
    if (t.name.startsWith("slack__")) return SLACK_TOOL_WHITELIST.has(t.name);
    return true;
  });
}

export async function runAgent(
  provider: LLMProvider,
  mcpClient: MCPClientManager,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const tools: LLMTool[] = filterTools(mcpClient.getAllTools());
  const messages: Message[] = [{ role: "user", content: userMessage }];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    debug(`Iteration ${i + 1}/${MAX_ITERATIONS}`);

    const response = await provider.chat(systemPrompt, messages, tools);

    if (response.stop_reason === "end_turn" || response.tool_calls.length === 0) {
      return response.text;
    }

    // Model wants to call tools — execute them
    messages.push(provider.makeAssistantMessage(response));

    const results = await Promise.all(
      response.tool_calls.map(async (tc) => {
        log(`Calling tool: ${tc.name}`);
        try {
          const result = await mcpClient.callTool(tc.name, tc.input);
          const text =
            typeof result === "string"
              ? result
              : JSON.stringify(result, null, 2);
          return { tool_use_id: tc.id, content: text };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          error(`Tool ${tc.name} failed: ${msg}`);
          return { tool_use_id: tc.id, content: `Error: ${msg}`, is_error: true };
        }
      })
    );

    messages.push(provider.makeToolResultMessage(results));
  }

  error("Max iterations reached");
  return "Report generation stopped: too many tool calls. Partial results may be incomplete.";
}
