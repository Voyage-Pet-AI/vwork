import { Hono } from "hono";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Config } from "../../config.js";
import type { LLMProvider } from "../../llm/provider.js";
import type { MCPClientManager } from "../../mcp/client.js";
import { listReports } from "../../report/memory.js";
import { runReportSubagent } from "../../report/runner.js";
import { buildUserMessage } from "../../report/prompt.js";
import type { ReportKind } from "../../report/types.js";

interface ReportRouteOptions {
  config: Config;
  provider: LLMProvider;
  mcpClient: MCPClientManager;
  customServerNames: string[];
}

export function reportRoutes(opts: ReportRouteOptions) {
  const app = new Hono();

  app.post("/run", async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      kind?: ReportKind;
      lookback_days?: number;
      prompt?: string;
    };

    const kind = body.kind ?? (opts.config.report.lookback_days >= 7 ? "weekly" : "daily");
    const lookbackDays = body.lookback_days ?? opts.config.report.lookback_days;
    const prompt = body.prompt ?? buildUserMessage(opts.config);

    try {
      const result = await runReportSubagent(
        {
          kind,
          lookbackDays,
          prompt,
          source: "cli",
          save: true,
        },
        {
          provider: opts.provider,
          mcpClient: opts.mcpClient,
          config: opts.config,
          customServerNames: opts.customServerNames,
        }
      );

      return c.json({
        content: result.content,
        savedPath: result.savedPath,
        saveError: result.saveError,
        kind: result.kind,
        lookbackDays: result.lookbackDays,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  app.get("/history", (c) => {
    const reports = listReports(opts.config);
    return c.json({ reports });
  });

  app.get("/:filename", (c) => {
    const filename = c.req.param("filename");
    const dir = opts.config.report.output_dir.replace("~", homedir());
    const filePath = join(dir, filename.endsWith(".md") ? filename : `${filename}.md`);

    if (!existsSync(filePath)) {
      return c.json({ error: "Report not found" }, 404);
    }

    const content = readFileSync(filePath, "utf-8");
    return c.json({ filename, content });
  });

  return app;
}
