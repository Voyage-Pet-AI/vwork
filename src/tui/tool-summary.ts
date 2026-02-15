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
    case "reporter__generate_report": {
      const kind = typeof inp.kind === "string" ? inp.kind : "custom";
      const lookback = typeof inp.lookback_days === "number" ? inp.lookback_days : "";
      return `${kind}${lookback ? ` ${lookback}d` : ""}`;
    }
    case "reporter__report_add_schedule":
    case "reporter__report_remove_schedule":
    case "reporter__report_update_schedule":
      return inp.name ? truncate(String(inp.name)) : "";
    case "reporter__report_list_schedules":
      return "";
  }

  // MCP tools — try common argument names
  for (const key of ["query", "command", "path", "url", "jql", "pattern", "q"]) {
    if (inp[key] && typeof inp[key] === "string") {
      return truncate(String(inp[key]));
    }
  }

  return "";
}

const FRIENDLY_NAMES: Record<string, string> = {
  reporter__bash: "Bash",
  reporter__read_file: "Read",
  reporter__write_file: "Write",
  reporter__list_files: "ListFiles",
  reporter__glob: "Glob",
  reporter__grep: "Grep",
  reporter__webfetch: "WebFetch",
  reporter__generate_report: "GenerateReport",
  reporter__report_list_schedules: "ListSchedules",
  reporter__report_add_schedule: "AddSchedule",
  reporter__report_remove_schedule: "RemoveSchedule",
  reporter__report_update_schedule: "UpdateSchedule",
};

/** Map raw tool name to a short display name. */
export function friendlyToolName(rawName: string): string {
  if (FRIENDLY_NAMES[rawName]) return FRIENDLY_NAMES[rawName];
  // MCP tools: "github__search_issues" → "github search_issues"
  if (rawName.includes("__")) {
    const [server, tool] = rawName.split("__", 2);
    return `${server} ${tool}`;
  }
  return rawName;
}

function countLines(s: string): number {
  if (!s) return 0;
  return s.split("\n").length;
}

function firstLine(s: string): string {
  const line = s.split("\n")[0] ?? "";
  return truncate(line, 60);
}

/** Produce a brief result summary for display. */
export function toolResultSummary(toolName: string, result: string, isError?: boolean): string {
  if (isError) return firstLine(result);

  const lines = countLines(result);

  switch (toolName) {
    case "reporter__bash": {
      if (!result.trim()) return "(no output)";
      const fl = firstLine(result);
      return lines > 1 ? `${fl} (+${lines - 1} lines)` : fl;
    }
    case "reporter__read_file":
      return `Read ${lines} lines`;
    case "reporter__write_file":
      return firstLine(result) || "Written";
    case "reporter__glob":
    case "reporter__list_files": {
      const count = result.trim() ? result.trim().split("\n").length : 0;
      return `${count} file${count !== 1 ? "s" : ""}`;
    }
    case "reporter__grep": {
      const count = result.trim() ? result.trim().split("\n").length : 0;
      return `${count} match${count !== 1 ? "es" : ""}`;
    }
    case "reporter__webfetch": {
      const kb = (new TextEncoder().encode(result).length / 1024).toFixed(1);
      return `${kb}KB fetched`;
    }
    case "reporter__generate_report": {
      try {
        const parsed = JSON.parse(result) as { saved_path?: string | null; save_error?: string | null };
        if (parsed.save_error) return `save failed: ${parsed.save_error}`;
        if (parsed.saved_path) return `saved: ${parsed.saved_path}`;
      } catch {}
      return "report generated";
    }
    case "reporter__report_list_schedules":
    case "reporter__report_add_schedule":
    case "reporter__report_remove_schedule":
    case "reporter__report_update_schedule":
      return firstLine(result) || "ok";
    default: {
      // MCP / unknown: line count or first line
      if (lines > 3) return `${lines} lines`;
      return firstLine(result) || `${lines} lines`;
    }
  }
}
