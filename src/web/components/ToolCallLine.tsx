import type { DisplayToolCall } from "../lib/types.js";

interface ToolCallLineProps {
  toolCall: DisplayToolCall;
}

export function ToolCallLine({ toolCall }: ToolCallLineProps) {
  const statusIcon =
    toolCall.status === "running"
      ? "⏳"
      : toolCall.status === "error"
        ? "❌"
        : "✓";

  const statusColor =
    toolCall.status === "running"
      ? "text-amber-400"
      : toolCall.status === "error"
        ? "text-red-400"
        : "text-emerald-400";

  return (
    <div className="flex items-start gap-2 py-1 px-3 text-xs font-mono bg-zinc-800/50 rounded border border-zinc-700/50">
      <span className={`${statusColor} shrink-0 mt-0.5`}>{statusIcon}</span>
      <div className="min-w-0">
        <span className="text-zinc-300 font-medium">{toolCall.displayName}</span>
        {toolCall.summary && (
          <span className="text-zinc-500 ml-2">{toolCall.summary}</span>
        )}
        {toolCall.resultSummary && toolCall.status !== "running" && (
          <span className="text-zinc-500 ml-2">→ {toolCall.resultSummary}</span>
        )}
      </div>
    </div>
  );
}
