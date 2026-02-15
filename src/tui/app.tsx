import { useState, useRef, useCallback, useEffect } from "react";
import { render, Box } from "ink";
import type { ChatSession } from "../chat/session.js";
import type { StreamCallbacks, ToolCall } from "../llm/provider.js";
import type { DisplayMessage, DisplayToolCall, AppStatus, ConnectedService } from "./types.js";
import { Header } from "./header.js";
import { CompletedMessages, ActiveMessage, QueuedMessages } from "./messages.js";
import { ChatInput } from "./input.js";
import { parseFileMentions, resolveFileMentions, buildMessageWithFiles } from "./file-mentions.js";
import { toolCallSummary, friendlyToolName, toolResultSummary } from "./tool-summary.js";
import { listSchedules, addSchedule, removeSchedule } from "../schedule/store.js";
import { installCrontabEntry, removeCrontabEntry, parseTimeExpression } from "../schedule/crontab.js";

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
  const interceptorRef = useRef<((text: string) => void) | null>(null);

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
            displayName: friendlyToolName(tc.name),
            summary: toolCallSummary(tc),
            status: "running",
          };
          activeRef.current.toolCalls.push(displayTc);
          setActiveMessage({ ...activeRef.current });
        }
      },
      onToolEnd: (tc: ToolCall, result: string, isError?: boolean) => {
        if (activeRef.current) {
          const found = activeRef.current.toolCalls.find((t) => t.id === tc.id);
          if (found) {
            found.status = isError ? "error" : "done";
            found.resultSummary = toolResultSummary(tc.name, result, isError);
          }
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
            if (tc.status === "running") {
              tc.status = "error";
              tc.resultSummary = err.message;
            }
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
    // If a wizard interceptor is active, route input there instead
    if (interceptorRef.current) {
      interceptorRef.current(text);
      return;
    }

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
      content: "Commands:\n  /help       Show this help\n  /schedule   Manage scheduled reports\n  /copy       Copy last response to clipboard\n  /clear      Clear conversation history\n  /exit       Exit chat",
      toolCalls: [],
    };
    setCompletedMessages((prev) => [...prev, helpMsg]);
  }, []);

  const addSystemMessage = useCallback((content: string) => {
    const msg: DisplayMessage = {
      id: nextId(),
      role: "assistant",
      content,
      toolCalls: [],
    };
    setCompletedMessages((prev) => [...prev, msg]);
  }, []);

  const waitForInput = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      interceptorRef.current = (text: string) => {
        const userMsg: DisplayMessage = {
          id: nextId(),
          role: "user",
          content: text,
          toolCalls: [],
        };
        setCompletedMessages((prev) => [...prev, userMsg]);
        interceptorRef.current = null;
        resolve(text.trim());
      };
    });
  }, []);

  const handleSchedule = useCallback(async (subcommand: string) => {
    const sub = subcommand.trim().split(/\s+/);
    const action = sub[0] || "";

    if (action === "" || action === "list") {
      const schedules = listSchedules();
      if (schedules.length === 0) {
        addSystemMessage("No schedules yet. Use `/schedule add` to create one.");
      } else {
        const lines = schedules.map(
          (s) => `  **${s.name}** — ${s.frequencyLabel} (cron: \`${s.cron}\`)`
        );
        addSystemMessage("Scheduled reports:\n" + lines.join("\n"));
      }
      return;
    }

    if (action === "remove") {
      const name = sub[1];
      if (!name) {
        addSystemMessage("Usage: `/schedule remove <name>`");
        return;
      }
      const removed = removeSchedule(name);
      if (!removed) {
        addSystemMessage(`No schedule named "${name}" found.`);
        return;
      }
      await removeCrontabEntry(name);
      addSystemMessage(`Schedule "${name}" removed.`);
      return;
    }

    if (action === "add") {
      // Step 1: Name
      addSystemMessage("What should this schedule be called? (e.g. `morning-standup`)");
      let name = "";
      while (true) {
        name = await waitForInput();
        if (/^[a-z0-9][a-z0-9-]*$/.test(name)) break;
        addSystemMessage("Invalid name. Use lowercase letters, numbers, and hyphens (must start with a letter or number).");
      }

      // Check for duplicates
      const existing = listSchedules();
      if (existing.some((s) => s.name === name)) {
        addSystemMessage(`A schedule named "${name}" already exists. Use \`/schedule remove ${name}\` first.`);
        return;
      }

      // Step 2: Prompt
      addSystemMessage("Custom prompt for this report (press Enter for default):");
      const customPrompt = await waitForInput();

      // Step 3: Frequency
      addSystemMessage(
        "How often?\n  `1` — Daily at 9am\n  `2` — Weekdays at 9am\n  `3` — Weekly Monday 9am\n  `4` — Custom (e.g. `*/15m`, `3pm`, or cron expression)"
      );
      const choice = await waitForInput();

      let cronExpr: string;
      let frequencyLabel: string;

      switch (choice) {
        case "1":
          cronExpr = "0 9 * * *";
          frequencyLabel = "Daily at 9am";
          break;
        case "2":
          cronExpr = "0 9 * * 1-5";
          frequencyLabel = "Weekdays at 9am";
          break;
        case "3":
          cronExpr = "0 9 * * 1";
          frequencyLabel = "Weekly Monday 9am";
          break;
        default: {
          const parsed = parseTimeExpression(choice === "4" ? await (async () => {
            addSystemMessage("Enter time expression (e.g. `9am`, `*/6h`, `*/15m`, or cron):");
            return await waitForInput();
          })() : choice);
          cronExpr = parsed.cron;
          frequencyLabel = parsed.label;
          break;
        }
      }

      // Save schedule
      addSchedule({
        name,
        prompt: customPrompt || "",
        cron: cronExpr,
        frequencyLabel,
        createdAt: new Date().toISOString(),
      });

      // Install crontab
      const installed = await installCrontabEntry(name, cronExpr);
      if (installed) {
        addSystemMessage(`Schedule "${name}" created! (${frequencyLabel})\nCrontab entry installed.`);
      } else {
        addSystemMessage(
          `Schedule "${name}" saved (${frequencyLabel}), but failed to install crontab entry.\nYou can install it manually — see \`crontab -e\`.`
        );
      }
      return;
    }

    addSystemMessage("Unknown subcommand. Usage: `/schedule`, `/schedule add`, `/schedule list`, `/schedule remove <name>`");
  }, [addSystemMessage, waitForInput]);

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
        onSchedule={handleSchedule}
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
