import { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { AppStatus } from "./types.js";

interface ChatInputProps {
  status: AppStatus;
  onSubmit: (text: string) => void;
  onExit: () => void;
  onClear: () => void;
  onHelp: () => void;
}

export function ChatInput({ status, onSubmit, onExit, onClear, onHelp }: ChatInputProps) {
  const [value, setValue] = useState("");
  const isDisabled = status !== "idle";

  const handleSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setValue("");

    // Slash commands
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

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" paddingLeft={1} paddingRight={1}>
        {isDisabled ? (
          <Text dimColor>  ...</Text>
        ) : (
          <>
            <Text color="cyan" bold>{"❯ "}</Text>
            <TextInput
              value={value}
              onChange={setValue}
              onSubmit={handleSubmit}
              placeholder="Ask anything..."
            />
          </>
        )}
      </Box>
      <Text dimColor>  /help for commands · /exit to quit</Text>
    </Box>
  );
}
