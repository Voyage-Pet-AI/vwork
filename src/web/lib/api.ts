const BASE = "/api";

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// Chat
export function sendMessage(message: string) {
  return fetchJSON<{ ok: boolean }>("/chat/send", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export function abortChat() {
  return fetchJSON<{ ok: boolean }>("/chat/abort", { method: "POST" });
}

export function clearChat() {
  return fetchJSON<{ ok: boolean }>("/chat/clear", { method: "POST" });
}

// Reports
export function runReport(opts?: { kind?: string; lookback_days?: number; prompt?: string }) {
  return fetchJSON<{
    content: string;
    savedPath?: string;
    saveError?: string;
    kind: string;
    lookbackDays: number;
  }>("/report/run", {
    method: "POST",
    body: JSON.stringify(opts ?? {}),
  });
}

export function getReportHistory() {
  return fetchJSON<{ reports: string[] }>("/report/history");
}

export function getReport(filename: string) {
  return fetchJSON<{ filename: string; content: string }>(`/report/${filename}`);
}

// Todos
export function getTodos() {
  return fetchJSON<{ agentTodos: import("./types.js").AgentTodo[] }>("/todo");
}

export function saveTodos(todos: import("./types.js").AgentTodo[]) {
  return fetchJSON<{ agentTodos: import("./types.js").AgentTodo[] }>("/todo", {
    method: "POST",
    body: JSON.stringify({ todos }),
  });
}

// Auth
export function getAuthStatus() {
  return fetchJSON<import("./types.js").AuthStatus>("/auth/status");
}

export function logoutService(service: string) {
  return fetchJSON<{ ok: boolean }>(`/auth/logout/${service}`, { method: "POST" });
}

// Schedules
export function getSchedules() {
  return fetchJSON<{ schedules: import("./types.js").Schedule[] }>("/schedule");
}

export function addSchedule(schedule: { name: string; cron: string; prompt: string; frequencyLabel: string }) {
  return fetchJSON<{ ok: boolean }>("/schedule", {
    method: "POST",
    body: JSON.stringify(schedule),
  });
}

export function deleteSchedule(name: string) {
  return fetchJSON<{ ok: boolean }>(`/schedule/${name}`, { method: "DELETE" });
}

// Config
export function getConfig() {
  return fetchJSON<Record<string, unknown>>("/config");
}

// MCP
export function getMCPServers() {
  return fetchJSON<{ servers: string[] }>("/mcp/servers");
}

export function getMCPTools() {
  return fetchJSON<{ tools: { name: string; description: string }[] }>("/mcp/tools");
}
