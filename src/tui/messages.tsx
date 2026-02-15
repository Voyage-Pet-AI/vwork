import { Box, Static, Text } from "ink";
import Spinner from "ink-spinner";
import type { DisplayMessage, DisplayToolCall } from "./types.js";

function ToolCallLine({ tc }: { tc: DisplayToolCall }) {
  return (
    <Box>
      <Text dimColor>{"  "}</Text>
      {tc.status === "running" ? (
        <Text color="yellow">
          <Spinner type="dots" />
        </Text>
      ) : tc.status === "error" ? (
        <Text color="red">x</Text>
      ) : (
        <Text color="green">{"■"}</Text>
      )}
      <Text dimColor>{" "}{tc.displayName}</Text>
    </Box>
  );
}

function MessageBubble({ message }: { message: DisplayMessage }) {
  if (message.role === "user") {
    return (
      <Box marginTop={1}>
        <Text color="cyan" bold>{"❯ "}{message.content}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {message.toolCalls.map((tc) => (
        <ToolCallLine key={tc.id} tc={tc} />
      ))}
      {message.content.length > 0 && (
        <Text>{"  "}{message.content}</Text>
      )}
    </Box>
  );
}

export function CompletedMessages({ messages }: { messages: DisplayMessage[] }) {
  return (
    <Static items={messages}>
      {(message) => (
        <MessageBubble key={message.id} message={message} />
      )}
    </Static>
  );
}

export function ActiveMessage({ message }: { message: DisplayMessage | null }) {
  if (!message) return null;
  return <MessageBubble message={message} />;
}
