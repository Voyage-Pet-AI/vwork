import { Box, Static, Text } from "ink";
import Spinner from "ink-spinner";
import type { DisplayMessage, DisplayToolCall } from "./types.js";
import { renderMarkdown } from "./markdown.js";

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
      {tc.summary ? <Text dimColor>{" "}{tc.summary}</Text> : null}
    </Box>
  );
}

function FileAttachmentLine({ files }: { files: string[] }) {
  const label = `  [+${files.length} file${files.length > 1 ? "s" : ""}: ${files.join(", ")}]`;
  return <Text dimColor>{label}</Text>;
}

function MessageBubble({ message }: { message: DisplayMessage }) {
  if (message.role === "user") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color="cyan" bold>{"❯ "}{message.content}</Text>
          {message.queued && <Text color="yellow" bold>{" "}QUEUED</Text>}
        </Box>
        {message.files && message.files.length > 0 && (
          <FileAttachmentLine files={message.files} />
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {message.toolCalls.map((tc) => (
        <ToolCallLine key={tc.id} tc={tc} />
      ))}
      {message.content.length > 0 && (
        <Box paddingLeft={2}>
          <Text>{renderMarkdown(message.content)}</Text>
        </Box>
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

export function QueuedMessages({ messages }: { messages: DisplayMessage[] }) {
  return (
    <>
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </>
  );
}
