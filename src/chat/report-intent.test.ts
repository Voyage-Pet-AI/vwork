import { describe, expect, test } from "bun:test";
import { detectReportIntent } from "./report-intent.js";

describe("detectReportIntent", () => {
  test("matches daily report phrases", () => {
    const out = detectReportIntent("Generate my daily report");
    expect(out.matched).toBe(true);
    expect(out.ambiguous).toBe(false);
    expect(out.kind).toBe("daily");
    expect(out.lookbackDays).toBe(1);
  });

  test("matches weekly/last week phrases", () => {
    const out = detectReportIntent("generate report for last week");
    expect(out.matched).toBe(true);
    expect(out.kind).toBe("weekly");
    expect(out.lookbackDays).toBe(7);
  });

  test("extracts explicit last N days", () => {
    const out = detectReportIntent("Generate report for last 12 days");
    expect(out.matched).toBe(true);
    expect(out.kind).toBe("custom");
    expect(out.lookbackDays).toBe(12);
  });

  test("guards bug report false positive", () => {
    const out = detectReportIntent("I need to file a bug report");
    expect(out.matched).toBe(false);
  });

  test("marks generic request ambiguous", () => {
    const out = detectReportIntent("generate report");
    expect(out.matched).toBe(true);
    expect(out.ambiguous).toBe(true);
  });
});
