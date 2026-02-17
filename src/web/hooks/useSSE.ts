import { useEffect, useRef, useCallback } from "react";

interface SSEHandlers {
  onText?: (data: { delta: string }) => void;
  onToolStart?: (data: { id: string; name: string; displayName: string; summary: string }) => void;
  onToolEnd?: (data: { id: string; status: "done" | "error"; resultSummary: string }) => void;
  onComplete?: () => void;
  onError?: (data: { message: string }) => void;
  onStatus?: (data: { status: string }) => void;
  onUserMessage?: (data: { message: string }) => void;
}

export function useSSE(url: string, handlers: SSEHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    const source = new EventSource(url);

    source.addEventListener("text", (e) => {
      handlersRef.current.onText?.(JSON.parse(e.data));
    });

    source.addEventListener("tool_start", (e) => {
      handlersRef.current.onToolStart?.(JSON.parse(e.data));
    });

    source.addEventListener("tool_end", (e) => {
      handlersRef.current.onToolEnd?.(JSON.parse(e.data));
    });

    source.addEventListener("complete", () => {
      handlersRef.current.onComplete?.();
    });

    source.addEventListener("error", (e) => {
      // SSE connection error vs server error event
      if (e instanceof MessageEvent) {
        handlersRef.current.onError?.(JSON.parse(e.data));
      }
    });

    source.addEventListener("status", (e) => {
      handlersRef.current.onStatus?.(JSON.parse(e.data));
    });

    source.addEventListener("user_message", (e) => {
      handlersRef.current.onUserMessage?.(JSON.parse(e.data));
    });

    return source;
  }, [url]);

  useEffect(() => {
    const source = connect();
    return () => source.close();
  }, [connect]);
}
