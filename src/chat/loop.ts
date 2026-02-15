import * as readline from "readline";
import pc from "picocolors";
import type { ChatSession } from "./session.js";
import type { StreamCallbacks, ToolCall } from "../llm/provider.js";

const PROMPT = pc.cyan("> ");

export async function runChatLoop(session: ChatSession): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr, // prompt goes to stderr (keeps stdout for piping)
    prompt: PROMPT,
    terminal: true,
  });

  process.stderr.write(
    pc.bold("Reporter") + pc.dim(" — type a message, or /help for commands\n\n")
  );
  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      continue;
    }

    // Slash commands
    if (input.startsWith("/")) {
      const result = handleSlashCommand(input, session);
      if (result === "exit") {
        rl.close();
        return;
      }
      rl.prompt();
      continue;
    }

    // Send to Claude with streaming
    const callbacks: StreamCallbacks = {
      onText: (delta) => {
        process.stdout.write(delta);
      },
      onToolStart: (tc: ToolCall) => {
        const displayName = tc.name.replace("__", " → ");
        process.stderr.write(pc.dim(`  [${displayName}]\n`));
      },
      onToolEnd: () => {},
      onComplete: () => {},
      onError: (err) => {
        process.stderr.write(pc.red(`\nError: ${err.message}\n`));
      },
    };

    try {
      await session.send(input, callbacks);
    } catch (err) {
      process.stderr.write(
        pc.red(`Error: ${err instanceof Error ? err.message : err}\n`)
      );
    }

    process.stdout.write("\n\n");
    rl.prompt();
  }
}

function handleSlashCommand(input: string, session: ChatSession): string | void {
  const cmd = input.split(/\s+/)[0].toLowerCase();

  switch (cmd) {
    case "/exit":
    case "/quit":
    case "/q":
      process.stderr.write(pc.dim("Goodbye.\n"));
      return "exit";

    case "/clear":
      session.clear();
      process.stderr.write(pc.dim("Conversation cleared.\n"));
      return;

    case "/help":
      process.stderr.write(`${pc.bold("Commands:")}
  /help     Show this help
  /clear    Clear conversation history
  /exit     Exit chat
`);
      return;

    default:
      process.stderr.write(
        pc.dim(`Unknown command: ${cmd}. Type /help for available commands.\n`)
      );
      return;
  }
}
