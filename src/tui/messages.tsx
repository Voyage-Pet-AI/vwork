import { Box, Static, Text } from "ink";
import Spinner from "ink-spinner";
import type { DisplayMessage, DisplayToolCall } from "./types.js";
import { getTextContent } from "./types.js";
import { renderMarkdown } from "./markdown.js";

function ToolCallLine({ tc }: { tc: DisplayToolCall }) {
  const icon = tc.status === "running" ? (
    <Text color="yellow"><Spinner type="dots" /></Text>
  ) : tc.status === "error" ? (
    <Text color="red">{"⏺"}</Text>
  ) : (
    <Text color="cyan">{"⏺"}</Text>
  );

  const argText = tc.summary ? `(${tc.summary})` : "";

  return (
    <Box flexDirection="column">
      <Box>
        <Text>{"  "}</Text>
        {icon}
        <Text bold>{" "}{tc.displayName}</Text>
        {argText ? <Text dimColor>{argText}</Text> : null}
      </Box>
      {tc.resultSummary && tc.status !== "running" && (
        <Box>
          <Text dimColor>{"    ⎿  "}</Text>
          <Text dimColor color={tc.status === "error" ? "red" : undefined}>
            {tc.resultSummary}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function FileAttachmentLine({ files }: { files: string[] }) {
  const label = `  [+${files.length} file${files.length > 1 ? "s" : ""}: ${files.join(", ")}]`;
  return <Text dimColor>{label}</Text>;
}

function MessageBubble({ message }: { message: DisplayMessage }) {
  if (message.role === "user") {
    const userText = getTextContent(message);
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color="cyan" bold>{"❯ "}{userText}</Text>
          {message.queued && <Text color="yellow" bold>{" "}QUEUED</Text>}
        </Box>
        {message.files && message.files.length > 0 && (
          <FileAttachmentLine files={message.files} />
        )}
      </Box>
    );
  }

  // Assistant: render blocks in chronological order
  return (
    <Box flexDirection="column" marginTop={1}>
      {message.blocks.map((block, i) => {
        if (block.type === "tool_call") {
          return <ToolCallLine key={block.toolCall.id} tc={block.toolCall} />;
        }
        // text block
        if (block.text.length > 0) {
          return (
            <Box key={`text-${i}`} paddingLeft={2}>
              <Text>{renderMarkdown(block.text)}</Text>
            </Box>
          );
        }
        return null;
      })}
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
