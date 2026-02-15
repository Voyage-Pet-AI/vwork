import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { AppStatus } from "./types.js";

const SLASH_COMMANDS = [
  { name: "help", description: "Show this help" },
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
}

export function ChatInput({ status, onSubmit, onAbort, onExit, onClear, onHelp }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isBusy = status !== "idle";

  // Detect slash command pattern and filter matching commands
  const slashMatch = !isBusy ? value.match(/^\/(\S*)$/) : null;
  const query = slashMatch ? slashMatch[1].toLowerCase() : null;
  const filteredCommands = query !== null
    ? SLASH_COMMANDS.filter(cmd => {
        const names = [cmd.name, ...("aliases" in cmd ? cmd.aliases : [])];
        return names.some(n => n.startsWith(query));
      })
    : [];
  const showPopover = filteredCommands.length > 0;

  const executeCommand = (cmd: SlashCommand) => {
    setValue("");
    switch (cmd.name) {
      case "help": onHelp(); return;
      case "clear": onClear(); return;
      case "exit": onExit(); return;
    }
  };

  // Arrow keys, Tab for popover; Escape for abort
  useInput((_input, key) => {
    if (isBusy && key.escape) {
      onAbort();
      return;
    }

    if (!showPopover) return;

    if (key.upArrow) {
      setSelectedIndex(i => (i > 0 ? i - 1 : filteredCommands.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => (i < filteredCommands.length - 1 ? i + 1 : 0));
    } else if (key.tab) {
      const cmd = filteredCommands[Math.min(selectedIndex, filteredCommands.length - 1)];
      if (cmd) executeCommand(cmd);
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

    // If popover is showing, execute the highlighted command
    if (showPopover) {
      const cmd = filteredCommands[Math.min(selectedIndex, filteredCommands.length - 1)];
      if (cmd) {
        executeCommand(cmd);
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
    }

    onSubmit(trimmed);
  };

  const placeholder = isBusy
    ? "Type to queue, Enter to abort..."
    : "Ask anything...";

  const hint = isBusy
    ? "  Enter or Esc to abort · /exit to quit"
    : "  type / for commands · /exit to quit";

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" paddingLeft={1} paddingRight={1}>
        <Text color="cyan" bold>{"❯ "}</Text>
        <TextInput
          value={value}
          onChange={handleChange}
          onSubmit={handleSubmit}
          placeholder={placeholder}
        />
      </Box>
      {showPopover ? (
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
      ) : (
        <Text dimColor>{hint}</Text>
      )}
    </Box>
  );
}
