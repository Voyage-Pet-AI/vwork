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
    case "vwork__bash":
      return inp.command ? truncate(String(inp.command)) : "";
    case "vwork__read_file":
    case "vwork__write_file":
    case "vwork__list_files":
      return inp.path ? truncate(String(inp.path)) : "";
    case "vwork__glob":
      return inp.pattern ? truncate(String(inp.pattern)) : "";
    case "vwork__grep":
      return inp.pattern ? truncate(String(inp.pattern)) : "";
    case "vwork__webfetch":
      return inp.url ? truncate(String(inp.url)) : "";
    case "vwork__computer":
      return inp.task ? truncate(String(inp.task)) : "";
    case "vwork__generate_report": {
      const kind = typeof inp.kind === "string" ? inp.kind : "custom";
      const lookback = typeof inp.lookback_days === "number" ? inp.lookback_days : "";
      return `${kind}${lookback ? ` ${lookback}d` : ""}`;
    }
    case "vwork__report_add_schedule":
    case "vwork__report_remove_schedule":
    case "vwork__report_update_schedule":
      return inp.name ? truncate(String(inp.name)) : "";
    case "vwork__report_list_schedules":
      return "";
    case "vwork__todo_read":
      return "";
    case "vwork__todo_write": {
      if (Array.isArray(inp.todos)) return `${inp.todos.length} todos`;
      return "";
    }
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
  vwork__bash: "Bash",
  vwork__read_file: "Read",
  vwork__write_file: "Write",
  vwork__list_files: "ListFiles",
  vwork__glob: "Glob",
  vwork__grep: "Grep",
  vwork__webfetch: "WebFetch",
  vwork__computer: "Computer",
  vwork__generate_report: "GenerateReport",
  vwork__report_list_schedules: "ListSchedules",
  vwork__report_add_schedule: "AddSchedule",
  vwork__report_remove_schedule: "RemoveSchedule",
  vwork__report_update_schedule: "UpdateSchedule",
  vwork__todo_read: "TodoRead",
  vwork__todo_write: "TodoWrite",
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
    case "vwork__bash": {
      if (!result.trim()) return "(no output)";
      const fl = firstLine(result);
      return lines > 1 ? `${fl} (+${lines - 1} lines)` : fl;
    }
    case "vwork__read_file":
      return `Read ${lines} lines`;
    case "vwork__write_file":
      return firstLine(result) || "Written";
    case "vwork__glob":
    case "vwork__list_files": {
      const count = result.trim() ? result.trim().split("\n").length : 0;
      return `${count} file${count !== 1 ? "s" : ""}`;
    }
    case "vwork__grep": {
      const count = result.trim() ? result.trim().split("\n").length : 0;
      return `${count} match${count !== 1 ? "es" : ""}`;
    }
    case "vwork__webfetch": {
      const kb = (new TextEncoder().encode(result).length / 1024).toFixed(1);
      return `${kb}KB fetched`;
    }
    case "vwork__computer": {
      try {
        const parsed = JSON.parse(result) as {
          ok?: boolean;
          summary?: string;
          actions?: unknown[];
          error_message?: string;
        };
        if (parsed.ok) {
          const count = Array.isArray(parsed.actions) ? parsed.actions.length : 0;
          return `${count} actions · ${truncate(parsed.summary ?? "completed", 52)}`;
        }
        return truncate(parsed.error_message ?? parsed.summary ?? "computer run failed", 60);
      } catch {
        return firstLine(result);
      }
    }
    case "vwork__generate_report": {
      try {
        const parsed = JSON.parse(result) as { saved_path?: string | null; save_error?: string | null };
        if (parsed.save_error) return `save failed: ${parsed.save_error}`;
        if (parsed.saved_path) return `saved: ${parsed.saved_path}`;
      } catch {}
      return "report generated";
    }
    case "vwork__report_list_schedules":
    case "vwork__report_add_schedule":
    case "vwork__report_remove_schedule":
    case "vwork__report_update_schedule":
      return firstLine(result) || "ok";
    case "vwork__todo_read":
    case "vwork__todo_write": {
      try {
        const parsed = JSON.parse(result) as { open_count?: number; todos?: unknown[] };
        const total = Array.isArray(parsed.todos) ? parsed.todos.length : 0;
        const open = typeof parsed.open_count === "number" ? parsed.open_count : 0;
        return `${open} open / ${total} total`;
      } catch {
        return firstLine(result) || "ok";
      }
    }
    default: {
      // MCP / unknown: line count or first line
      if (lines > 3) return `${lines} lines`;
      return firstLine(result) || `${lines} lines`;
    }
  }
}
