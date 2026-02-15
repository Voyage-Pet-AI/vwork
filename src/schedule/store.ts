import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface Schedule {
  name: string;
  prompt: string;
  cron: string;
  frequencyLabel: string;
  createdAt: string;
}

interface ScheduleStore {
  schedules: Schedule[];
}

const STORE_PATH = join(homedir(), "reporter", "schedules.json");

function ensureDir() {
  mkdirSync(join(homedir(), "reporter"), { recursive: true });
}

export function loadSchedules(): Schedule[] {
  if (!existsSync(STORE_PATH)) return [];
  const raw = readFileSync(STORE_PATH, "utf-8");
  const store = JSON.parse(raw) as ScheduleStore;
  return store.schedules ?? [];
}

function saveSchedules(schedules: Schedule[]): void {
  ensureDir();
  const store: ScheduleStore = { schedules };
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + "\n");
}

export function addSchedule(schedule: Schedule): void {
  const schedules = loadSchedules();
  schedules.push(schedule);
  saveSchedules(schedules);
}

export function removeSchedule(name: string): boolean {
  const schedules = loadSchedules();
  const filtered = schedules.filter((s) => s.name !== name);
  if (filtered.length === schedules.length) return false;
  saveSchedules(filtered);
  return true;
}

export function getSchedule(name: string): Schedule | undefined {
  return loadSchedules().find((s) => s.name === name);
}

export function listSchedules(): Schedule[] {
  return loadSchedules();
}
