import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Config } from "../config.js";
import { resolveSecret } from "../config.js";
import { error as logError, debug } from "../utils/log.js";
import { VectorDB } from "../memory/vectordb.js";
import { EmbeddingClient } from "../memory/embeddings.js";

function resolveDir(config: Config): string {
  const dir = config.report.output_dir.replace("~", homedir());
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadPastReports(config: Config): string {
  const dir = resolveDir(config);
  if (!existsSync(dir)) return "";

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse()
    .slice(0, config.report.memory_depth);

  if (files.length === 0) return "";

  return files
    .map((f) => {
      const content = readFileSync(join(dir, f), "utf-8");
      const date = f.replace(".md", "");
      return `--- Report from ${date} ---\n${content}`;
    })
    .join("\n\n");
}

export interface RelevantReports {
  content: string;
  usedVectorSearch: boolean;
}

export interface SaveReportOptions {
  kind?: "daily" | "weekly" | "custom";
  timestamp?: Date;
}

function getMemoryClient(config: Config): { db: VectorDB; client: EmbeddingClient } | null {
  if (!config.memory?.enabled) return null;

  const apiKey = resolveSecret(config.memory.api_key_env);
  if (!apiKey) {
    logError("Memory enabled but no Voyage API key found. Falling back to recency-based loading.");
    return null;
  }

  try {
    const db = new VectorDB(config.memory.db_path);
    const client = new EmbeddingClient(apiKey, config.memory.embedding_model);
    return { db, client };
  } catch (e) {
    logError(`Failed to initialize vector DB: ${e instanceof Error ? e.message : e}. Falling back to recency-based loading.`);
    return null;
  }
}

export async function loadRelevantReports(config: Config): Promise<RelevantReports> {
  const mem = getMemoryClient(config);
  if (!mem) {
    return { content: loadPastReports(config), usedVectorSearch: false };
  }

  const { db, client } = mem;
  try {
    const stats = db.getStats();
    if (stats.reports === 0 && stats.notes === 0) {
      debug("Vector DB is empty, falling back to recency-based loading.");
      return { content: loadPastReports(config), usedVectorSearch: false };
    }

    // Build a query from current context
    const today = new Date().toISOString().split("T")[0];
    const orgs = config.github.orgs?.join(", ") ?? "";
    const channels = config.slack.channels?.join(", ") ?? "";
    const queryText = `Work report for ${today}. Organizations: ${orgs}. Channels: ${channels}.`;

    debug(`Vector search query: ${queryText}`);
    const queryEmbedding = await client.embedQuery(queryText);

    const limit = config.report.memory_depth;
    const results = db.query(queryEmbedding, limit);

    if (results.length === 0) {
      debug("Vector search returned no results, falling back to recency-based loading.");
      return { content: loadPastReports(config), usedVectorSearch: false };
    }

    debug(`Vector search returned ${results.length} results`);

    const content = results
      .map((r) => {
        const label = r.type === "note" ? "Note" : "Report";
        const score = (1 - r.distance).toFixed(3);
        return `--- ${label} from ${r.date} (relevance: ${score}) ---\n${r.content}`;
      })
      .join("\n\n");

    return { content, usedVectorSearch: true };
  } catch (e) {
    logError(`Vector search failed: ${e instanceof Error ? e.message : e}. Falling back to recency-based loading.`);
    return { content: loadPastReports(config), usedVectorSearch: false };
  } finally {
    db.close();
  }
}

export function buildReportFilename(options?: SaveReportOptions): string {
  const kind = options?.kind ?? "custom";
  const now = options?.timestamp ?? new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}${min}-${kind}.md`;
}

export async function saveReport(config: Config, report: string, options?: SaveReportOptions): Promise<string> {
  const dir = resolveDir(config);
  const path = join(dir, buildReportFilename(options));
  writeFileSync(path, report);

  // Embed and store in vector DB if memory is enabled
  const mem = getMemoryClient(config);
  if (mem) {
    const { db, client } = mem;
    try {
      const embedding = await client.embedDocument(report);
      db.upsert("report", date, report, embedding, config.memory!.embedding_model);
      debug(`Report embedded and stored in vector DB`);
    } catch (e) {
      logError(`Failed to embed report: ${e instanceof Error ? e.message : e}`);
    } finally {
      db.close();
    }
  }

  return path;
}

export function listReports(config: Config): string[] {
  const dir = resolveDir(config);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse();
}
