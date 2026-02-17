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

function safeParse(raw: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function useSSE(url: string, handlers: SSEHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    const source = new EventSource(url);

    source.addEventListener("text", (e) => {
      const result = safeParse(e.data);
      if (result.ok) handlersRef.current.onText?.(result.value);
      else handlersRef.current.onError?.({ message: `Parse error: ${result.error}` });
    });

    source.addEventListener("tool_start", (e) => {
      const result = safeParse(e.data);
      if (result.ok) handlersRef.current.onToolStart?.(result.value);
      else handlersRef.current.onError?.({ message: `Parse error: ${result.error}` });
    });

    source.addEventListener("tool_end", (e) => {
      const result = safeParse(e.data);
      if (result.ok) handlersRef.current.onToolEnd?.(result.value);
      else handlersRef.current.onError?.({ message: `Parse error: ${result.error}` });
    });

    source.addEventListener("complete", () => {
      handlersRef.current.onComplete?.();
    });

    source.addEventListener("error", (e) => {
      if (e instanceof MessageEvent) {
        const result = safeParse(e.data);
        if (result.ok) handlersRef.current.onError?.(result.value);
        else handlersRef.current.onError?.({ message: `Parse error: ${result.error}` });
      }
    });

    source.addEventListener("status", (e) => {
      const result = safeParse(e.data);
      if (result.ok) handlersRef.current.onStatus?.(result.value);
      else handlersRef.current.onError?.({ message: `Parse error: ${result.error}` });
    });

    source.addEventListener("user_message", (e) => {
      const result = safeParse(e.data);
      if (result.ok) handlersRef.current.onUserMessage?.(result.value);
      else handlersRef.current.onError?.({ message: `Parse error: ${result.error}` });
    });

    return source;
  }, [url]);

  useEffect(() => {
    const source = connect();
    return () => source.close();
  }, [connect]);
}
