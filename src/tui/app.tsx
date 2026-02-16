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
import { consumeUnreadInboxEvents, getLatestRunForSchedule } from "../report/runs.js";
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
import { hasOpenAIAuth, loginOpenAI, logoutOpenAI } from "../auth/openai.js";
import { createProvider } from "../index.js";
import type { Config } from "../config.js";
import { detectReportIntent } from "../chat/report-intent.js";
import type { ReportKind } from "../report/types.js";
import type { TodoList } from "../todo/types.js";
import { TodoPanel, TodoStatusLine } from "./todo-panel.js";
import {
  addTodo,
  carryOverFromYesterday,
  getCurrentTodos,
  markTodoActive,
  markTodoBlocked,
  markTodoDone,
} from "../todo/manager.js";
import { buildTodoContext, getYesterdayDate, loadTodoList } from "../todo/notebook.js";

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

const EMPTY_TODOS: TodoList = {
  active: [],
  blocked: [],
  completedToday: [],
};

/** Helper to append text to the blocks array, merging into the last text block if possible. */
function appendText(msg: DisplayMessage, delta: string) {
  const last = msg.blocks[msg.blocks.length - 1];
  if (last && last.type === "text") {
    last.text += delta;
  } else {
    msg.blocks.push({ type: "text", text: delta });
  }
}

function hasRenderableAssistantBlocks(msg: DisplayMessage): boolean {
  return msg.blocks.some(
    (block) =>
      block.type === "tool_call" ||
      (block.type === "text" && block.text.length > 0),
  );
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
  const [todos, setTodos] = useState<TodoList>(EMPTY_TODOS);
  const [todoPanelOpen, setTodoPanelOpen] = useState(
    config.todo.default_mode === "full",
  );

  const activeRef = useRef<DisplayMessage | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const interceptorRef = useRef<((text: string) => void) | null>(null);
  const activityRef = useRef<ActivityInfo | null>(null);
  const [activityInfo, setActivityInfo] = useState<ActivityInfo | null>(null);
  const availability = getProviderAvailability(
    config,
    session.getProviderName(),
  );

  const syncTodoContext = useCallback(
    (nextTodos: TodoList) => {
      session.setTodoContext(buildTodoContext(nextTodos));
      setTodos(nextTodos);
    },
    [session],
  );

  const refreshTodos = useCallback(() => {
    if (!config.todo.enabled) return;
    const parsed = getCurrentTodos(config);
    syncTodoContext(parsed.todos);
  }, [config, syncTodoContext]);

  const finalizeActive = useCallback(() => {
    if (activeRef.current) {
      // Mark any remaining running tool calls as done
      for (const block of activeRef.current.blocks) {
        if (block.type === "tool_call" && block.toolCall.status === "running") {
          block.toolCall.status = "done";
        }
      }
      if (hasRenderableAssistantBlocks(activeRef.current)) {
        setCompletedMessages((prev) => [...prev, activeRef.current!]);
      }
      activeRef.current = null;
      setActiveMessage(null);
    }
    abortRef.current = null;
    activityRef.current = null;
    setActivityInfo(null);
    setStatus("idle");
  }, []);

  const parseQuotedSelector = (input: string): { selector: string; rest: string } => {
    const trimmed = input.trim();
    if (!trimmed) return { selector: "", rest: "" };
    if (!trimmed.startsWith("\"")) return { selector: trimmed, rest: "" };
    const endQuote = trimmed.indexOf("\"", 1);
    if (endQuote === -1) return { selector: trimmed.slice(1), rest: "" };
    return {
      selector: trimmed.slice(1, endQuote).trim(),
      rest: trimmed.slice(endQuote + 1).trim(),
    };
  };

  const executeTodoSubcommand = useCallback(
    (subcommand: string, pushSystem: (content: string) => void): boolean => {
      if (!config.todo.enabled) {
        pushSystem("Todo feature is disabled in config (`[todo].enabled = false`).");
        return true;
      }

      const trimmed = subcommand.trim();
      if (!trimmed || trimmed === "show" || trimmed === "list") {
        setTodoPanelOpen(true);
        refreshTodos();
        pushSystem("Showing todos.");
        return true;
      }

      if (trimmed === "help") {
        pushSystem(
          "Todo commands:\n" +
            "  /todo                    Show todo panel\n" +
            "  /todo add <title #tags>\n" +
            "  /todo done <index|text>\n" +
            "  /todo block <index|text> [reason]\n" +
            "  /todo unblock <index|text>\n" +
            'Natural language: `add todo: ...`, `mark \"...\" as done`, `show todos`',
        );
        return true;
      }

      if (trimmed.startsWith("add ")) {
        const text = trimmed.slice(4).trim();
        try {
          const result = addTodo(config, text);
          syncTodoContext(result.todos);
          pushSystem(`✅ Added \"${result.added.title}\" to active todos.`);
        } catch (err) {
          pushSystem(`Todo add failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return true;
      }

      if (trimmed.startsWith("done ")) {
        const selector = trimmed.slice(5).trim();
        try {
          const result = markTodoDone(config, selector);
          syncTodoContext(result.todos);
          pushSystem(`✅ Marked \"${result.updated.title}\" as completed.`);
        } catch (err) {
          pushSystem(`Todo update failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return true;
      }

      if (trimmed.startsWith("block ")) {
        const raw = trimmed.slice(6).trim();
        const { selector, rest } = parseQuotedSelector(raw);
        const numeric = /^\d+\s+/.test(raw);
        const note = numeric ? raw.replace(/^\d+\s+/, "").trim() : rest;
        try {
          const result = markTodoBlocked(config, selector, note || undefined);
          syncTodoContext(result.todos);
          pushSystem(`✅ Marked \"${result.updated.title}\" as blocked.`);
        } catch (err) {
          pushSystem(`Todo update failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return true;
      }

      if (trimmed.startsWith("unblock ")) {
        const selector = trimmed.slice(8).trim().replace(/^"|"$/g, "");
        try {
          const result = markTodoActive(config, selector);
          syncTodoContext(result.todos);
          pushSystem(`✅ Marked \"${result.updated.title}\" as active.`);
        } catch (err) {
          pushSystem(`Todo update failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return true;
      }

      pushSystem("Unknown todo command. Use `/todo help`.");
      return true;
    },
    [config, refreshTodos, syncTodoContext],
  );

  const handleTodoCommand = useCallback(
    (subcommand: string) => {
      const pushSystem = (content: string) => {
        const msg: DisplayMessage = {
          id: nextId(),
          role: "assistant",
          blocks: [{ type: "text", text: content }],
        };
        setCompletedMessages((prev) => [...prev, msg]);
      };
      executeTodoSubcommand(subcommand, pushSystem);
    },
    [executeTodoSubcommand],
  );

  const interceptTodoText = useCallback(
    (text: string, pushSystem: (content: string) => void): boolean => {
      const trimmed = text.trim();
      if (/^show todos?$/i.test(trimmed) || /^\/todos?$/i.test(trimmed)) {
        setTodoPanelOpen(true);
        refreshTodos();
        pushSystem("Showing todos.");
        return true;
      }

      const addMatch = trimmed.match(/^add todo:\s*(.+)$/i);
      if (addMatch) {
        try {
          const result = addTodo(config, addMatch[1]);
          syncTodoContext(result.todos);
          pushSystem(`✅ Added \"${result.added.title}\" to active todos.`);
        } catch (err) {
          pushSystem(`Todo add failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return true;
      }

      const doneMatch = trimmed.match(/^mark\s+"?(.+?)"?\s+as\s+done$/i);
      if (doneMatch) {
        try {
          const result = markTodoDone(config, doneMatch[1].trim());
          syncTodoContext(result.todos);
          pushSystem(`✅ Marked \"${result.updated.title}\" as completed.`);
        } catch (err) {
          pushSystem(`Todo update failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return true;
      }

      const slashMatch = trimmed.match(/^\/(todo|todos)\b(.*)$/i);
      if (slashMatch) {
        return executeTodoSubcommand(slashMatch[2].trim(), pushSystem);
      }

      return false;
    },
    [config, executeTodoSubcommand, refreshTodos, syncTodoContext],
  );

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

      const pushSystem = (content: string) => {
        const msg: DisplayMessage = {
          id: nextId(),
          role: "assistant",
          blocks: [{ type: "text", text: content }],
        };
        setCompletedMessages((prev) => [...prev, msg]);
      };

      const requestInput = (): Promise<string> =>
        new Promise((resolve) => {
          interceptorRef.current = (value: string) => {
            const userInput: DisplayMessage = {
              id: nextId(),
              role: "user",
              blocks: [{ type: "text", text: value }],
            };
            setCompletedMessages((prev) => [...prev, userInput]);
            interceptorRef.current = null;
            resolve(value.trim());
          };
        });

      if (interceptTodoText(text, pushSystem)) {
        return;
      }

      const intent = detectReportIntent(text);
      if (intent.matched) {
        let kind: ReportKind;
        let lookbackDays: number;
        let label: string;

        if (intent.ambiguous) {
          pushSystem(
            "Report range is ambiguous. Choose one:\n  `1` — Daily (1 day)\n  `2` — Weekly (7 days)\n  `3` — Custom (last N days)",
          );
          const choice = await requestInput();
          if (choice === "1") {
            kind = "daily";
            lookbackDays = 1;
            label = "daily";
          } else if (choice === "2") {
            kind = "weekly";
            lookbackDays = 7;
            label = "weekly";
          } else if (choice === "3") {
            pushSystem("Enter number of days to include:");
            const raw = await requestInput();
            const n = parseInt(raw, 10);
            lookbackDays = isNaN(n) ? config.report.lookback_days : Math.max(1, n);
            kind = "custom";
            label = `last ${lookbackDays} days`;
          } else {
            pushSystem("Cancelled report generation.");
            return;
          }
        } else {
          kind = intent.kind!;
          lookbackDays = intent.lookbackDays!;
          label = intent.label ?? kind;
        }

        pushSystem(`Reporter executing report "${label}"...`);
        try {
          const report = await session.runReportToolDirect({
            kind,
            lookback_days: lookbackDays,
            prompt: text,
            save: true,
            source: "chat",
          });
          pushSystem(report.content);
          if (report.savedPath) {
            pushSystem(`Saved to: ${report.savedPath}`);
          }
          if (report.saveError) {
            pushSystem(`Warning: report generated but failed to save: ${report.saveError}`);
          }
          if (config.chat.report_postprocess_enabled) {
            const wrapped = await session.postProcessReport(report);
            if (wrapped) pushSystem(wrapped);
          }
        } catch (err) {
          pushSystem(
            `Report generation failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return;
      }

      processMessage(enhancedText);
    },
    [status, processMessage, config, session, interceptTodoText],
  );

  const abort = useCallback(() => {
    session.abortComputerSession();
    abortRef.current?.abort();
  }, [session]);

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
            "  /report                   Manage scheduled reports\n" +
            "  /todo                     Manage persistent todos\n" +
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

  useEffect(() => {
    if (!config.todo.enabled) {
      session.setTodoContext("");
      return;
    }

    const parsed = getCurrentTodos(config);
    syncTodoContext(parsed.todos);

    if (!config.todo.carryover_prompt) return;

    const openToday = parsed.todos.active.length + parsed.todos.blocked.length;
    if (openToday > 0) return;

    const yesterday = loadTodoList(config, getYesterdayDate()).todos;
    const openYesterday = yesterday.active.length + yesterday.blocked.length;
    if (openYesterday === 0) return;

    (async () => {
      addSystemMessage(
        `You have ${openYesterday} open todo(s) from yesterday. Carry over to today? Reply with \"yes\" or \"no\".`,
      );
      const reply = (await waitForInput()).toLowerCase();
      if (reply === "y" || reply === "yes") {
        const result = carryOverFromYesterday(config);
        syncTodoContext(result.todos);
        addSystemMessage(`✅ Carried over ${result.carried} todo(s) from yesterday.`);
        return;
      }
      addSystemMessage("Skipped todo carryover.");
    })();
  }, [addSystemMessage, config, session, syncTodoContext, waitForInput]);

  useEffect(() => {
    session.setComputerApprovalHandler(async (input) => {
      addSystemMessage(
        "Computer subagent requests approval:\n" +
          `- Task: ${input.task}\n` +
          `- Start URL: ${input.startUrl ?? "(none)"}\n` +
          `- Max steps: ${input.maxSteps}\n\n` +
          'Reply with "yes" to approve, anything else to deny.',
      );
      const reply = (await waitForInput()).toLowerCase();
      const approved = reply === "y" || reply === "yes";
      addSystemMessage(approved ? "Computer session approved." : "Computer session denied.");
      return approved;
    });

    session.setComputerEventHandler((event) => {
      if (!activityRef.current) return;
      if (event.type === "computer_action") {
        const step = event.step ?? 0;
        const max = event.maxSteps ?? 0;
        const url = event.url ? ` @ ${event.url}` : "";
        activityRef.current.lastToolName = `Computer ${step}/${max}${url}`;
        setActivityInfo({ ...activityRef.current });
      }
    });

    return () => {
      session.setComputerApprovalHandler(undefined);
      session.setComputerEventHandler(undefined);
    };
  }, [addSystemMessage, session, waitForInput]);

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
            addSystemMessage(
              "Previous OpenAI auth removed. Re-authenticating...",
            );
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
        addSystemMessage(
          `Anthropic auth mode: ${hasAnthropicAuth(config).mode}`,
        );
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
          addSystemMessage(
            "Previous Anthropic auth removed. Re-authenticating...",
          );
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
            "No schedules yet. Use `/report add` to create one.",
          );
          return;
        }
        const lines = schedules.map((s, i) => {
          const next = getNextRun(s.cron);
          const eta = next ? formatTimeUntil(next) : "unknown";
          const latest = getLatestRunForSchedule(s.name);
          const latestLine = latest
            ? latest.status === "completed"
              ? `last: completed${latest.savedPath ? ` · ${latest.savedPath}` : ""}`
              : `last: failed · ${latest.error ?? "unknown error"}`
            : "last: never";
          return `  \`${i + 1}\` — **${s.name}** — ${s.frequencyLabel} (next in ${eta}, ${latestLine})`;
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
          addSystemMessage("Usage: `/report remove <name>`");
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
            `A schedule named "${name}" already exists. Use \`/report remove ${name}\` first.`,
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
        "Unknown subcommand. Usage: `/report`, `/report add`, `/report list`, `/report remove <name>`",
      );
    },
    [addSystemMessage, waitForInput, processMessage],
  );

  const handleModel = useCallback(
    (model: string, provider: string) => {
      if (!availability.usableProviders.includes(provider as ProviderName)) {
        addSystemMessage(
          `Provider **${provider}** is not currently usable for chat.`,
        );
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
        providerName === "openai"
          ? "gpt-5.2-codex"
          : "claude-sonnet-4-5-20250929";
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

      if (
        !availability.usableProviders.includes(providerName as ProviderName)
      ) {
        addSystemMessage(
          `Provider **${providerName}** is not currently usable for chat.`,
        );
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
    [
      session,
      config,
      addSystemMessage,
      switchProvider,
      availability,
      runAnthropicLogin,
    ],
  );

  useEffect(() => {
    const events = consumeUnreadInboxEvents(config.chat.report_inbox_replay_limit);
    if (events.length === 0) return;
    for (const event of events) {
      addSystemMessage(`[inbox] ${event.message}`);
    }
  }, [addSystemMessage, config.chat.report_inbox_replay_limit]);

  return (
    <Box flexDirection="column">
      <Header services={services} />
      <CompletedMessages messages={completedMessages} />
      <ActiveMessage message={activeMessage} />
      <QueuedMessages messages={queuedMessages} />
      {config.todo.enabled &&
        (todoPanelOpen ? (
          <TodoPanel todos={todos} />
        ) : (
          <TodoStatusLine todos={todos} />
        ))}
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
        onTodo={handleTodoCommand}
        onModel={handleModel}
        onConnect={handleConnect}
        authedProviders={availability.visibleProviders}
        availableProviders={availability.visibleProviders}
        onToggleTodos={() => setTodoPanelOpen((prev) => !prev)}
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
