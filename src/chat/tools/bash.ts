import type { LLMTool, ToolCall } from "../../llm/provider.js";

const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const MAX_TIMEOUT = 600_000; // 10 minutes
const MAX_OUTPUT = 30_000; // 30KB

export const bashTools: LLMTool[] = [
  {
    name: "reporter__bash",
    description:
      "Execute a shell command via bash. Returns stdout and stderr. " +
      "Each invocation is a fresh shell — no state persists between calls. " +
      "Never run destructive commands (rm -rf, drop tables, etc.) without explicit user request.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "The bash command to execute" },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 120000, max: 600000)",
        },
        description: {
          type: "string",
          description: "Brief description of what this command does",
        },
      },
      required: ["command"],
    },
  },
];

export async function executeBashTool(tc: ToolCall, signal?: AbortSignal): Promise<string> {
  const command = tc.input.command as string;
  const timeout = Math.min(MAX_TIMEOUT, Math.max(1000, (tc.input.timeout as number) || DEFAULT_TIMEOUT));

  const proc = Bun.spawn(["bash", "-c", command], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  // Set up timeout
  const timer = setTimeout(() => {
    proc.kill("SIGTERM");
    setTimeout(() => proc.kill("SIGKILL"), 5000);
  }, timeout);

  // Set up abort signal
  const onAbort = () => {
    proc.kill("SIGTERM");
    setTimeout(() => proc.kill("SIGKILL"), 5000);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    clearTimeout(timer);

    let output = "";
    if (stdout) output += stdout;
    if (stderr) output += (output ? "\n" : "") + `[stderr]\n${stderr}`;
    if (!output) output = "(no output)";

    if (exitCode !== 0) {
      output = `[exit code: ${exitCode}]\n${output}`;
    }

    if (output.length > MAX_OUTPUT) {
      output = output.slice(0, MAX_OUTPUT) + `\n\n... (output truncated at ${MAX_OUTPUT} bytes)`;
    }

    return output;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
