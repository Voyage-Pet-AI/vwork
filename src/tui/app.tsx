import { useState, useRef, useCallback, useEffect } from "react";
import { render, Box } from "ink";
import type { ChatSession } from "../chat/session.js";
import type { StreamCallbacks, ToolCall } from "../llm/provider.js";
import type { DisplayMessage, DisplayToolCall, AppStatus, ConnectedService } from "./types.js";
import { Header } from "./header.js";
import { CompletedMessages, ActiveMessage, QueuedMessages } from "./messages.js";
import { ChatInput } from "./input.js";
import { parseFileMentions, resolveFileMentions, buildMessageWithFiles } from "./file-mentions.js";

interface AppProps {
  session: ChatSession;
  services: ConnectedService[];
  onExit: () => void;
}

let msgCounter = 0;
function nextId(): string {
  return String(++msgCounter);
}

function App({ session, services, onExit }: AppProps) {
  const [completedMessages, setCompletedMessages] = useState<DisplayMessage[]>([]);
  const [activeMessage, setActiveMessage] = useState<DisplayMessage | null>(null);
  const [status, setStatus] = useState<AppStatus>("idle");
  const [queuedMessages, setQueuedMessages] = useState<DisplayMessage[]>([]);

  const activeRef = useRef<DisplayMessage | null>(null);
  const hadActiveRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (activeMessage) {
      hadActiveRef.current = true;
    } else if (hadActiveRef.current) {
      hadActiveRef.current = false;
      const timer = setTimeout(() => {
        process.stdout.write('\x1B[0J');
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [activeMessage]);

  const finalizeActive = useCallback(() => {
    if (activeRef.current) {
      // Mark any remaining running tool calls as done
      for (const tc of activeRef.current.toolCalls) {
        if (tc.status === "running") tc.status = "done";
      }
      setCompletedMessages((prev) => [...prev, activeRef.current!]);
      activeRef.current = null;
      setActiveMessage(null);
    }
    abortRef.current = null;
    setStatus("idle");
  }, []);

  const processMessage = useCallback(async (text: string) => {
    const controller = new AbortController();
    abortRef.current = controller;

    // Create active assistant message
    const assistantMsg: DisplayMessage = {
      id: nextId(),
      role: "assistant",
      content: "",
      toolCalls: [],
    };
    activeRef.current = assistantMsg;
    setActiveMessage({ ...assistantMsg });
    setStatus("streaming");

    const callbacks: StreamCallbacks = {
      onText: (delta: string) => {
        if (activeRef.current) {
          activeRef.current.content += delta;
          setActiveMessage({ ...activeRef.current });
        }
      },
      onToolStart: (tc: ToolCall) => {
        if (activeRef.current) {
          setStatus("tool_running");
          const displayTc: DisplayToolCall = {
            id: tc.id,
            name: tc.name,
            displayName: tc.name.replace("__", " → "),
            status: "running",
          };
          activeRef.current.toolCalls.push(displayTc);
          setActiveMessage({ ...activeRef.current });
        }
      },
      onToolEnd: (tc: ToolCall) => {
        if (activeRef.current) {
          const found = activeRef.current.toolCalls.find((t) => t.id === tc.id);
          if (found) found.status = "done";
          setActiveMessage({ ...activeRef.current });
          setStatus("streaming");
        }
      },
      onComplete: () => {
        // No-op — finalization happens when session.send() resolves
      },
      onError: (err: Error) => {
        if (activeRef.current) {
          for (const tc of activeRef.current.toolCalls) {
            if (tc.status === "running") tc.status = "error";
          }
          activeRef.current.content += `\nError: ${err.message}`;
          setActiveMessage({ ...activeRef.current });
        }
      },
    };

    try {
      await session.send(text, callbacks, controller.signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        if (activeRef.current) {
          activeRef.current.content += "\n[aborted]";
          setActiveMessage({ ...activeRef.current });
        }
      } else if (activeRef.current) {
        activeRef.current.content += `\nError: ${err instanceof Error ? err.message : String(err)}`;
        setActiveMessage({ ...activeRef.current });
      }
    }

    finalizeActive();
  }, [session, finalizeActive]);

  const handleSend = useCallback(async (text: string) => {
    const isBusy = status !== "idle";
    const mentionedPaths = parseFileMentions(text);
    const mentions = mentionedPaths.length > 0 ? await resolveFileMentions(mentionedPaths) : [];
    const enhancedText = mentions.length > 0 ? buildMessageWithFiles(text, mentions) : text;
    const filePaths = mentions.map((m) => m.path);

    if (isBusy) {
      // Queue the message
      const userMsg: DisplayMessage = {
        id: nextId(),
        role: "user",
        content: text,
        toolCalls: [],
        queued: true,
        files: filePaths.length > 0 ? filePaths : undefined,
        _sendContent: enhancedText !== text ? enhancedText : undefined,
      };
      setQueuedMessages((prev) => [...prev, userMsg]);
      return;
    }

    // Add user message to completed and process
    const userMsg: DisplayMessage = {
      id: nextId(),
      role: "user",
      content: text,
      toolCalls: [],
      files: filePaths.length > 0 ? filePaths : undefined,
    };
    setCompletedMessages((prev) => [...prev, userMsg]);
    processMessage(enhancedText);
  }, [status, processMessage]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Dequeue: when idle and there are queued messages, process the next one
  useEffect(() => {
    if (status !== "idle" || queuedMessages.length === 0) return;

    const [next, ...rest] = queuedMessages;
    setQueuedMessages(rest);

    // Move to completed without the queued flag
    const userMsg: DisplayMessage = {
      id: next.id,
      role: "user",
      content: next.content,
      toolCalls: [],
      files: next.files,
    };
    setCompletedMessages((prev) => [...prev, userMsg]);
    processMessage(next._sendContent ?? next.content);
  }, [status, queuedMessages, processMessage]);

  const handleClear = useCallback(() => {
    // Clear terminal screen + scrollback so <Static> output is removed
    process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
    session.clear();
    setCompletedMessages([]);
    setActiveMessage(null);
    setQueuedMessages([]);
    activeRef.current = null;
    abortRef.current = null;
    setStatus("idle");
  }, [session]);

  const handleCopy = useCallback(() => {
    const last = [...completedMessages].reverse().find(
      (m) => m.role === "assistant" && m.content.trim()
    );
    if (!last) {
      const msg: DisplayMessage = {
        id: nextId(),
        role: "assistant",
        content: "Nothing to copy.",
        toolCalls: [],
      };
      setCompletedMessages((prev) => [...prev, msg]);
      return;
    }
    const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" });
    proc.stdin.write(last.content);
    proc.stdin.end();
    const msg: DisplayMessage = {
      id: nextId(),
      role: "assistant",
      content: "Copied to clipboard.",
      toolCalls: [],
    };
    setCompletedMessages((prev) => [...prev, msg]);
  }, [completedMessages]);

  const handleHelp = useCallback(() => {
    const helpMsg: DisplayMessage = {
      id: nextId(),
      role: "assistant",
      content: "Commands:\n  /help     Show this help\n  /copy     Copy last response to clipboard\n  /clear    Clear conversation history\n  /exit     Exit chat",
      toolCalls: [],
    };
    setCompletedMessages((prev) => [...prev, helpMsg]);
  }, []);

  return (
    <Box flexDirection="column">
      {completedMessages.length === 0 && !activeMessage && <Header services={services} />}
      <CompletedMessages messages={completedMessages} />
      <ActiveMessage message={activeMessage} />
      <QueuedMessages messages={queuedMessages} />
      <ChatInput
        status={status}
        onSubmit={handleSend}
        onAbort={abort}
        onExit={onExit}
        onClear={handleClear}
        onHelp={handleHelp}
        onCopy={handleCopy}
      />
    </Box>
  );
}

interface StartTUIOptions {
  session: ChatSession;
  services: ConnectedService[];
}

export async function startTUI(options: StartTUIOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    const handleExit = () => {
      inkInstance.unmount();
      resolve();
    };

    const inkInstance = render(
      <App
        session={options.session}
        services={options.services}
        onExit={handleExit}
      />,
      { exitOnCtrlC: false }
    );

  });
}
