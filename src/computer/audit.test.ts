import { describe, expect, test } from "bun:test";
import { redactRunResult, redactSecrets } from "./audit.js";

describe("computer audit redaction", () => {
  test("redacts obvious secret-like tokens", () => {
    const text = "Bearer abcdefghijklmnopqrstuvwxyz012345 and sk-abcdefghijklmnopqrstuvwxyz";
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(redacted).toContain("[REDACTED]");
  });

  test("redacts secrets in result fields", () => {
    const result = redactRunResult({
      ok: false,
      summary: "used token xoxb-12345678901234567890",
      actions: [
        {
          type: "type",
          timestamp: new Date().toISOString(),
          detail: "paste Bearer abcdefghijklmnopqrstuvwxyz012345",
        },
      ],
      artifacts: [],
      visited_urls: ["https://example.com?token=sk-abcdefghijklmnopqrstuvwxyz"],
      error_code: "X",
      error_message: "failed with xoxb-12345678901234567890",
    });
    expect(result.summary).toContain("[REDACTED]");
    expect(result.actions[0].detail).toContain("[REDACTED]");
    expect(result.visited_urls[0]).toContain("[REDACTED]");
    expect(result.error_message).toContain("[REDACTED]");
  });
});

