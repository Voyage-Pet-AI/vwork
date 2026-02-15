import { resolve } from "path";
import { existsSync } from "fs";

const MAX_FILE_SIZE = 100 * 1024; // 100KB

export interface FileMention {
  path: string;
  content: string | null; // null if unreadable
}

/** Extract unique @path references from text. */
export function parseFileMentions(text: string): string[] {
  const matches = text.match(/@(\S+)/g);
  if (!matches) return [];
  const paths = matches.map((m) => m.slice(1)); // strip leading @
  return [...new Set(paths)];
}

/** Read each mentioned file from cwd. Skips files that don't exist or are binary. */
export async function resolveFileMentions(paths: string[]): Promise<FileMention[]> {
  const results: FileMention[] = [];

  for (const p of paths) {
    const abs = resolve(process.cwd(), p);
    if (!existsSync(abs)) continue;

    try {
      const file = Bun.file(abs);
      let content = await file.text();
      if (content.length > MAX_FILE_SIZE) {
        content = content.slice(0, MAX_FILE_SIZE) + "\n... [truncated]";
      }
      // Basic binary detection: check for null bytes in first 1024 chars
      if (content.slice(0, 1024).includes("\0")) {
        continue; // skip binary files
      }
      results.push({ path: p, content });
    } catch (err) {
      console.error(`[file-mention] failed to read ${p}: ${err}`);
    }
  }

  return results;
}

/** Build message with file contents prepended as XML blocks. */
export function buildMessageWithFiles(text: string, mentions: FileMention[]): string {
  const fileBlocks = mentions
    .filter((m) => m.content !== null)
    .map((m) => `<file path="${m.path}">\n${m.content}\n</file>`)
    .join("\n\n");

  if (!fileBlocks) return text;
  return `${fileBlocks}\n\n${text}`;
}
