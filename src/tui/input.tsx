import { useState, useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { MultiLineInput } from "./multiline-input.js";
import Spinner from "ink-spinner";
import type { AppStatus } from "./types.js";
import { useFileSearch } from "./use-file-search.js";

const SLASH_COMMANDS = [
  { name: "help", description: "Show this help" },
  { name: "schedule", description: "Manage scheduled reports" },
  { name: "copy", description: "Copy last response to clipboard" },
  { name: "clear", description: "Clear conversation history" },
  { name: "exit", aliases: ["quit", "q"], description: "Exit chat" },
] as const;

type SlashCommand = (typeof SLASH_COMMANDS)[number];

interface ChatInputProps {
  status: AppStatus;
  onSubmit: (text: string) => void;
  onAbort: () => void;
  onExit: () => void;
  onClear: () => void;
  onHelp: () => void;
  onCopy: () => void;
  onSchedule: (subcommand: string) => void;
}

export function ChatInput({ status, onSubmit, onAbort, onExit, onClear, onHelp, onCopy, onSchedule }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [ctrlCPending, setCtrlCPending] = useState(false);
  const ctrlCTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isBusy = status !== "idle";

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

  const showPopover = showSlashPopover || showFilePopover;

  const executeCommand = (cmd: SlashCommand) => {
    setValue("");
    switch (cmd.name) {
      case "help": onHelp(); return;
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

    if (isBusy && key.escape) {
      onAbort();
      return;
    }

    if (!showPopover) return;

    const itemCount = showSlashPopover ? filteredCommands.length : fileResults.length;
    if (itemCount === 0) return;

    if (key.upArrow) {
      setSelectedIndex(i => (i > 0 ? i - 1 : itemCount - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => (i < itemCount - 1 ? i + 1 : 0));
    } else if (key.tab) {
      if (showSlashPopover) {
        const cmd = filteredCommands[Math.min(selectedIndex, filteredCommands.length - 1)];
        if (cmd) executeCommand(cmd);
      } else if (showFilePopover) {
        const file = fileResults[Math.min(selectedIndex, fileResults.length - 1)];
        if (file) selectFile(file);
      }
    }
  });

  const handleChange = (newValue: string) => {
    setValue(newValue);
    setSelectedIndex(0);
  };

  const handleSubmit = (text: string) => {
    const trimmed = text.trim();

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
      {showSlashPopover ? (
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
      ) : (
        <Text dimColor>{hint}</Text>
      )}
    </Box>
  );
}
