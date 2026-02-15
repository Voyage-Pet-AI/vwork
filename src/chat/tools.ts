import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import type { LLMTool, ToolCall } from "../llm/provider.js";

const REPORTER_DIR = join(homedir(), "reporter");

/** Resolve path relative to ~/reporter/ and reject anything outside. */
function safePath(path: string): string {
  const cleaned = path.replace(/^~\/reporter\/?/, "");
  const resolved = resolve(REPORTER_DIR, cleaned);
  if (!resolved.startsWith(REPORTER_DIR)) {
    throw new Error("Access denied: path must be within ~/reporter/");
  }
  return resolved;
}

export function getFileTools(): LLMTool[] {
  return [
    {
      name: "reporter__read_file",
      description: "Read a file from ~/reporter/. Path is relative to ~/reporter/.",
      input_schema: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "File path relative to ~/reporter/" },
        },
        required: ["path"],
      },
    },
    {
      name: "reporter__write_file",
      description: "Write content to a file in ~/reporter/. Creates directories as needed. Path is relative to ~/reporter/.",
      input_schema: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "File path relative to ~/reporter/" },
          content: { type: "string", description: "File content to write" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "reporter__list_files",
      description: "List files and directories under ~/reporter/. Path is relative to ~/reporter/ (defaults to root).",
      input_schema: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "Directory path relative to ~/reporter/ (default: root)" },
        },
      },
    },
  ];
}

export async function executeFileTool(tc: ToolCall): Promise<string> {
  switch (tc.name) {
    case "reporter__read_file": {
      const p = safePath(tc.input.path as string);
      if (!existsSync(p)) return `Error: file not found: ${tc.input.path}`;
      return readFileSync(p, "utf-8");
    }
    case "reporter__write_file": {
      const p = safePath(tc.input.path as string);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, tc.input.content as string);
      return `Written to ${tc.input.path}`;
    }
    case "reporter__list_files": {
      const p = safePath((tc.input.path as string) ?? "");
      if (!existsSync(p)) return `Error: directory not found: ${tc.input.path ?? "/"}`;
      const entries = readdirSync(p);
      return entries
        .map((name) => {
          const isDir = statSync(join(p, name)).isDirectory();
          return isDir ? `${name}/` : name;
        })
        .join("\n");
    }
    default:
      throw new Error(`Unknown file tool: ${tc.name}`);
  }
}
