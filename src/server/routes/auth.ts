import { Hono } from "hono";
import type { Config } from "../../config.js";
import { loadStoredGitHubToken, logoutGitHub } from "../../auth/github.js";
import { hasAnthropicAuth, logoutAnthropic } from "../../auth/anthropic.js";
import { hasOpenAIAuth, logoutOpenAI } from "../../auth/openai.js";
import { hasAtlassianAuth, clearAtlassianAuth } from "../../auth/atlassian.js";
import { logoutSlack } from "../../auth/slack.js";
import { getSlackToken } from "../../auth/tokens.js";
import { resolveSecret } from "../../config.js";

export function authRoutes(config: Config) {
  const app = new Hono();

  app.get("/status", (c) => {
    const githubToken = loadStoredGitHubToken() || config.github.token_env;
    const slackToken = getSlackToken() || (config.slack.token_env && resolveSecret(config.slack.token_env));

    const services = {
      github: { connected: !!githubToken },
      jira: { connected: hasAtlassianAuth() },
      slack: { connected: !!slackToken },
      anthropic: { connected: hasAnthropicAuth(config).mode !== "none" },
      openai: { connected: hasOpenAIAuth(config).mode !== "none" },
    };

    return c.json({ services });
  });

  app.post("/logout/:service", (c) => {
    const service = c.req.param("service");
    switch (service) {
      case "github":
        logoutGitHub();
        break;
      case "jira":
        clearAtlassianAuth();
        break;
      case "slack":
        logoutSlack();
        break;
      case "anthropic":
        logoutAnthropic();
        break;
      case "openai":
        logoutOpenAI();
        break;
      default:
        return c.json({ error: `Unknown service: ${service}` }, 400);
    }
    return c.json({ ok: true });
  });

  return app;
}
