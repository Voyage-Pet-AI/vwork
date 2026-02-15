import chalk from "chalk";
// Force color support — chalk detects level 0 inside Ink's managed terminal
chalk.level = 3;

import { marked, type Tokens } from "marked";
import { markedTerminal } from "marked-terminal";

marked.use(markedTerminal({ width: 80, reflowText: true, tab: 2 }));

// Fix marked-terminal's text renderer: it doesn't parse inline tokens
// (bold, italic, etc.) inside text nodes, so `* **bold**` in list items
// renders as raw `**bold**`. We override to call parseInline when tokens exist.
marked.use({
  renderer: {
    text(token: Tokens.Text | Tokens.Escape) {
      if ("tokens" in token && token.tokens) {
        return this.parser.parseInline(token.tokens);
      }
      return token.text;
    },
  },
});

/**
 * Close unclosed markdown delimiters so partial streaming content
 * renders with formatting instead of raw syntax characters.
 */
function closeIncompleteMarkdown(text: string): string {
  // Close unclosed fenced code blocks
  const fenceMatches = text.match(/^```/gm);
  if (fenceMatches && fenceMatches.length % 2 !== 0) {
    text += "\n```";
  }

  // Close unclosed inline code (odd number of backticks outside fences)
  const inlineBackticks = text.match(/(?<!`)`(?!`)/g);
  if (inlineBackticks && inlineBackticks.length % 2 !== 0) {
    text += "`";
  }

  // Close unclosed bold
  const boldMatches = text.match(/\*\*/g);
  if (boldMatches && boldMatches.length % 2 !== 0) {
    text += "**";
  }

  // Close unclosed italic (single * not part of **)
  const italicMatches = text.match(/(?<!\*)\*(?!\*)/g);
  if (italicMatches && italicMatches.length % 2 !== 0) {
    text += "*";
  }

  // Close unclosed strikethrough
  const strikeMatches = text.match(/~~/g);
  if (strikeMatches && strikeMatches.length % 2 !== 0) {
    text += "~~";
  }

  return text;
}

let lastInput = "";
let lastOutput = "";

export function renderMarkdown(content: string): string {
  if (content === lastInput) return lastOutput;

  const closed = closeIncompleteMarkdown(content);
  const rendered = marked.parse(closed, { async: false }) as string;
  // Trim trailing newlines that marked adds
  const result = rendered.replace(/\n+$/, "");

  lastInput = content;
  lastOutput = result;
  return result;
}
