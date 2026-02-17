import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ChatSession } from "../../chat/session.js";
import type { ToolCall } from "../../llm/provider.js";
import { friendlyToolName, toolCallSummary, toolResultSummary } from "../../tui/tool-summary.js";

export type ChatState = {
  session: ChatSession;
  status: "idle" | "streaming" | "tool_running";
  abortController: AbortController | null;
  sseClients: Set<{
    write: (event: string, data: string) => void;
  }>;
};

function truncate(s: string, max = 200): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

export function chatRoutes(state: ChatState) {
  const app = new Hono();

  function broadcast(event: string, data: string) {
    for (const client of state.sseClients) {
      void client.write(event, data);
    }
  }

  function setStatus(status: ChatState["status"]) {
    state.status = status;
    broadcast("status", JSON.stringify({ status }));
  }

  app.get("/events", (c) => {
    return streamSSE(c, async (stream) => {
      const client = {
        write: (event: string, data: string) => {
          stream.writeSSE({ event, data });
        },
      };

      state.sseClients.add(client);

      // Send current status on connect
      stream.writeSSE({
        event: "status",
        data: JSON.stringify({ status: state.status }),
      });

      // Keep alive
      const keepAlive = setInterval(() => {
        stream.writeSSE({ event: "ping", data: "{}" });
      }, 15000);

      try {
        while (true) {
          await stream.sleep(1000);
        }
      } catch {
        // Client disconnected
      } finally {
        clearInterval(keepAlive);
        state.sseClients.delete(client);
      }
    });
  });

  app.post("/send", async (c) => {
    let body: { message?: string };
    try {
      body = await c.req.json<{ message: string }>();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const message = body.message?.trim();
    if (!message) {
      return c.json({ error: "message is required" }, 400);
    }

    if (state.status !== "idle") {
      return c.json({ error: "A request is already in progress" }, 409);
    }

    broadcast("user_message", JSON.stringify({ message }));

    const controller = new AbortController();
    state.abortController = controller;
    setStatus("streaming");

    // Run in background — return immediately
    (async () => {
      const callbacks = {
        onText: (delta: string) => {
          broadcast("text", JSON.stringify({ delta }));
        },
        onToolStart: (tc: ToolCall) => {
          setStatus("tool_running");
          broadcast("tool_start", JSON.stringify({
            id: tc.id,
            name: tc.name,
            displayName: friendlyToolName(tc.name),
            summary: toolCallSummary(tc),
          }));
        },
        onToolEnd: (tc: ToolCall, result: string, isError?: boolean) => {
          setStatus("streaming");
          broadcast("tool_end", JSON.stringify({
            id: tc.id,
            status: isError ? "error" : "done",
            resultSummary: truncate(toolResultSummary(tc.name, result, isError)),
          }));
        },
        onComplete: () => {
          // Ignore — chatStream() calls this after each round, but we only
          // want to signal "complete" after the entire send() finishes.
        },
        onError: (err: Error) => {
          broadcast("error", JSON.stringify({ message: err.message }));
        },
      };

      try {
        await state.session.send(message, callbacks, controller.signal);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        broadcast("error", JSON.stringify({ message: msg }));
      } finally {
        // If abortController is null, the /abort endpoint already
        // broadcast "complete" and set status to "idle" — skip to
        // avoid duplicate events.
        if (state.abortController) {
          broadcast("complete", "{}");
          setStatus("idle");
          state.abortController = null;
        }
      }
    })();

    return c.json({ ok: true });
  });

  app.post("/abort", (c) => {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
      setStatus("idle");
      broadcast("complete", "{}");
    }
    return c.json({ ok: true });
  });

  app.post("/clear", (c) => {
    state.session.clear();
    return c.json({ ok: true });
  });

  return app;
}
