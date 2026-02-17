import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import pc from "picocolors";
import { log, error } from "./utils/log.js";

const CACHE_PATH = join(homedir(), ".vwork", "update-check.json");
const NPM_REGISTRY_URL = "https://registry.npmjs.org/vwork/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 3000;

interface UpdateCache {
  lastCheck: number;
  latestVersion: string;
}

export function isNewerVersion(current: string, latest: string): boolean {
  const c = current.split(".").map(Number);
  const l = latest.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

function readCache(): UpdateCache | null {
  try {
    const raw = readFileSync(CACHE_PATH, "utf-8");
    return JSON.parse(raw) as UpdateCache;
  } catch {
    return null;
  }
}

function writeCache(cache: UpdateCache): void {
  try {
    mkdirSync(join(homedir(), ".vwork"), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(cache), "utf-8");
  } catch {
    // silent — cache is best-effort
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(NPM_REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function formatNotification(current: string, latest: string): string {
  return `${pc.dim("[vwork]")} Update available: ${pc.yellow(current)} → ${pc.green(latest)}  Run ${pc.cyan("`vwork update`")} to upgrade.`;
}

export async function startBackgroundUpdateCheck(currentVersion: string): Promise<string | null> {
  try {
    const cache = readCache();

    if (cache && Date.now() - cache.lastCheck < CHECK_INTERVAL_MS) {
      if (isNewerVersion(currentVersion, cache.latestVersion)) {
        return formatNotification(currentVersion, cache.latestVersion);
      }
      return null;
    }

    const latest = await fetchLatestVersion();
    if (!latest) return null;

    writeCache({ lastCheck: Date.now(), latestVersion: latest });

    if (isNewerVersion(currentVersion, latest)) {
      return formatNotification(currentVersion, latest);
    }
    return null;
  } catch {
    return null;
  }
}

export async function forceCheckUpdate(currentVersion: string): Promise<void> {
  log(`Current version: ${currentVersion}`);
  log("Checking for updates...");

  const latest = await fetchLatestVersion();
  if (!latest) {
    error("Failed to check for updates. Could not reach npm registry.");
    return;
  }

  writeCache({ lastCheck: Date.now(), latestVersion: latest });

  if (isNewerVersion(currentVersion, latest)) {
    log(`Update available: ${currentVersion} → ${latest}`);
    log(`Run "vwork update" to upgrade.`);
  } else {
    log(`You're on the latest version (${currentVersion}).`);
  }
}

export async function detectInstallMethod(): Promise<"homebrew" | "npm" | "source"> {
  const execPath = process.argv[1] ?? "";

  if (execPath.includes("homebrew") || execPath.includes("Cellar") || execPath.includes("linuxbrew")) {
    return "homebrew";
  }

  if (execPath.includes("node_modules")) {
    return "npm";
  }

  // Heuristic: check if vwork is in a global npm/bun bin path
  try {
    const proc = Bun.spawn(["npm", "list", "-g", "vwork", "--depth=0"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    if (text.includes("vwork@")) return "npm";
  } catch {
    // not installed via npm
  }

  return "source";
}

export async function executeUpdate(currentVersion: string): Promise<void> {
  log("Checking for updates...");

  const latest = await fetchLatestVersion();
  if (!latest) {
    error("Failed to check for updates. Could not reach npm registry.");
    process.exit(1);
  }

  writeCache({ lastCheck: Date.now(), latestVersion: latest });

  if (!isNewerVersion(currentVersion, latest)) {
    log(`Already on the latest version (${currentVersion}).`);
    return;
  }

  log(`Update available: ${currentVersion} → ${latest}`);

  const method = await detectInstallMethod();
  log(`Detected install method: ${method}`);

  switch (method) {
    case "homebrew": {
      log("Running: brew upgrade vwork");
      const proc = Bun.spawn(["brew", "upgrade", "vwork"], {
        stdout: "inherit",
        stderr: "inherit",
      });
      const code = await proc.exited;
      if (code !== 0) {
        error("brew upgrade failed. Try manually: brew upgrade vwork");
        process.exit(1);
      }
      log("Updated successfully!");
      break;
    }
    case "npm": {
      log("Running: npm install -g vwork@latest");
      const proc = Bun.spawn(["npm", "install", "-g", "vwork@latest"], {
        stdout: "inherit",
        stderr: "inherit",
      });
      const code = await proc.exited;
      if (code !== 0) {
        error("npm install failed. Try manually: npm install -g vwork@latest");
        process.exit(1);
      }
      log("Updated successfully!");
      break;
    }
    case "source": {
      log("It looks like vwork was installed from source.");
      log("To update, pull the latest changes and rebuild:");
      log("  cd <vwork-repo> && git pull && bun install && bun run build");
      break;
    }
  }
}
