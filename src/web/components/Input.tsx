import { useState, useCallback, useRef } from "react";
import type { AppStatus } from "../lib/types.js";

interface InputProps {
  status: AppStatus;
  onSend: (text: string) => void;
  onAbort: () => void;
  onClear: () => void;
}

export function Input({ status, onSend, onAbort, onClear }: InputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || status !== "idle") return;
    onSend(trimmed);
    setText("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, status, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape" && status !== "idle") {
        onAbort();
      }
    },
    [handleSend, status, onAbort]
  );

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  const busy = status !== "idle";

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/80 backdrop-blur-sm p-4">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={busy ? "Waiting for response..." : "Send a message..."}
          disabled={busy}
          rows={1}
          className="flex-1 resize-none bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
        />
        {busy ? (
          <button
            onClick={onAbort}
            className="shrink-0 px-4 py-2.5 bg-red-600/20 text-red-400 border border-red-500/30 rounded-lg text-sm font-medium hover:bg-red-600/30 transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className="shrink-0 px-4 py-2.5 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg text-sm font-medium hover:bg-blue-600/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Send
          </button>
        )}
        <button
          onClick={onClear}
          title="Clear conversation"
          className="shrink-0 px-3 py-2.5 text-zinc-500 hover:text-zinc-300 transition-colors text-sm"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
