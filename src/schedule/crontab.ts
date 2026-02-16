import { error as logError } from "../utils/log.js";
import { homedir } from "os";
import { join } from "path";
import { CronExpressionParser } from "cron-parser";

const TAG_PREFIX = "# vwork:";

function tag(name: string): string {
  return `${TAG_PREFIX}${name}`;
}

async function getCurrentCrontab(): Promise<string> {
  const proc = Bun.spawn(["crontab", "-l"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  // crontab -l returns 1 when no crontab exists
  if (exitCode !== 0) return "";
  return text;
}

async function writeCrontab(content: string): Promise<boolean> {
  const proc = Bun.spawn(["crontab", "-"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(content);
  proc.stdin.end();
  const exitCode = await proc.exited;
  return exitCode === 0;
}

function buildCronLine(name: string, cronExpr: string): string {
  const bunPath = process.execPath;
  const entryPoint = process.argv[1];
  const logPath = join(homedir(), "vwork", `schedule-${name}.log`);
  // Prepend PATH so bun and other tools are available in cron environment
  const pathDirs = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"].join(":");
  return `${cronExpr} PATH=${pathDirs}:$PATH ${bunPath} ${entryPoint} schedule run ${name} >> ${logPath} 2>&1 ${tag(name)}`;
}

export async function installCrontabEntry(name: string, cronExpr: string): Promise<boolean> {
  try {
    let current = await getCurrentCrontab();
    // Remove any existing entry for this schedule
    current = current
      .split("\n")
      .filter((line) => !line.includes(tag(name)))
      .join("\n");

    // Ensure trailing newline
    if (current && !current.endsWith("\n")) current += "\n";

    const newLine = buildCronLine(name, cronExpr);
    const updated = current + newLine + "\n";

    const ok = await writeCrontab(updated);
    if (!ok) {
      logError("Failed to write crontab");
      return false;
    }
    return true;
  } catch (e) {
    logError(`Crontab error: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

export async function removeCrontabEntry(name: string): Promise<boolean> {
  try {
    const current = await getCurrentCrontab();
    if (!current) return true;

    const filtered = current
      .split("\n")
      .filter((line) => !line.includes(tag(name)))
      .join("\n");

    return await writeCrontab(filtered);
  } catch (e) {
    logError(`Crontab error: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

export async function listCrontabEntries(): Promise<string[]> {
  const current = await getCurrentCrontab();
  if (!current) return [];
  return current
    .split("\n")
    .filter((line) => line.includes(TAG_PREFIX));
}

/**
 * Parse simple time expressions into cron expressions.
 * Supports: "9am", "3pm", "* /6h", "* /15m", or raw cron.
 */
export function parseTimeExpression(time: string): { cron: string; label: string } {
  // "9am", "3pm", etc.
  const ampmMatch = time.match(/^(\d{1,2})(am|pm)$/i);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1]);
    const isPm = ampmMatch[2].toLowerCase() === "pm";
    if (isPm && hour !== 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
    return { cron: `0 ${hour} * * *`, label: `Daily at ${time}` };
  }

  // "*/6h"
  const hoursMatch = time.match(/^\*\/(\d+)h$/);
  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1]);
    return { cron: `0 */${hours} * * *`, label: `Every ${hours} hour(s)` };
  }

  // "*/15m"
  const minsMatch = time.match(/^\*\/(\d+)m$/);
  if (minsMatch) {
    const minutes = parseInt(minsMatch[1]);
    return { cron: `*/${minutes} * * * *`, label: `Every ${minutes} minute(s)` };
  }

  // Assume raw cron expression
  return { cron: time, label: `Cron: ${time}` };
}

export function getNextRun(cronExpr: string): Date | null {
  try {
    const interval = CronExpressionParser.parse(cronExpr);
    return interval.next().toDate();
  } catch {
    return null;
  }
}

export function formatTimeUntil(target: Date): string {
  const diffMs = target.getTime() - Date.now();
  if (diffMs < 60_000) return "< 1m";

  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}
