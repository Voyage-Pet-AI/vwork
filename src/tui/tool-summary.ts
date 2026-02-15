import type { ToolCall } from "../llm/provider.js";

const MAX_LEN = 80;

function truncate(s: string, max = MAX_LEN): string {
  // Collapse to single line
  const line = s.replace(/\n/g, " ").trim();
  return line.length > max ? line.slice(0, max) + "…" : line;
}

/**
 * Extract a short human-readable summary from a tool call's input.
 * Returns empty string if nothing useful can be extracted.
 */
export function toolCallSummary(tc: ToolCall): string {
  const inp = tc.input;

  // Built-in tools with known shapes
  switch (tc.name) {
    case "reporter__bash":
      return inp.command ? truncate(String(inp.command)) : "";
    case "reporter__read_file":
    case "reporter__write_file":
    case "reporter__list_files":
      return inp.path ? truncate(String(inp.path)) : "";
    case "reporter__glob":
      return inp.pattern ? truncate(String(inp.pattern)) : "";
    case "reporter__grep":
      return inp.pattern ? truncate(String(inp.pattern)) : "";
    case "reporter__webfetch":
      return inp.url ? truncate(String(inp.url)) : "";
  }

  // MCP tools — try common argument names
  for (const key of ["query", "command", "path", "url", "jql", "pattern", "q"]) {
    if (inp[key] && typeof inp[key] === "string") {
      return truncate(String(inp[key]));
    }
  }

  return "";
}
