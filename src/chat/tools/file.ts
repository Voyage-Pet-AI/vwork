import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import type { LLMTool, ToolCall } from "../../llm/provider.js";

const VWORK_DIR = join(homedir(), "vwork");

/** Resolve path relative to ~/vwork/ and reject anything outside. */
function safePath(path: string): string {
  const cleaned = path.replace(/^~\/vwork\/?/, "");
  const resolved = resolve(VWORK_DIR, cleaned);
  if (!resolved.startsWith(VWORK_DIR)) {
    throw new Error("Access denied: path must be within ~/vwork/");
  }
  return resolved;
}

/** Resolve any path, supporting ~/ expansion. */
function resolvePath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return resolve(path);
}

export const fileTools: LLMTool[] = [
  {
    name: "vwork__read_file",
    description:
      "Read a file from the filesystem. Supports absolute paths and ~/. " +
      "Returns numbered lines. Use offset/limit for large files.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute file path or ~/relative path" },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-based, default: 1)",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to return (default: 2000)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "vwork__write_file",
    description:
      "Write content to a file in ~/vwork/. Creates directories as needed. Path is relative to ~/vwork/.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path relative to ~/vwork/" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "vwork__list_files",
    description:
      "List files and directories under ~/vwork/. Path is relative to ~/vwork/ (defaults to root).",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Directory path relative to ~/vwork/ (default: root)",
        },
      },
    },
  },
];

export async function executeFileTool(tc: ToolCall): Promise<string> {
  switch (tc.name) {
    case "vwork__read_file": {
      const p = resolvePath(tc.input.path as string);
      if (!existsSync(p)) return `Error: file not found: ${tc.input.path}`;
      const stat = statSync(p);
      if (stat.isDirectory()) return `Error: path is a directory, not a file: ${tc.input.path}`;

      // Binary detection: check first 512 bytes for null bytes
      const buf = Buffer.alloc(512);
      const fd = require("fs").openSync(p, "r");
      const bytesRead = require("fs").readSync(fd, buf, 0, 512, 0);
      require("fs").closeSync(fd);
      for (let i = 0; i < bytesRead; i++) {
        if (buf[i] === 0) return `Error: binary file, cannot display: ${tc.input.path}`;
      }

      const content = readFileSync(p, "utf-8");
      const allLines = content.split("\n");
      const offset = Math.max(1, (tc.input.offset as number) || 1);
      const limit = Math.min(2000, (tc.input.limit as number) || 2000);

      const sliced = allLines.slice(offset - 1, offset - 1 + limit);
      const numbered = sliced.map((line, i) => `${offset + i}\t${line}`);
      const result = numbered.join("\n");

      if (allLines.length > offset - 1 + limit) {
        return result + `\n\n... (${allLines.length} total lines)`;
      }
      return result;
    }
    case "vwork__write_file": {
      const p = safePath(tc.input.path as string);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, tc.input.content as string);
      return `Written to ${tc.input.path}`;
    }
    case "vwork__list_files": {
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
