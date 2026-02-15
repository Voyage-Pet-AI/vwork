import type { ComputerActionRecord, ComputerRunResult } from "./types.js";

const REDACTED = "[REDACTED]";

const SECRET_PATTERNS: RegExp[] = [
  /\b(xox[baprs]-[A-Za-z0-9-]{8,})\b/g, // Slack tokens
  /\b(Bearer\s+[A-Za-z0-9._=-]{16,})\b/gi,
  /\b(sk-[A-Za-z0-9]{16,})\b/g,
  /\b[A-Za-z0-9+/=]{32,}\b/g, // generic long secrets
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

export function redactAction(action: ComputerActionRecord): ComputerActionRecord {
  return {
    ...action,
    url: action.url ? redactSecrets(action.url) : undefined,
    detail: action.detail ? redactSecrets(action.detail) : undefined,
  };
}

export function redactRunResult(result: ComputerRunResult): ComputerRunResult {
  return {
    ...result,
    summary: redactSecrets(result.summary),
    error_message: result.error_message
      ? redactSecrets(result.error_message)
      : undefined,
    visited_urls: result.visited_urls.map((u) => redactSecrets(u)),
    actions: result.actions.map((a) => redactAction(a)),
  };
}

