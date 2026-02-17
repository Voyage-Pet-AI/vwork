import { Hono } from "hono";
import type { Config } from "../../config.js";

export function configRoutes(config: Config) {
  const app = new Hono();

  app.get("/", (c) => {
    // Return a safe subset — no secrets
    return c.json({
      llm: {
        provider: config.llm.provider,
        model: config.llm.model,
      },
      github: {
        enabled: config.github.enabled,
        orgs: config.github.orgs,
      },
      jira: {
        enabled: config.jira.enabled,
      },
      slack: {
        enabled: config.slack.enabled,
        channels: config.slack.channels,
      },
      report: {
        lookback_days: config.report.lookback_days,
      },
      todo: {
        enabled: config.todo.enabled,
      },
    });
  });

  return app;
}
