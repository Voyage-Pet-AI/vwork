import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let oldHome = "";
let testHome = "";

beforeEach(() => {
  oldHome = process.env.HOME ?? "";
  testHome = mkdtempSync(join(tmpdir(), "vwork-runs-test-"));
  process.env.HOME = testHome;
});

afterEach(() => {
  process.env.HOME = oldHome;
  rmSync(testHome, { recursive: true, force: true });
});

describe("run inbox", () => {
  test("consumeUnreadInboxEvents returns and marks schedule events", async () => {
    const runs = await import("./runs.js");
    const runId = runs.startRun({
      source: "schedule",
      scheduleName: "morning",
      kind: "daily",
      lookbackDays: 1,
      prompt: "Generate daily report",
    });
    runs.appendRunEvent(runId, "saved", "Saved report", { savedPath: "/tmp/a.md" });

    const unread1 = runs.consumeUnreadInboxEvents(10);
    expect(unread1.length).toBeGreaterThan(0);

    const unread2 = runs.consumeUnreadInboxEvents(10);
    expect(unread2.length).toBe(0);
  });
});
