import { useState, useRef, useCallback, useEffect } from "react";
import { render, Box } from "ink";
import type { ChatSession } from "../chat/session.js";
import type { StreamCallbacks, ToolCall } from "../llm/provider.js";
import type {
  DisplayMessage,
  DisplayToolCall,
  AppStatus,
  ConnectedService,
  ActivityInfo,
} from "./types.js";
import { getTextContent, getToolCalls } from "./types.js";
import { Header } from "./header.js";
import {
  CompletedMessages,
  ActiveMessage,
  QueuedMessages,
} from "./messages.js";
import { ChatInput } from "./input.js";
import {
  parseFileMentions,
  resolveFileMentions,
  buildMessageWithFiles,
} from "./file-mentions.js";
import {
  toolCallSummary,
  friendlyToolName,
  toolResultSummary,
} from "./tool-summary.js";
import {
  listSchedules,
  addSchedule,
  removeSchedule,
} from "../schedule/store.js";
import {
  installCrontabEntry,
  removeCrontabEntry,
  parseTimeExpression,
  getNextRun,
  formatTimeUntil,
} from "../schedule/crontab.js";
import {
  hasAnthropicAuth,
  logoutAnthropic,
  startAnthropicLogin,
} from "../auth/anthropic.js";
import {
  hasOpenAIAuth,
  loginOpenAI,
  logoutOpenAI,
} from "../auth/openai.js";
import { createProvider } from "../index.js";
import type { Config } from "../config.js";

interface AppProps {
  session: ChatSession;
  config: Config;
  services: ConnectedService[];
  onExit: () => void;
}

let msgCounter = 0;
function nextId(): string {
  return String(++msgCounter);
}

/** Helper to append text to the blocks array, merging into the last text block if possible. */
function appendText(msg: DisplayMessage, delta: string) {
  const last = msg.blocks[msg.blocks.length - 1];
  if (last && last.type === "text") {
    last.text += delta;
  } else {
    msg.blocks.push({ type: "text", text: delta });
  }
}

type ProviderName = "anthropic" | "openai";

interface ProviderAvailability {
  providerModes: Record<ProviderName, string>;
  usableProviders: ProviderName[];
  visibleProviders: ProviderName[];
}

function getProviderAvailability(
  config: Config,
  currentProvider: string,
): ProviderAvailability {
  const anthropicMode = hasAnthropicAuth(config).mode;
  const openaiMode = hasOpenAIAuth(config).mode;

  const usableProviders: ProviderName[] = [];
  if (anthropicMode !== "none") usableProviders.push("anthropic");
  if (openaiMode !== "none") usableProviders.push("openai");

  const visibleProviders = [...usableProviders];
  const current = currentProvider as ProviderName;
  if (!visibleProviders.includes(current)) {
    visibleProviders.push(current);
  }
  if (visibleProviders.length === 0) {
    visibleProviders.push("anthropic");
  }

  return {
    providerModes: {
      anthropic: anthropicMode,
      openai: openaiMode,
    },
    usableProviders,
    visibleProviders,
  };
}

function App({ session, config, services, onExit }: AppProps) {
  const [completedMessages, setCompletedMessages] = useState<DisplayMessage[]>(
    [],
  );
  const [activeMessage, setActiveMessage] = useState<DisplayMessage | null>(
    null,
  );
  const [status, setStatus] = useState<AppStatus>("idle");
  const [queuedMessages, setQueuedMessages] = useState<DisplayMessage[]>([]);

  const activeRef = useRef<DisplayMessage | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const interceptorRef = useRef<((text: string) => void) | null>(null);
  const activityRef = useRef<ActivityInfo | null>(null);
  const [activityInfo, setActivityInfo] = useState<ActivityInfo | null>(null);
  const availability = getProviderAvailability(config, session.getProviderName());

  const finalizeActive = useCallback(() => {
    if (activeRef.current) {
      // Mark any remaining running tool calls as done
      for (const block of activeRef.current.blocks) {
        if (block.type === "tool_call" && block.toolCall.status === "running") {
          block.toolCall.status = "done";
        }
      }
      setCompletedMessages((prev) => [...prev, activeRef.current!]);
      activeRef.current = null;
      setActiveMessage(null);
    }
    abortRef.current = null;
    activityRef.current = null;
    setActivityInfo(null);
    setStatus("idle");
  }, []);

  const processMessage = useCallback(
    async (text: string) => {
      const controller = new AbortController();
      abortRef.current = controller;

      // Create active assistant message
      const assistantMsg: DisplayMessage = {
        id: nextId(),
        role: "assistant",
        blocks: [],
      };
      activeRef.current = assistantMsg;
      setActiveMessage({ ...assistantMsg });
      activityRef.current = { startTime: Date.now(), outputChars: 0 };
      setActivityInfo({ ...activityRef.current });
      setStatus("streaming");

      const callbacks: StreamCallbacks = {
        onText: (delta: string) => {
          if (activeRef.current) {
            appendText(activeRef.current, delta);
            setActiveMessage({ ...activeRef.current });
          }
          if (activityRef.current) {
            activityRef.current.outputChars += delta.length;
            setActivityInfo({ ...activityRef.current });
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
            activeRef.current.blocks.push({
              type: "tool_call",
              toolCall: displayTc,
            });
            setActiveMessage({ ...activeRef.current });
          }
          if (activityRef.current) {
            activityRef.current.lastToolName = friendlyToolName(tc.name);
            setActivityInfo({ ...activityRef.current });
          }
        },
        onToolEnd: (tc: ToolCall, result: string, isError?: boolean) => {
          if (activeRef.current) {
            const found = getToolCalls(activeRef.current).find(
              (t) => t.id === tc.id,
            );
            if (found) {
              found.status = isError ? "error" : "done";
              found.resultSummary = toolResultSummary(tc.name, result, isError);
            }
            setActiveMessage({ ...activeRef.current });
            setStatus("streaming");
          }
          if (activityRef.current) {
            activityRef.current.lastToolName = undefined;
            setActivityInfo({ ...activityRef.current });
          }
        },
        onComplete: () => {
          // No-op — finalization happens when session.send() resolves
        },
        onError: (err: Error) => {
          if (activeRef.current) {
            for (const block of activeRef.current.blocks) {
              if (
                block.type === "tool_call" &&
                block.toolCall.status === "running"
              ) {
                block.toolCall.status = "error";
                block.toolCall.resultSummary = err.message;
              }
            }
            appendText(activeRef.current, `\nError: ${err.message}`);
            setActiveMessage({ ...activeRef.current });
          }
        },
      };

      try {
        await session.send(text, callbacks, controller.signal);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          if (activeRef.current) {
            appendText(activeRef.current, "\n[aborted]");
            setActiveMessage({ ...activeRef.current });
          }
        } else if (activeRef.current) {
          appendText(
            activeRef.current,
            `\nError: ${err instanceof Error ? err.message : String(err)}`,
          );
          setActiveMessage({ ...activeRef.current });
        }
      }

      finalizeActive();
    },
    [session, finalizeActive],
  );

  const handleSend = useCallback(
    async (text: string) => {
      // If a wizard interceptor is active, route input there instead
      if (interceptorRef.current) {
        interceptorRef.current(text);
        return;
      }

      const isBusy = status !== "idle";
      const mentionedPaths = parseFileMentions(text);
      const mentions =
        mentionedPaths.length > 0
          ? await resolveFileMentions(mentionedPaths)
          : [];
      const enhancedText =
        mentions.length > 0 ? buildMessageWithFiles(text, mentions) : text;
      const filePaths = mentions.map((m) => m.path);

      if (isBusy) {
        // Queue the message
        const userMsg: DisplayMessage = {
          id: nextId(),
          role: "user",
          blocks: [{ type: "text", text }],
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
        blocks: [{ type: "text", text }],
        files: filePaths.length > 0 ? filePaths : undefined,
      };
      setCompletedMessages((prev) => [...prev, userMsg]);
      processMessage(enhancedText);
    },
    [status, processMessage],
  );

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
      blocks: next.blocks,
      files: next.files,
    };
    setCompletedMessages((prev) => [...prev, userMsg]);
    processMessage(next._sendContent ?? getTextContent(next));
  }, [status, queuedMessages, processMessage]);

  const handleClear = useCallback(() => {
    // Clear terminal screen + scrollback so <Static> output is removed
    process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
    session.clear();
    setCompletedMessages([]);
    setActiveMessage(null);
    setQueuedMessages([]);
    activeRef.current = null;
    abortRef.current = null;
    activityRef.current = null;
    setActivityInfo(null);
    setStatus("idle");
  }, [session]);

  const handleCopy = useCallback(() => {
    const last = [...completedMessages]
      .reverse()
      .find((m) => m.role === "assistant" && getTextContent(m).trim());
    if (!last) {
      const msg: DisplayMessage = {
        id: nextId(),
        role: "assistant",
        blocks: [{ type: "text", text: "Nothing to copy." }],
      };
      setCompletedMessages((prev) => [...prev, msg]);
      return;
    }
    const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" });
    proc.stdin.write(getTextContent(last));
    proc.stdin.end();
    const msg: DisplayMessage = {
      id: nextId(),
      role: "assistant",
      blocks: [{ type: "text", text: "Copied to clipboard." }],
    };
    setCompletedMessages((prev) => [...prev, msg]);
  }, [completedMessages]);

  const handleHelp = useCallback(() => {
    const helpMsg: DisplayMessage = {
      id: nextId(),
      role: "assistant",
      blocks: [
        {
          type: "text",
          text:
            "Commands:\n" +
            "  /help                     Show this help\n" +
            "  /auth                     Show auth help\n" +
            "  /auth status              Show OpenAI/Anthropic auth status\n" +
            "  /auth <provider> login    Login provider\n" +
            "  /auth <provider> relogin  Re-authenticate provider\n" +
            "  /auth <provider> logout   Remove stored provider auth\n" +
            "  /connect                  Switch LLM provider\n" +
            "  /model                    Switch LLM model\n" +
            "  /schedule                 Manage scheduled reports\n" +
            "  /copy                     Copy last response to clipboard\n" +
            "  /clear                    Clear conversation history\n" +
            "  /exit                     Exit chat",
        },
      ],
    };
    setCompletedMessages((prev) => [...prev, helpMsg]);
  }, []);

  const addSystemMessage = useCallback((content: string) => {
    const msg: DisplayMessage = {
      id: nextId(),
      role: "assistant",
      blocks: [{ type: "text", text: content }],
    };
    setCompletedMessages((prev) => [...prev, msg]);
  }, []);

  const waitForInput = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      interceptorRef.current = (text: string) => {
        const userMsg: DisplayMessage = {
          id: nextId(),
          role: "user",
          blocks: [{ type: "text", text }],
        };
        setCompletedMessages((prev) => [...prev, userMsg]);
        interceptorRef.current = null;
        resolve(text.trim());
      };
    });
  }, []);

  const runAnthropicLogin = useCallback(async (): Promise<boolean> => {
    const handle = await startAnthropicLogin();
    const opener =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    Bun.spawn([opener, handle.authUrl], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    addSystemMessage(
      `Opening browser for Anthropic authorization...\n\nIf the browser didn't open, visit:\n  ${handle.authUrl}\n\nPaste the authorization code below:`,
    );
    const code = await waitForInput();
    if (!code) {
      addSystemMessage("Login cancelled.");
      return false;
    }
    await handle.complete(code);
    addSystemMessage("Anthropic login successful!");
    return true;
  }, [addSystemMessage, waitForInput]);

  const handleAuth = useCallback(
    async (subcommand: string) => {
      const tokens = subcommand.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0 || tokens[0] === "help") {
        addSystemMessage(
          "Auth commands:\n" +
            "  /auth status\n" +
            "  /auth openai status|login|relogin|logout\n" +
            "  /auth anthropic status|login|relogin|logout",
        );
        return;
      }

      if (tokens[0] === "status") {
        addSystemMessage(
          `Auth status:\n` +
            `  OpenAI: ${hasOpenAIAuth(config).mode}\n` +
            `  Anthropic: ${hasAnthropicAuth(config).mode}`,
        );
        return;
      }

      const provider = tokens[0];
      const action = tokens[1] ?? "status";

      if (provider !== "openai" && provider !== "anthropic") {
        addSystemMessage(
          `Unknown provider "${provider}". Use "openai" or "anthropic".`,
        );
        return;
      }

      if (provider === "openai") {
        if (action === "status") {
          addSystemMessage(`OpenAI auth mode: ${hasOpenAIAuth(config).mode}`);
          return;
        }
        if (action === "logout") {
          logoutOpenAI();
          addSystemMessage("OpenAI auth tokens removed.");
          return;
        }
        if (action === "login") {
          try {
            addSystemMessage("Opening browser for OpenAI authorization...");
            await loginOpenAI();
            addSystemMessage("OpenAI login successful!");
          } catch (err) {
            addSystemMessage(
              `OpenAI login failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          return;
        }
        if (action === "relogin" || action === "reauth") {
          try {
            logoutOpenAI();
            addSystemMessage("Previous OpenAI auth removed. Re-authenticating...");
            await loginOpenAI();
            addSystemMessage("OpenAI re-login successful!");
          } catch (err) {
            addSystemMessage(
              `OpenAI re-login failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          return;
        }
        addSystemMessage(`Unknown action "${action}" for openai.`);
        return;
      }

      if (action === "status") {
        addSystemMessage(`Anthropic auth mode: ${hasAnthropicAuth(config).mode}`);
        return;
      }
      if (action === "logout") {
        logoutAnthropic();
        addSystemMessage("Anthropic auth tokens removed.");
        return;
      }
      if (action === "login") {
        try {
          await runAnthropicLogin();
        } catch (err) {
          addSystemMessage(
            `Anthropic login failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return;
      }
      if (action === "relogin" || action === "reauth") {
        try {
          logoutAnthropic();
          addSystemMessage("Previous Anthropic auth removed. Re-authenticating...");
          await runAnthropicLogin();
        } catch (err) {
          addSystemMessage(
            `Anthropic re-login failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return;
      }

      addSystemMessage(`Unknown action "${action}" for anthropic.`);
    },
    [addSystemMessage, config, runAnthropicLogin],
  );

  const handleSchedule = useCallback(
    async (subcommand: string) => {
      const sub = subcommand.trim().split(/\s+/);
      const action = sub[0] || "";

      if (action === "" || action === "list") {
        const schedules = listSchedules();
        if (schedules.length === 0) {
          addSystemMessage(
            "No schedules yet. Use `/schedule add` to create one.",
          );
          return;
        }
        const lines = schedules.map((s, i) => {
          const next = getNextRun(s.cron);
          const eta = next ? formatTimeUntil(next) : "unknown";
          return `  \`${i + 1}\` — **${s.name}** — ${s.frequencyLabel} (next in ${eta})`;
        });
        addSystemMessage(
          "Scheduled reports:\n" +
            lines.join("\n") +
            "\n\nPick a number to run now, or press Enter to cancel.",
        );
        const pick = await waitForInput();
        if (!pick) return;
        const idx = parseInt(pick, 10);
        if (isNaN(idx) || idx < 1 || idx > schedules.length) {
          addSystemMessage("Invalid selection.");
          return;
        }
        const selected = schedules[idx - 1];
        await processMessage(selected.prompt || "Generate my work report.");
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
        addSystemMessage(
          "What should this schedule be called? (e.g. `morning-standup`)",
        );
        let name = "";
        while (true) {
          name = await waitForInput();
          if (/^[a-z0-9][a-z0-9-]*$/.test(name)) break;
          addSystemMessage(
            "Invalid name. Use lowercase letters, numbers, and hyphens (must start with a letter or number).",
          );
        }

        // Check for duplicates
        const existing = listSchedules();
        if (existing.some((s) => s.name === name)) {
          addSystemMessage(
            `A schedule named "${name}" already exists. Use \`/schedule remove ${name}\` first.`,
          );
          return;
        }

        // Step 2: Prompt
        addSystemMessage(
          "Custom prompt for this report (press Enter for default):",
        );
        const customPrompt = await waitForInput();

        // Step 3: Frequency
        addSystemMessage(
          "How often?\n  `1` — Daily at 9am\n  `2` — Weekdays at 9am\n  `3` — Weekly Monday 9am\n  `4` — Custom (e.g. `*/15m`, `3pm`, or cron expression)",
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
            const parsed = parseTimeExpression(
              choice === "4"
                ? await (async () => {
                    addSystemMessage(
                      "Enter time expression (e.g. `9am`, `*/6h`, `*/15m`, or cron):",
                    );
                    return await waitForInput();
                  })()
                : choice,
            );
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
          addSystemMessage(
            `Schedule "${name}" created! (${frequencyLabel})\nCrontab entry installed.`,
          );
        } else {
          addSystemMessage(
            `Schedule "${name}" saved (${frequencyLabel}), but failed to install crontab entry.\nYou can install it manually — see \`crontab -e\`.`,
          );
        }
        return;
      }

      addSystemMessage(
        "Unknown subcommand. Usage: `/schedule`, `/schedule add`, `/schedule list`, `/schedule remove <name>`",
      );
    },
    [addSystemMessage, waitForInput, processMessage],
  );

  const handleModel = useCallback(
    (model: string, provider: string) => {
      if (!availability.usableProviders.includes(provider as ProviderName)) {
        addSystemMessage(`Provider **${provider}** is not currently usable for chat.`);
        return;
      }

      if (provider !== session.getProviderName()) {
        // Switch provider first, then override the default model
        const modifiedConfig: Config = {
          ...config,
          llm: {
            ...config.llm,
            provider: provider as "anthropic" | "openai",
            model,
          },
        };
        const newProvider = createProvider(modifiedConfig);
        session.setProvider(newProvider);

        process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
        setCompletedMessages([]);
        setActiveMessage(null);
        setQueuedMessages([]);
        activeRef.current = null;
        abortRef.current = null;
        activityRef.current = null;
        setActivityInfo(null);
        setStatus("idle");

        addSystemMessage(
          `Switched to **${provider}** with model **${model}**. Conversation cleared.`,
        );
      } else {
        session.setModel(model);
        addSystemMessage(`Model switched to **${model}**.`);
      }
    },
    [session, config, addSystemMessage, availability],
  );

  const switchProvider = useCallback(
    (providerName: string) => {
      const defaultModel =
        providerName === "openai" ? "gpt-5.2-codex" : "claude-sonnet-4-5-20250929";
      const modifiedConfig: Config = {
        ...config,
        llm: {
          ...config.llm,
          provider: providerName as "anthropic" | "openai",
          model: defaultModel,
        },
      };
      const newProvider = createProvider(modifiedConfig);
      session.setProvider(newProvider);

      // Clear TUI display state (same as handleClear)
      process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
      setCompletedMessages([]);
      setActiveMessage(null);
      setQueuedMessages([]);
      activeRef.current = null;
      abortRef.current = null;
      activityRef.current = null;
      setActivityInfo(null);
      setStatus("idle");

      addSystemMessage(
        `Switched to **${providerName}** (model: ${defaultModel}). Conversation cleared.\nUse \`/model\` to change model.`,
      );
    },
    [session, config, addSystemMessage],
  );

  const handleConnect = useCallback(
    async (providerName: string) => {
      const currentProvider = session.getProviderName();

      if (providerName === currentProvider) {
        addSystemMessage(`Already using **${currentProvider}**.`);
        return;
      }

      if (!availability.usableProviders.includes(providerName as ProviderName)) {
        addSystemMessage(`Provider **${providerName}** is not currently usable for chat.`);
        return;
      }

      // Check auth — if missing, trigger inline login
      if (providerName === "anthropic") {
        const auth = hasAnthropicAuth(config);
        if (auth.mode === "none") {
          try {
            const ok = await runAnthropicLogin();
            if (!ok) return;
          } catch (err) {
            addSystemMessage(
              `Anthropic login failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return;
          }
        }
      } else if (providerName === "openai") {
        const auth = hasOpenAIAuth(config);
        if (auth.mode === "none") {
          try {
            addSystemMessage("Opening browser for OpenAI authorization...");
            await loginOpenAI();
            addSystemMessage("OpenAI login successful!");
          } catch (err) {
            addSystemMessage(
              `OpenAI login failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return;
          }
        }
      }

      switchProvider(providerName);
    },
    [session, config, addSystemMessage, switchProvider, availability, runAnthropicLogin],
  );

  return (
    <Box flexDirection="column">
      {completedMessages.length === 0 && !activeMessage && (
        <Header services={services} />
      )}
      <CompletedMessages messages={completedMessages} />
      <ActiveMessage message={activeMessage} />
      <QueuedMessages messages={queuedMessages} />
      <ChatInput
        status={status}
        activityInfo={activityInfo}
        currentProvider={session.getProviderName()}
        currentModel={session.getModel()}
        onSubmit={handleSend}
        onAbort={abort}
        onExit={onExit}
        onClear={handleClear}
        onHelp={handleHelp}
        onCopy={handleCopy}
        onAuth={handleAuth}
        onSchedule={handleSchedule}
        onModel={handleModel}
        onConnect={handleConnect}
        authedProviders={availability.visibleProviders}
        availableProviders={availability.visibleProviders}
      />
    </Box>
  );
}

interface StartTUIOptions {
  session: ChatSession;
  config: Config;
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
        config={options.config}
        services={options.services}
        onExit={handleExit}
      />,
      { exitOnCtrlC: false },
    );
  });
}
