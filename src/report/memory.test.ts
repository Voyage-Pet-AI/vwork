import { describe, expect, test } from "bun:test";
import { buildReportFilename } from "./memory.js";

describe("buildReportFilename", () => {
  test("uses timestamp + kind format", () => {
    const d = new Date(2026, 1, 15, 9, 7, 0);
    const name = buildReportFilename({ kind: "daily", timestamp: d });
    expect(name).toBe("2026-02-15-0907-daily.md");
  });

  test("different minutes produce different names", () => {
    const a = buildReportFilename({
      kind: "custom",
      timestamp: new Date(2026, 1, 15, 9, 7, 0),
    });
    const b = buildReportFilename({
      kind: "custom",
      timestamp: new Date(2026, 1, 15, 9, 8, 0),
    });
    expect(a).not.toBe(b);
  });
});
