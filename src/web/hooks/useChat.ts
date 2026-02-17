import { useState, useCallback, useRef } from "react";
import type { DisplayMessage, ContentBlock, AppStatus } from "../lib/types.js";
import { sendMessage, abortChat, clearChat } from "../lib/api.js";
import { useSSE } from "./useSSE.js";

let msgCounter = 0;
function nextId() {
  return `msg_${++msgCounter}`;
}

export function useChat() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [activeMessage, setActiveMessage] = useState<DisplayMessage | null>(null);
  const [status, setStatus] = useState<AppStatus>("idle");
  const activeRef = useRef(activeMessage);
  activeRef.current = activeMessage;

  const ensureActiveMessage = useCallback((): void => {
    if (activeRef.current) return;
    const msg: DisplayMessage = { id: nextId(), role: "assistant", blocks: [] };
    activeRef.current = msg;
    setActiveMessage(msg);
  }, []);

  const updateActive = useCallback((updater: (msg: DisplayMessage) => DisplayMessage) => {
    setActiveMessage((prev) => {
      if (!prev) {
        // Already completed — keep null and sync ref
        activeRef.current = null;
        return null;
      }
      const next = updater(prev);
      activeRef.current = next;
      return next;
    });
  }, []);

  useSSE("/api/chat/events", {
    onText: (data) => {
      ensureActiveMessage();
      updateActive((m) => {
        const lastBlock = m.blocks[m.blocks.length - 1];
        if (lastBlock?.type === "text") {
          const blocks = [...m.blocks];
          blocks[blocks.length - 1] = { type: "text", text: lastBlock.text + data.delta };
          return { ...m, blocks };
        }
        return { ...m, blocks: [...m.blocks, { type: "text", text: data.delta }] };
      });
    },

    onToolStart: (data) => {
      ensureActiveMessage();
      updateActive((m) => ({
        ...m,
        blocks: [
          ...m.blocks,
          {
            type: "tool_call",
            toolCall: {
              id: data.id,
              name: data.name,
              displayName: data.displayName,
              summary: data.summary,
              status: "running" as const,
            },
          },
        ],
      }));
    },

    onToolEnd: (data) => {
      updateActive((m) => ({
        ...m,
        blocks: m.blocks.map((b): ContentBlock => {
          if (b.type === "tool_call" && b.toolCall.id === data.id) {
            return {
              type: "tool_call",
              toolCall: {
                ...b.toolCall,
                status: data.status === "error" ? "error" : "done",
                resultSummary: data.resultSummary,
              },
            };
          }
          return b;
        }),
      }));
    },

    onComplete: () => {
      // Use functional updater so `prev` includes ALL queued text deltas
      // (the last onText and onComplete can arrive in the same microtask)
      setActiveMessage((prev) => {
        if (prev) {
          setMessages((msgs) => {
            // StrictMode guard: React may double-invoke this updater
            if (msgs.length > 0 && msgs[msgs.length - 1].id === prev.id) return msgs;
            return [...msgs, prev];
          });
        }
        activeRef.current = null;
        return null;
      });
      setStatus("idle");
    },

    onError: (data) => {
      updateActive((m) => ({
        ...m,
        blocks: [...m.blocks, { type: "text", text: `\n\nError: ${data.message}` }],
      }));
    },

    onStatus: (data) => {
      setStatus(data.status as AppStatus);
    },

    onUserMessage: (data) => {
      const userMsg: DisplayMessage = {
        id: nextId(),
        role: "user",
        blocks: [{ type: "text", text: data.message }],
      };
      setMessages((msgs) => [...msgs, userMsg]);
    },
  });

  const send = useCallback(async (text: string) => {
    if (!text.trim()) return;
    try {
      await sendMessage(text);
    } catch (err) {
      // If send fails, add the error as a message
      const errMsg: DisplayMessage = {
        id: nextId(),
        role: "assistant",
        blocks: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      };
      setMessages((msgs) => [...msgs, errMsg]);
    }
  }, []);

  const abort = useCallback(async () => {
    try {
      await abortChat();
    } catch {
      // best effort
    }
  }, []);

  const clear = useCallback(async () => {
    try {
      await clearChat();
      setMessages([]);
      setActiveMessage(null);
      activeRef.current = null;
    } catch {
      // best effort
    }
  }, []);

  return { messages, activeMessage, status, send, abort, clear };
}
