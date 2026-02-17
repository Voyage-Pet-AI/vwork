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

  const ensureActiveMessage = useCallback((): DisplayMessage => {
    if (activeRef.current) return activeRef.current;
    const msg: DisplayMessage = { id: nextId(), role: "assistant", blocks: [] };
    activeRef.current = msg;
    setActiveMessage(msg);
    return msg;
  }, []);

  const updateActive = useCallback((updater: (msg: DisplayMessage) => DisplayMessage) => {
    setActiveMessage((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      activeRef.current = next;
      return next;
    });
  }, []);

  useSSE("/api/chat/events", {
    onText: (data) => {
      const msg = ensureActiveMessage();
      const lastBlock = msg.blocks[msg.blocks.length - 1];
      if (lastBlock?.type === "text") {
        updateActive((m) => {
          const blocks = [...m.blocks];
          const last = blocks[blocks.length - 1] as { type: "text"; text: string };
          blocks[blocks.length - 1] = { type: "text", text: last.text + data.delta };
          return { ...m, blocks };
        });
      } else {
        updateActive((m) => ({
          ...m,
          blocks: [...m.blocks, { type: "text", text: data.delta }],
        }));
      }
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
      setActiveMessage((prev) => {
        if (prev) {
          setMessages((msgs) => [...msgs, prev]);
        }
        activeRef.current = null;
        return null;
      });
      setStatus("idle");
    },

    onError: (data) => {
      // Append error as text block
      if (activeRef.current) {
        updateActive((m) => ({
          ...m,
          blocks: [...m.blocks, { type: "text", text: `\n\nError: ${data.message}` }],
        }));
      }
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
