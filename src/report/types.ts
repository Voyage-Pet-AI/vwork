export type ReportKind = "daily" | "weekly" | "custom";

export interface ReportRequest {
  kind: ReportKind;
  lookbackDays: number;
  prompt: string;
  source: "chat" | "cli" | "schedule";
  save: boolean;
  scheduleName?: string;
  runId?: string;
}

export interface ReportResult {
  content: string;
  savedPath?: string;
  saveError?: string;
  kind: ReportKind;
  lookbackDays: number;
  runId: string;
}
