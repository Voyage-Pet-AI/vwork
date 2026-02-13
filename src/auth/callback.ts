import { log } from "../utils/log.js";

/**
 * Start a local HTTP server and wait for an OAuth callback with an authorization code.
 * Returns the code from ?code=xxx. Rejects on error or 120s timeout.
 */
export function waitForOAuthCallback(port: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.stop();
      reject(new Error("OAuth timed out — no callback within 2 minutes."));
    }, 120_000);

    const server = Bun.serve({
      port,
      fetch(req) {
        const url = new URL(req.url);

        if (url.pathname !== "/callback") {
          return new Response("Not found", { status: 404 });
        }

        const errorParam = url.searchParams.get("error");
        if (errorParam) {
          const desc = url.searchParams.get("error_description") ?? errorParam;
          clearTimeout(timeout);
          setTimeout(() => {
            server.stop();
            reject(new Error(`OAuth denied: ${desc}`));
          }, 500);
          return new Response(htmlPage("Authorization Denied", desc), {
            headers: { "Content-Type": "text/html" },
          });
        }

        const code = url.searchParams.get("code");
        if (!code) {
          clearTimeout(timeout);
          setTimeout(() => {
            server.stop();
            reject(new Error("No authorization code received."));
          }, 500);
          return new Response(
            htmlPage("Error", "No authorization code received."),
            { headers: { "Content-Type": "text/html" } }
          );
        }

        clearTimeout(timeout);
        setTimeout(() => {
          server.stop();
          resolve(code);
        }, 500);

        return new Response(
          htmlPage(
            "Success!",
            "Authenticated with Atlassian. You can close this tab."
          ),
          { headers: { "Content-Type": "text/html" } }
        );
      },
    });

    log(`Waiting for OAuth callback on port ${port}...`);
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
