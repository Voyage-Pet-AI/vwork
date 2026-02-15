import { useState, useRef, useCallback, useEffect } from "react";
import { render, Box } from "ink";
import type { ChatSession } from "../chat/session.js";
import type { StreamCallbacks, ToolCall } from "../llm/provider.js";
import type { DisplayMessage, DisplayToolCall, AppStatus, ConnectedService } from "./types.js";
import { Header } from "./header.js";
import { CompletedMessages, ActiveMessage } from "./messages.js";
import { ChatInput } from "./input.js";

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

  const activeRef = useRef<DisplayMessage | null>(null);
  const hadActiveRef = useRef(false);

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
    setStatus("idle");
  }, []);

  const handleSend = useCallback(async (text: string) => {
    // Add user message to completed
    const userMsg: DisplayMessage = {
      id: nextId(),
      role: "user",
      content: text,
      toolCalls: [],
    };
    setCompletedMessages((prev) => [...prev, userMsg]);

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
          // Mark any running tool calls as error
          for (const tc of activeRef.current.toolCalls) {
            if (tc.status === "running") tc.status = "error";
          }
          activeRef.current.content += `\nError: ${err.message}`;
          setActiveMessage({ ...activeRef.current });
        }
      },
    };

    try {
      await session.send(text, callbacks);
    } catch (err) {
      if (activeRef.current) {
        activeRef.current.content += `\nError: ${err instanceof Error ? err.message : String(err)}`;
        setActiveMessage({ ...activeRef.current });
      }
    }

    finalizeActive();
  }, [session, finalizeActive]);

  const handleClear = useCallback(() => {
    session.clear();
    setCompletedMessages([]);
    setActiveMessage(null);
    activeRef.current = null;
    setStatus("idle");
  }, [session]);

  const handleHelp = useCallback(() => {
    const helpMsg: DisplayMessage = {
      id: nextId(),
      role: "assistant",
      content: "Commands:\n  /help     Show this help\n  /clear    Clear conversation history\n  /exit     Exit chat",
      toolCalls: [],
    };
    setCompletedMessages((prev) => [...prev, helpMsg]);
  }, []);

  return (
    <Box flexDirection="column">
      <Header services={services} />
      <CompletedMessages messages={completedMessages} />
      <ActiveMessage message={activeMessage} />
      <ChatInput
        status={status}
        onSubmit={handleSend}
        onExit={onExit}
        onClear={handleClear}
        onHelp={handleHelp}
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

    // Handle Ctrl+C at the Ink level
    process.on("SIGINT", handleExit);
  });
}
