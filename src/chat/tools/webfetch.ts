import type { LLMTool, ToolCall } from "../../llm/provider.js";

const MAX_RESPONSE = 5 * 1024 * 1024; // 5MB
const MAX_OUTPUT = 30_000;
const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 120_000;

export const webfetchTools: LLMTool[] = [
  {
    name: "vwork__webfetch",
    description:
      "Fetch content from a URL. HTML pages are converted to readable markdown. " +
      "Use this to read web pages, documentation, articles, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch",
        },
        format: {
          type: "string",
          enum: ["markdown", "text", "html"],
          description: "Output format: markdown (default, converts HTML), text (strips tags), html (raw)",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000, max: 120000)",
        },
      },
      required: ["url"],
    },
  },
];

async function htmlToMarkdown(html: string): Promise<string> {
  const TurndownService = (await import("turndown")).default;
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  // Remove script/style tags
  td.remove(["script", "style", "nav", "footer", "iframe"]);
  return td.turndown(html);
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function executeWebfetchTool(tc: ToolCall, signal?: AbortSignal): Promise<string> {
  const url = tc.input.url as string;
  const format = (tc.input.format as string) || "markdown";
  const timeout = Math.min(MAX_TIMEOUT, (tc.input.timeout as number) || DEFAULT_TIMEOUT);

  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Error: invalid URL: ${url}`;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return `Error: only HTTP/HTTPS URLs are supported`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  // Forward parent abort signal
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return `Error: HTTP ${response.status} ${response.statusText}`;
    }

    const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_RESPONSE) {
      return `Error: response too large (${(contentLength / 1024 / 1024).toFixed(1)}MB, max 5MB)`;
    }

    const body = await response.text();
    if (body.length > MAX_RESPONSE) {
      return `Error: response too large (${(body.length / 1024 / 1024).toFixed(1)}MB, max 5MB)`;
    }

    const contentType = response.headers.get("content-type") || "";
    const isHtml = contentType.includes("html");

    let output: string;
    if (format === "html" || !isHtml) {
      output = body;
    } else if (format === "text") {
      output = htmlToText(body);
    } else {
      // markdown (default)
      output = await htmlToMarkdown(body);
    }

    if (output.length > MAX_OUTPUT) {
      output = output.slice(0, MAX_OUTPUT) + `\n\n... (content truncated at ${MAX_OUTPUT} bytes)`;
    }

    return output;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return `Error: request timed out after ${timeout / 1000}s`;
    }
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
