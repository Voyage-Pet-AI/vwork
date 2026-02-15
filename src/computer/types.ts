export type ComputerSessionState =
  | "idle"
  | "approval_pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface ComputerActionRecord {
  type: string;
  timestamp: string;
  url?: string;
  detail?: string;
}

export interface ComputerArtifactRecord {
  type: "screenshot" | "trace" | "log";
  path?: string;
  label?: string;
}

export interface ComputerRunResult {
  ok: boolean;
  summary: string;
  actions: ComputerActionRecord[];
  artifacts: ComputerArtifactRecord[];
  visited_urls: string[];
  error_code?: string;
  error_message?: string;
}

export interface ComputerTaskInput {
  task: string;
  start_url?: string;
  max_steps: number;
  max_duration_sec: number;
}

export interface ComputerPolicy {
  allowDomains: string[];
  blockDomains: string[];
}

export interface ComputerSessionEvent {
  type:
    | "computer_session_start"
    | "computer_action"
    | "computer_policy_block"
    | "computer_session_end";
  sessionId: string;
  timestamp: string;
  message: string;
  url?: string;
  step?: number;
  maxSteps?: number;
}

