import type { DisplayMessage } from "../lib/types.js";
import { ToolCallLine } from "./ToolCallLine.js";

interface MessageBubbleProps {
  message: DisplayMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser
            ? "bg-blue-600/20 border border-blue-500/30 text-zinc-100"
            : "bg-zinc-800/60 border border-zinc-700/50 text-zinc-200"
        }`}
      >
        {message.blocks.map((block, i) => {
          if (block.type === "text") {
            return (
              <div key={i} className="whitespace-pre-wrap text-sm leading-relaxed">
                {block.text}
              </div>
            );
          }
          if (block.type === "tool_call") {
            return (
              <div key={i} className="my-1.5">
                <ToolCallLine toolCall={block.toolCall} />
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
