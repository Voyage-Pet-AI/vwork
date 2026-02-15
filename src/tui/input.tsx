import { useState, useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { MultiLineInput } from "./multiline-input.js";
import Spinner from "ink-spinner";
import type { AppStatus, ActivityInfo } from "./types.js";
import { useFileSearch } from "./use-file-search.js";

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function formatTokens(chars: number): string {
  const t = Math.round(chars / 4);
  return t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t);
}

function useElapsed(startTime: number | null): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startTime === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startTime]);
  if (startTime === null) return "0m 0s";
  return formatElapsed(now - startTime);
}

const SLASH_COMMANDS = [
  { name: "help", description: "Show this help" },
  { name: "connect", description: "Switch LLM provider" },
  { name: "model", description: "Switch LLM model" },
  { name: "schedule", description: "Manage scheduled reports" },
  { name: "copy", description: "Copy last response to clipboard" },
  { name: "clear", description: "Clear conversation history" },
  { name: "exit", aliases: ["quit", "q"], description: "Exit chat" },
] as const;

type SlashCommand = (typeof SLASH_COMMANDS)[number];

const PROVIDERS = [
  { name: "anthropic", label: "Anthropic" },
  { name: "openai", label: "OpenAI" },
];

const MODELS: Record<string, { id: string; label: string }[]> = {
  anthropic: [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
  openai: [
    { id: "gpt-5.2", label: "GPT-5.2" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "o4-mini", label: "o4-mini" },
  ],
};

interface ChatInputProps {
  status: AppStatus;
  activityInfo?: ActivityInfo | null;
  currentProvider: string;
  currentModel: string;
  onSubmit: (text: string) => void;
  onAbort: () => void;
  onExit: () => void;
  onClear: () => void;
  onHelp: () => void;
  onCopy: () => void;
  onSchedule: (subcommand: string) => void;
  onModel: (model: string, provider: string) => void;
  authedProviders: string[];
  onConnect: (provider: string) => void | Promise<void>;
}

export function ChatInput({ status, activityInfo, currentProvider, currentModel, onSubmit, onAbort, onExit, onClear, onHelp, onCopy, onSchedule, onModel, onConnect, authedProviders }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [ctrlCPending, setCtrlCPending] = useState(false);
  const [connectPopover, setConnectPopover] = useState(false);
  const [modelPopover, setModelPopover] = useState(false);
  const ctrlCTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isBusy = status !== "idle";
  const elapsed = useElapsed(activityInfo?.startTime ?? null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (ctrlCTimerRef.current) clearTimeout(ctrlCTimerRef.current);
    };
  }, []);

  // Detect slash command pattern and filter matching commands
  const slashMatch = !isBusy ? value.match(/^\/(\S*)$/) : null;
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : null;
  const filteredCommands = slashQuery !== null
    ? SLASH_COMMANDS.filter(cmd => {
        const names = [cmd.name, ...("aliases" in cmd ? cmd.aliases : [])];
        return names.some(n => n.startsWith(slashQuery));
      })
    : [];
  const showSlashPopover = filteredCommands.length > 0;

  // Detect @file pattern (only when slash popover isn't showing)
  const atMatch = !isBusy && !showSlashPopover ? value.match(/@(\S*)$/) : null;
  const atQuery = atMatch ? atMatch[1] : null;
  const { files: fileResults, loading: filesLoading } = useFileSearch(atQuery);
  const showFilePopover = atQuery !== null && (fileResults.length > 0 || filesLoading);

  const showPopover = showSlashPopover || showFilePopover || connectPopover || modelPopover;

  const executeCommand = (cmd: SlashCommand) => {
    setValue("");
    switch (cmd.name) {
      case "help": onHelp(); return;
      case "connect": setConnectPopover(true); setSelectedIndex(0); return;
      case "model": setModelPopover(true); setSelectedIndex(0); return;
      case "schedule": onSchedule(""); return;
      case "copy": onCopy(); return;
      case "clear": onClear(); return;
      case "exit": onExit(); return;
    }
  };

  const selectFile = (filePath: string) => {
    const newValue = value.replace(/@\S*$/, `@${filePath} `);
    setValue(newValue);
    setSelectedIndex(0);
  };

  const resetCtrlC = () => {
    setCtrlCPending(false);
    if (ctrlCTimerRef.current) {
      clearTimeout(ctrlCTimerRef.current);
      ctrlCTimerRef.current = null;
    }
  };

  // Arrow keys, Tab for popover; Escape for abort; Ctrl+C double-press to exit
  useInput((input, key) => {
    // Ctrl+C handling
    if (input === "c" && key.ctrl) {
      if (isBusy) {
        onAbort();
      } else if (ctrlCPending) {
        resetCtrlC();
        onExit();
      } else {
        setCtrlCPending(true);
        ctrlCTimerRef.current = setTimeout(() => {
          setCtrlCPending(false);
          ctrlCTimerRef.current = null;
        }, 2000);
      }
      return;
    }

    // Any other input resets the Ctrl+C pending state
    if (ctrlCPending) resetCtrlC();

    if (key.escape) {
      if (connectPopover) {
        setConnectPopover(false);
        return;
      }
      if (modelPopover) {
        setModelPopover(false);
        return;
      }
      if (isBusy) {
        onAbort();
        return;
      }
      return;
    }

    if (!showPopover) return;

    const modelItems = authedProviders.flatMap(p =>
      (MODELS[p] ?? []).map(m => ({ ...m, provider: p }))
    );
    const itemCount = connectPopover
      ? PROVIDERS.length
      : modelPopover
        ? modelItems.length
        : showSlashPopover
          ? filteredCommands.length
          : fileResults.length;
    if (itemCount === 0) return;

    if (key.upArrow) {
      setSelectedIndex(i => (i > 0 ? i - 1 : itemCount - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => (i < itemCount - 1 ? i + 1 : 0));
    } else if (key.tab || (key.rightArrow && (showSlashPopover || connectPopover || modelPopover))) {
      if (connectPopover) {
        const provider = PROVIDERS[Math.min(selectedIndex, PROVIDERS.length - 1)];
        if (provider) {
          setConnectPopover(false);
          onConnect(provider.name);
        }
      } else if (modelPopover) {
        const model = modelItems[Math.min(selectedIndex, modelItems.length - 1)];
        if (model) {
          setModelPopover(false);
          onModel(model.id, model.provider);
        }
      } else if (showSlashPopover) {
        const cmd = filteredCommands[Math.min(selectedIndex, filteredCommands.length - 1)];
        if (cmd) {
          if (key.rightArrow) {
            handleChange(`/${cmd.name}`);
          } else {
            executeCommand(cmd);
          }
        }
      } else if (showFilePopover) {
        const file = fileResults[Math.min(selectedIndex, fileResults.length - 1)];
        if (file) selectFile(file);
      }
    } else if (key.rightArrow && showFilePopover) {
      const file = fileResults[Math.min(selectedIndex, fileResults.length - 1)];
      if (file) selectFile(file);
    }
  });

  const handleChange = (newValue: string) => {
    setValue(newValue);
    setSelectedIndex(0);
    if (connectPopover) setConnectPopover(false);
    if (modelPopover) setModelPopover(false);
  };

  const handleSubmit = (text: string) => {
    const trimmed = text.trim();

    // If connect popover is showing, select the highlighted provider
    if (connectPopover) {
      const provider = PROVIDERS[Math.min(selectedIndex, PROVIDERS.length - 1)];
      if (provider) {
        setConnectPopover(false);
        setValue("");
        onConnect(provider.name);
      }
      return;
    }

    // If model popover is showing, select the highlighted model
    if (modelPopover) {
      const modelItems = authedProviders.flatMap(p =>
        (MODELS[p] ?? []).map(m => ({ ...m, provider: p }))
      );
      const model = modelItems[Math.min(selectedIndex, modelItems.length - 1)];
      if (model) {
        setModelPopover(false);
        setValue("");
        onModel(model.id, model.provider);
      }
      return;
    }

    // Empty submit while busy → abort
    if (!trimmed && isBusy) {
      onAbort();
      return;
    }

    if (!trimmed) return;

    // If slash popover is showing, execute the highlighted command
    if (showSlashPopover) {
      const cmd = filteredCommands[Math.min(selectedIndex, filteredCommands.length - 1)];
      if (cmd) {
        executeCommand(cmd);
        return;
      }
    }

    // If file popover is showing, select the highlighted file (don't submit)
    if (showFilePopover && fileResults.length > 0) {
      const file = fileResults[Math.min(selectedIndex, fileResults.length - 1)];
      if (file) {
        selectFile(file);
        return;
      }
    }

    setValue("");

    // Slash commands (full match fallback)
    const cmd = trimmed.split(/\s+/)[0].toLowerCase();
    switch (cmd) {
      case "/exit":
      case "/quit":
      case "/q":
        onExit();
        return;
      case "/clear":
        onClear();
        return;
      case "/help":
        onHelp();
        return;
      case "/copy":
        onCopy();
        return;
      case "/connect":
        setConnectPopover(true);
        setSelectedIndex(0);
        return;
      case "/model":
        setModelPopover(true);
        setSelectedIndex(0);
        return;
      case "/schedule": {
        const rest = trimmed.slice("/schedule".length).trim();
        onSchedule(rest);
        return;
      }
    }

    onSubmit(trimmed);
  };

  const placeholder = isBusy
    ? "Type to queue, Enter to abort..."
    : "Ask anything...";

  const hint = isBusy
    ? "  Enter or Esc to abort · /exit to quit"
    : "  type / for commands · @ to attach files · Ctrl+J for newline";

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" paddingLeft={1} paddingRight={1}>
        <Text color="cyan" bold>{"❯ "}</Text>
        <MultiLineInput
          value={value}
          onChange={handleChange}
          onSubmit={handleSubmit}
          placeholder={placeholder}
          disableVerticalNav={showPopover}
        />
      </Box>
      {connectPopover ? (
        <Box flexDirection="column" paddingLeft={2}>
          {PROVIDERS.map((p, i) => (
            <Text key={p.name}>
              {i === selectedIndex ? (
                <Text color="cyan" bold>{"❯ "}</Text>
              ) : (
                <Text>{"  "}</Text>
              )}
              <Text color={i === selectedIndex ? "cyan" : undefined} bold={i === selectedIndex}>
                {p.label}
              </Text>
              {p.name === currentProvider && <Text dimColor>{"  (current)"}</Text>}
            </Text>
          ))}
        </Box>
      ) : modelPopover ? (
        <Box flexDirection="column" paddingLeft={2}>
          {(() => {
            const items = authedProviders.flatMap(p =>
              (MODELS[p] ?? []).map(m => ({ ...m, provider: p }))
            );
            const multiProvider = authedProviders.length > 1;
            let lastProvider = "";
            let idx = 0;
            return items.map(m => {
              const rows: React.ReactNode[] = [];
              if (multiProvider && m.provider !== lastProvider) {
                const providerLabel = PROVIDERS.find(p => p.name === m.provider)?.label ?? m.provider;
                rows.push(
                  <Text key={`hdr-${m.provider}`} dimColor bold>
                    {lastProvider === "" ? "" : "\n"}{providerLabel}
                  </Text>
                );
                lastProvider = m.provider;
              }
              const i = idx++;
              rows.push(
                <Text key={m.id}>
                  {i === selectedIndex ? (
                    <Text color="cyan" bold>{"❯ "}</Text>
                  ) : (
                    <Text>{"  "}</Text>
                  )}
                  <Text color={i === selectedIndex ? "cyan" : undefined} bold={i === selectedIndex}>
                    {m.label}
                  </Text>
                  {multiProvider && <Text dimColor>{"  "}{PROVIDERS.find(p => p.name === m.provider)?.label ?? m.provider}</Text>}
                  {m.id === currentModel && m.provider === currentProvider && <Text dimColor>{"  (current)"}</Text>}
                </Text>
              );
              return rows;
            });
          })()}
        </Box>
      ) : showSlashPopover ? (
        <Box flexDirection="column" paddingLeft={2}>
          {filteredCommands.map((cmd, i) => (
            <Text key={cmd.name}>
              {i === selectedIndex ? (
                <Text color="cyan" bold>{"❯ "}</Text>
              ) : (
                <Text>{"  "}</Text>
              )}
              <Text color={i === selectedIndex ? "cyan" : undefined} bold={i === selectedIndex}>
                /{cmd.name}
              </Text>
              <Text dimColor>{"  "}{cmd.description}</Text>
            </Text>
          ))}
        </Box>
      ) : showFilePopover ? (
        <Box flexDirection="column" paddingLeft={2}>
          {filesLoading && fileResults.length === 0 ? (
            <Text dimColor>
              <Spinner type="dots" />{" "}searching files...
            </Text>
          ) : (
            fileResults.map((file, i) => (
              <Text key={file}>
                {i === selectedIndex ? (
                  <Text color="cyan" bold>{"❯ "}</Text>
                ) : (
                  <Text>{"  "}</Text>
                )}
                <Text color={i === selectedIndex ? "cyan" : undefined} bold={i === selectedIndex}>
                  {file}
                </Text>
              </Text>
            ))
          )}
        </Box>
      ) : ctrlCPending ? (
        <Text color="yellow">{"  Press Ctrl+C again to exit"}</Text>
      ) : isBusy && activityInfo ? (
        <Text dimColor>
          {"  "}<Text color="cyan"><Spinner type="dots" /></Text>
          {" "}
          {activityInfo.lastToolName ? `Running ${activityInfo.lastToolName}` : "Streaming"}
          {"… ("}
          {elapsed}
          {" · ↓ "}
          {formatTokens(activityInfo.outputChars)}
          {" tokens)    Enter to abort"}
        </Text>
      ) : (
        <Text dimColor>{hint}</Text>
      )}
    </Box>
  );
}
