import { useEffect, useRef } from "react";
import { useChat } from "../hooks/useChat.js";
import { MessageBubble } from "./MessageBubble.js";
import { Input } from "./Input.js";

export function ChatView() {
  const { messages, activeMessage, status, send, abort, clear } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, activeMessage]);

  const allMessages = activeMessage
    ? [...messages, activeMessage]
    : messages;

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6"
      >
        {allMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-zinc-500">
              <p className="text-lg font-medium mb-1">VWork Chat</p>
              <p className="text-sm">Ask about your work, generate reports, manage todos</p>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            {allMessages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {status !== "idle" && !activeMessage && (
              <div className="flex justify-start">
                <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-4 py-3">
                  <span className="text-zinc-400 text-sm animate-pulse">Thinking...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <Input status={status} onSend={send} onAbort={abort} onClear={clear} />
    </div>
  );
}
