import { join } from "path";
import { homedir } from "os";
import type { LLMTool, ToolCall } from "../../llm/provider.js";

const MAX_OUTPUT = 30_000;
const TIMEOUT = 30_000;

export const grepTools: LLMTool[] = [
  {
    name: "vwork__grep",
    description:
      "Search file contents for a pattern using grep. Returns matching lines with file paths and line numbers.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Search pattern (regular expression)",
        },
        path: {
          type: "string",
          description: "Directory or file to search in (default: home directory). Supports ~/.",
        },
        glob: {
          type: "string",
          description: 'File pattern filter (e.g. "*.txt", "*.md")',
        },
        case_insensitive: {
          type: "boolean",
          description: "Case-insensitive search (default: false)",
        },
      },
      required: ["pattern"],
    },
  },
];

function resolvePath(path: string): string {
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export async function executeGrepTool(tc: ToolCall, signal?: AbortSignal): Promise<string> {
  const pattern = tc.input.pattern as string;
  const searchPath = resolvePath((tc.input.path as string) || homedir());
  const globFilter = tc.input.glob as string | undefined;
  const caseInsensitive = tc.input.case_insensitive as boolean | undefined;

  const args = ["grep", "-rn", "--max-count=100"];
  if (caseInsensitive) args.push("-i");
  if (globFilter) args.push(`--include=${globFilter}`);
  args.push("--", pattern, searchPath);

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const timer = setTimeout(() => {
    proc.kill("SIGTERM");
  }, TIMEOUT);

  const onAbort = () => proc.kill("SIGTERM");
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    clearTimeout(timer);

    if (!stdout.trim()) {
      return `No matches found for "${pattern}" in ${searchPath}`;
    }

    let output = stdout;
    if (output.length > MAX_OUTPUT) {
      output = output.slice(0, MAX_OUTPUT) + `\n\n... (output truncated at ${MAX_OUTPUT} bytes)`;
    }

    return output;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
