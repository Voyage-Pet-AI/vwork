import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ReportKind, ReportResult } from "./types.js";

type ReportRunStatus = "running" | "completed" | "failed";
type RunEventType = "started" | "generated" | "saved" | "save_failed" | "completed" | "failed";

export interface ReportRun {
  runId: string;
  source: "chat" | "cli" | "schedule";
  scheduleName?: string;
  kind: ReportKind;
  lookbackDays: number;
  prompt: string;
  status: ReportRunStatus;
  startedAt: string;
  endedAt?: string;
  savedPath?: string;
  saveError?: string;
  error?: string;
}

export interface ReportRunEvent {
  eventId: string;
  runId: string;
  source: "chat" | "cli" | "schedule";
  scheduleName?: string;
  type: RunEventType;
  timestamp: string;
  message: string;
  savedPath?: string;
  error?: string;
  unread: boolean;
}

interface ReportRunStore {
  runs: ReportRun[];
  events: ReportRunEvent[];
}

const STORE_PATH = join(homedir(), "vwork", "report-runs.json");

function ensureDir(): void {
  mkdirSync(join(homedir(), "vwork"), { recursive: true });
}

function loadStore(): ReportRunStore {
  if (!existsSync(STORE_PATH)) {
    return { runs: [], events: [] };
  }

  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ReportRunStore>;
    return {
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return { runs: [], events: [] };
  }
}

function saveStore(store: ReportRunStore): void {
  ensureDir();
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + "\n");
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function startRun(input: Omit<ReportRun, "status" | "startedAt" | "runId"> & { runId?: string }): string {
  const runId = input.runId ?? makeId("run");
  const now = new Date().toISOString();
  const store = loadStore();
  store.runs.push({
    ...input,
    runId,
    status: "running",
    startedAt: now,
  });
  store.events.push({
    eventId: makeId("evt"),
    runId,
    source: input.source,
    scheduleName: input.scheduleName,
    type: "started",
    timestamp: now,
    message:
      input.source === "schedule" && input.scheduleName
        ? `VWork executing report "${input.scheduleName}".`
        : `VWork executing ${input.kind} report.`,
    unread: input.source === "schedule",
  });
  saveStore(store);
  return runId;
}

export function appendRunEvent(
  runId: string,
  type: RunEventType,
  message: string,
  options?: { savedPath?: string; error?: string; unread?: boolean }
): void {
  const store = loadStore();
  const run = store.runs.find((r) => r.runId === runId);
  if (!run) return;

  const timestamp = new Date().toISOString();
  store.events.push({
    eventId: makeId("evt"),
    runId,
    source: run.source,
    scheduleName: run.scheduleName,
    type,
    timestamp,
    message,
    savedPath: options?.savedPath,
    error: options?.error,
    unread: options?.unread ?? run.source === "schedule",
  });
  saveStore(store);
}

export function finishRunSuccess(runId: string, result: ReportResult): void {
  const store = loadStore();
  const run = store.runs.find((r) => r.runId === runId);
  if (!run) return;

  run.status = "completed";
  run.endedAt = new Date().toISOString();
  run.savedPath = result.savedPath;
  run.saveError = result.saveError;

  store.events.push({
    eventId: makeId("evt"),
    runId,
    source: run.source,
    scheduleName: run.scheduleName,
    type: "completed",
    timestamp: run.endedAt,
    message:
      run.source === "schedule" && run.scheduleName
        ? `Here is VWork's report for "${run.scheduleName}": ${result.savedPath ?? "(not saved)"}.`
        : `VWork completed ${run.kind} report.`,
    savedPath: result.savedPath,
    error: result.saveError,
    unread: run.source === "schedule",
  });

  saveStore(store);
}

export function finishRunFailure(runId: string, err: string): void {
  const store = loadStore();
  const run = store.runs.find((r) => r.runId === runId);
  if (!run) return;

  run.status = "failed";
  run.endedAt = new Date().toISOString();
  run.error = err;

  store.events.push({
    eventId: makeId("evt"),
    runId,
    source: run.source,
    scheduleName: run.scheduleName,
    type: "failed",
    timestamp: run.endedAt,
    message: `VWork failed: ${err}`,
    error: err,
    unread: run.source === "schedule",
  });

  saveStore(store);
}

export function listRecentRuns(limit: number = 50): ReportRun[] {
  const store = loadStore();
  return [...store.runs]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

export function getLatestRunForSchedule(name: string): ReportRun | undefined {
  return listRecentRuns().find((r) => r.source === "schedule" && r.scheduleName === name);
}

export function consumeUnreadInboxEvents(limit: number = 20): ReportRunEvent[] {
  const store = loadStore();
  const unread = store.events
    .filter((e) => e.unread)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(0, limit);

  if (unread.length === 0) return [];

  const ids = new Set(unread.map((e) => e.eventId));
  for (const e of store.events) {
    if (ids.has(e.eventId)) {
      e.unread = false;
    }
  }
  saveStore(store);
  return unread;
}
