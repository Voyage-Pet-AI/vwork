import { loadTokens, saveTokens } from "./tokens.js";
import type { SlackTokenData } from "./tokens.js";
import { log } from "../utils/log.js";

const REDIRECT_PORT = 8371;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const SCOPES = "channels:history,channels:read,users:read,search:read";

/**
 * Run the Slack OAuth v2 flow:
 * 1. Start local HTTP server for callback
 * 2. Open browser to Slack authorize URL
 * 3. Receive code via callback, exchange for token
 * 4. Save token to ~/reporter/tokens.json
 */
export async function performSlackOAuth(
  clientId: string,
  clientSecret: string
): Promise<void> {
  const state = crypto.randomUUID();

  const authUrl =
    `https://slack.com/oauth/v2/authorize?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${encodeURIComponent(state)}`;

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.stop();
      reject(new Error("OAuth timed out — no response within 2 minutes."));
    }, 120_000);

    const server = Bun.serve({
      port: REDIRECT_PORT,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname !== "/callback") {
          return new Response("Not found", { status: 404 });
        }

        const returnedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const errorParam = url.searchParams.get("error");

        if (errorParam) {
          clearTimeout(timeout);
          server.stop();
          reject(new Error(`Slack OAuth denied: ${errorParam}`));
          return new Response(htmlPage("Authorization Denied", "You can close this tab."), {
            headers: { "Content-Type": "text/html" },
          });
        }

        if (returnedState !== state) {
          clearTimeout(timeout);
          server.stop();
          reject(new Error("OAuth state mismatch — possible CSRF."));
          return new Response(htmlPage("Error", "State mismatch. Please try again."), {
            headers: { "Content-Type": "text/html" },
          });
        }

        if (!code) {
          clearTimeout(timeout);
          server.stop();
          reject(new Error("No authorization code received."));
          return new Response(htmlPage("Error", "No code received."), {
            headers: { "Content-Type": "text/html" },
          });
        }

        // Exchange code for token
        try {
          const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              code,
              redirect_uri: REDIRECT_URI,
            }),
          });

          const data = await tokenRes.json() as {
            ok: boolean;
            error?: string;
            access_token?: string;
            token_type?: string;
            scope?: string;
            team?: { id: string; name: string };
          };

          if (!data.ok || !data.access_token) {
            throw new Error(`Slack token exchange failed: ${data.error ?? "unknown error"}`);
          }

          const tokenData: SlackTokenData = {
            access_token: data.access_token,
            token_type: data.token_type ?? "bot",
            scope: data.scope ?? "",
            team: data.team ?? { id: "unknown", name: "unknown" },
            obtained_at: new Date().toISOString(),
          };

          const store = loadTokens();
          store.slack = tokenData;
          saveTokens(store);

          log(`Slack authenticated for team "${tokenData.team.name}"`);

          clearTimeout(timeout);
          // Stop server after a short delay so the response is sent
          setTimeout(() => {
            server.stop();
            resolve();
          }, 500);

          return new Response(
            htmlPage("Success!", `Authenticated with Slack team <strong>${tokenData.team.name}</strong>. You can close this tab.`),
            { headers: { "Content-Type": "text/html" } }
          );
        } catch (e) {
          clearTimeout(timeout);
          server.stop();
          reject(e);
          return new Response(htmlPage("Error", "Token exchange failed."), {
            headers: { "Content-Type": "text/html" },
          });
        }
      },
    });

    log("Opening browser for Slack authorization...");

    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    Bun.spawn([opener, authUrl], { stdio: ["ignore", "ignore", "ignore"] });

    log("Waiting for authorization (2 minute timeout)...");
  });
}

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Reporter — ${title}</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5}
.card{background:#fff;padding:2rem 3rem;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center}
h1{margin:0 0 .5rem}</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
}
