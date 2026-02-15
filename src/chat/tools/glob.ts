import { statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { LLMTool, ToolCall } from "../../llm/provider.js";

export const globTools: LLMTool[] = [
  {
    name: "reporter__glob",
    description:
      "Find files matching a glob pattern. Returns absolute paths sorted by modification time (newest first). " +
      'Supports patterns like "**/*.pdf", "*.txt", "src/**/*.ts".',
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: 'Glob pattern to match (e.g. "**/*.pdf", "*.txt")',
        },
        path: {
          type: "string",
          description: "Directory to search in (default: home directory). Supports ~/.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 100)",
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

export async function executeGlobTool(tc: ToolCall): Promise<string> {
  const pattern = tc.input.pattern as string;
  const searchDir = resolvePath((tc.input.path as string) || homedir());
  const limit = Math.min(500, Math.max(1, (tc.input.limit as number) || 100));

  const glob = new Bun.Glob(pattern);
  const matches: { path: string; mtime: number }[] = [];

  for await (const match of glob.scan({ cwd: searchDir, dot: false, absolute: true })) {
    try {
      const stat = statSync(match);
      if (stat.isFile()) {
        matches.push({ path: match, mtime: stat.mtimeMs });
      }
    } catch {
      // Skip inaccessible files
    }
    if (matches.length >= limit * 2) break; // Gather extra for sorting, then trim
  }

  // Sort by mtime descending
  matches.sort((a, b) => b.mtime - a.mtime);
  const trimmed = matches.slice(0, limit);

  if (trimmed.length === 0) {
    return `No files found matching "${pattern}" in ${searchDir}`;
  }

  const result = trimmed.map((m) => m.path).join("\n");
  if (matches.length > limit) {
    return result + `\n\n... (${matches.length}+ matches, showing first ${limit})`;
  }
  return result;
}
