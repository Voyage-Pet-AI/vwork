#!/usr/bin/env bun
import { loadConfig, initConfig, configExists, getConfigPath, resolveSecret, updateSlackConfig, type SlackInitConfig, type Config } from "./config.js";
import { getEnabledServers } from "./mcp/registry.js";
import { MCPClientManager } from "./mcp/client.js";
import { AnthropicProvider } from "./llm/anthropic.js";
import { OpenAIProvider } from "./llm/openai.js";
import { runAgent } from "./llm/agent.js";
import { buildSystemPrompt, buildUserMessage, buildScheduleUserMessage } from "./report/prompt.js";
import { loadRelevantReports, saveReport, listReports } from "./report/memory.js";
import { getSchedule } from "./schedule/store.js";
import { sendNotification } from "./schedule/notify.js";
import { VectorDB } from "./memory/vectordb.js";
import { EmbeddingClient } from "./memory/embeddings.js";
import { loginGitHub, logoutGitHub, loadStoredGitHubToken } from "./auth/github.js";
import {
  loginAnthropicApiKey,
  logoutAnthropic,
  hasAnthropicAuth,
} from "./auth/anthropic.js";
import {
  loginOpenAI,
  logoutOpenAI,
  hasOpenAIAuth,
} from "./auth/openai.js";
import { getSlackToken } from "./auth/tokens.js";
import { promptSlackToken, hasSlackAuth, logoutSlack } from "./auth/slack.js";
import {
  AtlassianOAuthProvider,
  hasAtlassianAuth,
  getAtlassianTokenInfo,
  clearAtlassianAuth,
} from "./auth/atlassian.js";
import { waitForOAuthCallback } from "./auth/callback.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { loadMCPConfig, saveMCPConfig, mcpConfigToServers, getMCPConfigPath, type MCPServerDef } from "./mcp/config.js";
import { MCP_CATALOG, type CatalogEntry } from "./mcp/catalog.js";
import { multiselect, cancelSymbol, type MultiselectItem } from "./prompts/multiselect.js";
import { ChatSession } from "./chat/session.js";
import { startTUI } from "./tui/app.js";
import { log, error } from "./utils/log.js";
import { readLine } from "./utils/readline.js";

import type { LLMProvider } from "./llm/provider.js";

export function createProvider(config: Config): LLMProvider {
  switch (config.llm.provider) {
    case "openai":
      return new OpenAIProvider(config);
    case "anthropic":
    default:
      return new AnthropicProvider(config);
  }
}

const VERSION = "0.1.2";

const args = process.argv.slice(2);
const command = args[0] ?? "chat";

async function main() {
  if (args.includes("-v") || args.includes("--version")) {
    console.log(VERSION);
    return;
  }

  switch (command) {
    case "chat":
      return cmdChat();
    case "init":
      return cmdInit();
    case "run":
      return cmdRun();
    case "auth":
      return cmdAuth();
    case "login":
      return cmdLogin();
    case "logout":
      return cmdLogout();
    case "mcp":
      return cmdMcp();
    case "memory":
      return cmdMemory();
    case "history":
      return cmdHistory();
    case "schedule":
      return cmdSchedule();
    default:
      return cmdHelp();
  }
}

async function cmdInit() {
  // 1. Config creation
  if (configExists()) {
    console.log(`Config already exists at ${getConfigPath()}`);
  } else {
    console.log(initConfig());
    const configPath = getConfigPath();
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    Bun.spawn([opener, configPath], { stdio: ["ignore", "ignore", "ignore"] });
  }

  const config = loadConfig();

  // Check LLM auth and offer login if needed
  if (config.llm.provider === "openai") {
    const openaiAuth = hasOpenAIAuth();
    if (openaiAuth.mode !== "none") {
      log(`OpenAI: authenticated (${openaiAuth.mode})`);
    } else if (!config.llm.api_key_env || !resolveSecret(config.llm.api_key_env)) {
      process.stderr.write("\nLog in to OpenAI with OAuth? (Y/n) ");
      const answer = await readLine();
      if (answer.trim().toLowerCase() !== "n") {
        await loginOpenAI();
      }
    } else {
      log("OpenAI: authenticated (config)");
    }
  } else {
    const anthropicAuth = hasAnthropicAuth();
    if (anthropicAuth.mode !== "none") {
      log(`Anthropic: authenticated (${anthropicAuth.mode})`);
    } else if (!config.llm.api_key_env || !resolveSecret(config.llm.api_key_env)) {
      process.stderr.write("\nLog in to Anthropic with OAuth? (Y/n) ");
      const answer = await readLine();
      if (answer.trim().toLowerCase() !== "n") {
        await loginAnthropicApiKey();
      }
    } else {
      log("Anthropic: authenticated (config)");
    }
  }

  // 2. Determine which builtins are already authenticated
  const githubAuthed = !!(loadStoredGitHubToken() || config.github.token_env);
  const jiraAuthed = hasAtlassianAuth();
  const slackToken = getSlackToken() || (config.slack.token_env && resolveSecret(config.slack.token_env));
  const slackAuthed = !!slackToken;

  const authedBuiltins: Record<string, boolean> = {
    github: githubAuthed,
    jira: jiraAuthed,
    slack: slackAuthed,
  };

  // Print status for already-authenticated services
  if (githubAuthed) log("GitHub: authenticated");
  if (jiraAuthed) log("Jira: authenticated");
  if (slackAuthed) log("Slack: authenticated");

  // 3. Build unified multiselect — skip authed builtins + already-configured MCP servers
  const existingMCPConfig = loadMCPConfig();
  const existingMCPNames = new Set(Object.keys(existingMCPConfig.mcpServers));

  const available = MCP_CATALOG.filter((entry) => {
    if (entry.builtin) return !authedBuiltins[entry.name];
    return !existingMCPNames.has(entry.name);
  });

  if (available.length === 0) return;

  process.stderr.write("\n");
  const items: MultiselectItem<CatalogEntry>[] = available.map((entry) => ({
    value: entry,
    label: entry.label,
    hint: entry.description,
  }));

  const result = await multiselect<CatalogEntry>({
    message: "Set up integrations",
    items,
  });

  if (result === cancelSymbol || (Array.isArray(result) && result.length === 0)) {
    return;
  }

  const selectedEntries = result as CatalogEntry[];

  // 4. Process each selected entry
  const mcpConfig = loadMCPConfig();
  let addedCount = 0;

  for (const entry of selectedEntries) {
    if (entry.builtin) {
      await handleBuiltinSetup(entry, config);
    } else {
      const added = await handleCatalogSetup(entry, mcpConfig);
      if (added) addedCount++;
    }
  }

  if (addedCount > 0) {
    saveMCPConfig(mcpConfig);
    log(`Saved ${addedCount} MCP server${addedCount > 1 ? "s" : ""} to ${getMCPConfigPath()}`);
  }
}

async function handleBuiltinSetup(entry: CatalogEntry, _config: ReturnType<typeof loadConfig>) {
  process.stderr.write("\n");
  switch (entry.name) {
    case "github":
      await loginGitHub();
      break;
    case "jira":
      await cmdAuthLogin();
      break;
    case "slack": {
      process.stderr.write("  Channels (comma-separated, e.g. #general, #eng): ");
      const channelsRaw = (await readLine()).trim();
      const channels = channelsRaw
        ? channelsRaw.split(",").map((c) => c.trim()).filter(Boolean)
        : [];

      const slackInit: SlackInitConfig = { channels };
      updateSlackConfig(slackInit);
      log("Slack config saved.");

      await promptSlackToken();
      break;
    }
  }
}

async function handleCatalogSetup(entry: CatalogEntry, mcpConfig: ReturnType<typeof loadMCPConfig>): Promise<boolean> {
  const def: MCPServerDef = {
    type: entry.type!,
    command: entry.command!,
    args: [...(entry.args ?? [])],
  };

  if (entry.prompts) {
    const env: Record<string, string> = {};

    for (const prompt of entry.prompts) {
      process.stderr.write(
        `  ${entry.label} — ${prompt.message}${prompt.placeholder ? ` (e.g. ${prompt.placeholder})` : ""}: `,
      );
      const value = (await readLine()).trim();

      if (prompt.required && !value) {
        error(`Required value missing. Skipping ${entry.label}.`);
        return false;
      }

      if (value) {
        if (prompt.key === "args") {
          def.args!.push(value);
        } else if (prompt.key.startsWith("env.")) {
          const envKey = prompt.key.slice(4);
          env[envKey] = value;
        }
      }
    }

    if (Object.keys(env).length > 0) {
      def.env = env;
    }
  }

  mcpConfig.mcpServers[entry.name] = def;
  log(`Added ${entry.label}`);
  return true;
}


async function cmdAuth() {
  const subcommand = args[1];

  switch (subcommand) {
    case "login":
      return cmdAuthLogin();
    case "logout":
      return cmdAuthLogout();
    case "status":
      return cmdAuthStatus();
    case "slack":
      return cmdAuthSlack();
    default:
      console.log(`Usage:
  reporter auth login     Authenticate with Atlassian (Jira) via browser OAuth
  reporter auth logout    Remove stored Atlassian tokens
  reporter auth status    Show Atlassian authentication status
  reporter auth slack     Authenticate with Slack via bot token`);
      process.exit(1);
  }
}

const CALLBACK_PORT = 32191;

async function cmdAuthLogin() {
  if (!configExists()) {
    error(`Config not found. Run "reporter init" first.`);
    process.exit(1);
  }

  const config = loadConfig();
  const url = config.jira.url;

  log("Starting Atlassian OAuth login...");

  const provider = new AtlassianOAuthProvider();
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    authProvider: provider,
  });

  try {
    await transport.start();
    log("Already authenticated!");
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;

    log("Opening browser for Atlassian authorization...");
    const code = await waitForOAuthCallback(CALLBACK_PORT);
    await transport.finishAuth(code);
  }

  // Verify by connecting and listing tools
  const client = new Client({ name: "reporter", version: "0.1.0" });
  await client.connect(transport);
  const result = await client.listTools();
  log(`Authenticated — ${result.tools.length} Jira tools available`);
  await transport.close();
}

function cmdAuthLogout() {
  if (hasAtlassianAuth()) {
    clearAtlassianAuth();
    log("Atlassian tokens removed.");
  } else {
    log("No stored Atlassian tokens found.");
  }
}

function cmdAuthStatus() {
  const info = getAtlassianTokenInfo();
  if (!info.hasTokens) {
    console.log("Atlassian: Not authenticated");
    console.log('  Run "reporter auth login" to authenticate.');
  } else {
    console.log("Atlassian: Authenticated");
    if (info.scope) console.log(`  Scope: ${info.scope}`);
    if (info.expiresIn) console.log(`  Token expires in: ${info.expiresIn}s`);
  }

  if (hasSlackAuth()) {
    console.log("Slack: Token stored");
  } else {
    console.log("Slack: Not authenticated");
    console.log('  Run "reporter login slack" or "reporter auth slack" to authenticate.');
  }
}

async function cmdAuthSlack() {
  if (!configExists()) {
    error(`Config not found. Run "reporter init" first.`);
    process.exit(1);
  }

  await promptSlackToken();
}

async function cmdLogin() {
  const service = args[1];
  switch (service) {
    case "github":
      return loginGitHub();
    case "anthropic":
      return loginAnthropicApiKey();
    case "openai":
      return loginOpenAI();
    case "slack":
      return promptSlackToken();
    default:
      console.log(`Usage:
  reporter login github               Authenticate with GitHub via browser OAuth
  reporter login anthropic             Authenticate with Anthropic via OAuth (creates API key)
  reporter login openai                Authenticate with OpenAI via OAuth (ChatGPT Pro/Plus)
  reporter login slack                 Authenticate with Slack via bot token`);
      process.exit(1);
  }
}

async function cmdLogout() {
  const service = args[1];
  switch (service) {
    case "github":
      return logoutGitHub();
    case "anthropic":
      return logoutAnthropic();
    case "openai":
      return logoutOpenAI();
    case "slack":
      return logoutSlack();
    default:
      console.log(`Usage:
  reporter logout github      Remove stored GitHub token
  reporter logout anthropic   Remove stored Anthropic tokens
  reporter logout openai      Remove stored OpenAI tokens
  reporter logout slack       Remove stored Slack token`);
      process.exit(1);
  }
}

async function cmdChat() {
  if (!configExists()) {
    error(`Config not found. Run "reporter init" first.`);
    process.exit(1);
  }

  const config = loadConfig();

  // MCP servers are optional for chat — gather what we can
  const servers: ReturnType<typeof getEnabledServers> = [];
  let customServerNames: string[] = [];

  try {
    servers.push(...getEnabledServers(config));
  } catch (e) {
    log(`Skipping some integrations: ${e instanceof Error ? e.message : e}`);
  }

  try {
    const mcpConfig = loadMCPConfig();
    const customServers = mcpConfigToServers(mcpConfig);
    customServerNames = customServers.map((s) => s.name);
    servers.push(...customServers);
  } catch (_) {}

  const mcpClient = new MCPClientManager(config.github?.orgs ?? []);

  try {
    if (servers.length > 0) {
      await mcpClient.connect(servers);
    }

    const provider = createProvider(config);
    const session = new ChatSession(provider, mcpClient, config, customServerNames);

    // Build services list for TUI header
    const services = servers.map((s) => ({ name: s.name.charAt(0).toUpperCase() + s.name.slice(1) }));
    await startTUI({ session, config, services });
  } finally {
    await mcpClient.disconnect();
  }
}

async function cmdRun() {
  if (!configExists()) {
    error(`Config not found. Run "reporter init" first.`);
    process.exit(1);
  }

  const config = loadConfig();
  const isDry = args.includes("--dry");
  const noSave = args.includes("--no-save");

  // Spawn MCP servers
  const servers = getEnabledServers(config);

  // Merge custom MCP servers from .mcp.json
  let customServerNames: string[] = [];
  try {
    const mcpConfig = loadMCPConfig();
    const customServers = mcpConfigToServers(mcpConfig);
    customServerNames = customServers.map((s) => s.name);
    servers.push(...customServers);
  } catch (e) {
    error(`Failed to load .mcp.json: ${e instanceof Error ? e.message : e}`);
  }

  if (servers.length === 0) {
    error("No integrations enabled. Edit your config: " + getConfigPath());
    process.exit(1);
  }

  const mcpClient = new MCPClientManager(config.github.orgs ?? []);

  try {
    await mcpClient.connect(servers);

    const tools = mcpClient.getAllTools();
    if (tools.length === 0) {
      error("No tools available from any MCP server.");
      process.exit(1);
    }

    // Dry run: just list tools and exit
    if (isDry) {
      log(`${tools.length} tools available:`);
      for (const t of tools) {
        console.log(`  ${t.name} — ${t.description ?? "(no description)"}`);
      }
      return;
    }

    // Build prompt with memory
    const { content: pastReports, usedVectorSearch } = await loadRelevantReports(config);
    const systemPrompt = buildSystemPrompt(config, pastReports, customServerNames, usedVectorSearch);
    const userMessage = buildUserMessage(config);

    // Run the agentic loop
    const provider = createProvider(config);
    const report = await runAgent(provider, mcpClient, systemPrompt, userMessage);

    // Output to stdout
    console.log(report);

    // Save report
    if (!noSave) {
      const path = await saveReport(config, report);
      log(`Report saved to ${path}`);
    }
  } finally {
    await mcpClient.disconnect();
  }
}

function cmdMcp() {
  const subcommand = args[1];

  switch (subcommand) {
    case "add":
      return cmdMcpAdd();
    case "remove":
      return cmdMcpRemove();
    case "list":
      return cmdMcpList();
    default:
      console.log(`Usage:
  reporter mcp add <name> --transport stdio -- <cmd> [args]   Add stdio server
  reporter mcp add <name> --transport http <url>              Add HTTP server
  reporter mcp add <name> -e KEY=VAL -e KEY2=VAL2             With env vars
  reporter mcp remove <name>                                  Remove a server
  reporter mcp list                                           List servers`);
      process.exit(1);
  }
}

function cmdMcpAdd() {
  const name = args[2];
  if (!name) {
    error("Missing server name. Usage: reporter mcp add <name> ...");
    process.exit(1);
  }

  // Parse --transport
  const transportIdx = args.indexOf("--transport");
  const transport = transportIdx !== -1 ? args[transportIdx + 1] : undefined;
  if (transport !== "stdio" && transport !== "http") {
    error('Missing or invalid --transport. Must be "stdio" or "http".');
    process.exit(1);
  }

  // Parse -e / --env flags
  const envVars: Record<string, string> = {};
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "-e" || args[i] === "--env") {
      const pair = args[i + 1];
      if (!pair || !pair.includes("=")) {
        error(`Invalid env format: ${pair}. Use KEY=VALUE.`);
        process.exit(1);
      }
      const eqIdx = pair.indexOf("=");
      envVars[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
      i++; // skip value
    }
  }

  const config = loadMCPConfig();
  const def: MCPServerDef = { type: transport };

  if (transport === "stdio") {
    // Everything after "--" is the command + args
    const dashDash = args.indexOf("--");
    if (dashDash === -1 || !args[dashDash + 1]) {
      error("Stdio transport requires: -- <command> [args...]");
      process.exit(1);
    }
    def.command = args[dashDash + 1];
    def.args = args.slice(dashDash + 2);
    if (Object.keys(envVars).length > 0) {
      def.env = envVars;
    }
  } else {
    // HTTP: the URL is the last positional arg (not a flag value)
    // Find the URL — it's after --transport http and not a flag
    let url: string | undefined;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--transport" || args[i] === "-e" || args[i] === "--env") {
        i++; // skip value
        continue;
      }
      if (args[i] === name) continue;
      if (args[i].startsWith("-")) continue;
      url = args[i];
    }
    if (!url) {
      error("HTTP transport requires a URL. Usage: reporter mcp add <name> --transport http <url>");
      process.exit(1);
    }
    def.url = url;
    if (Object.keys(envVars).length > 0) {
      // Store env vars as headers for HTTP (common pattern: Authorization tokens)
      def.headers = envVars;
    }
  }

  config.mcpServers[name] = def;
  saveMCPConfig(config);
  log(`Added MCP server "${name}" (${transport})`);
}

function cmdMcpRemove() {
  const name = args[2];
  if (!name) {
    error("Missing server name. Usage: reporter mcp remove <name>");
    process.exit(1);
  }

  const config = loadMCPConfig();
  if (!config.mcpServers[name]) {
    error(`No MCP server named "${name}" found.`);
    process.exit(1);
  }

  delete config.mcpServers[name];
  saveMCPConfig(config);
  log(`Removed MCP server "${name}"`);
}

function cmdMcpList() {
  const config = loadMCPConfig();
  const servers = Object.entries(config.mcpServers);

  if (servers.length === 0) {
    console.log("No custom MCP servers configured.");
    console.log(`Add one with: reporter mcp add <name> --transport stdio -- <cmd>`);
    return;
  }

  console.log("Custom MCP servers:");
  for (const [name, def] of servers) {
    if (def.type === "stdio") {
      console.log(`  ${name} (stdio): ${def.command} ${(def.args ?? []).join(" ")}`);
    } else {
      console.log(`  ${name} (http): ${def.url}`);
    }
  }
}

async function cmdMemory() {
  if (!configExists()) {
    error(`Config not found. Run "reporter init" first.`);
    process.exit(1);
  }

  const config = loadConfig();
  const subcommand = args[1];

  if (!config.memory?.enabled) {
    error('Memory is not enabled. Add [memory] section to config and set enabled = true.');
    process.exit(1);
  }

  const apiKey = resolveSecret(config.memory.api_key_env);
  if (!apiKey) {
    error(`Voyage API key not found. Set ${config.memory.api_key_env} environment variable.`);
    process.exit(1);
  }

  const embeddingClient = new EmbeddingClient(apiKey, config.memory.embedding_model);
  const db = new VectorDB(config.memory.db_path);

  try {
    switch (subcommand) {
      case "index":
        return await cmdMemoryIndex(config, db, embeddingClient);
      case "add":
        return await cmdMemoryAdd(config, db, embeddingClient);
      case "search":
        return await cmdMemorySearch(db, embeddingClient);
      case "stats":
        return cmdMemoryStats(db);
      case "clear":
        return cmdMemoryClear(db);
      case "notes":
        return cmdMemoryNotes(db);
      case "forget":
        return cmdMemoryForget(db);
      default:
        console.log(`Usage:
  reporter memory index              Embed all existing reports into vector DB
  reporter memory add <text>         Store a note for future context
  reporter memory search <query>     Search memory (debug tool)
  reporter memory stats              Show memory statistics
  reporter memory clear              Wipe all embeddings
  reporter memory notes              List stored notes
  reporter memory forget <date>      Remove a specific note by date`);
        process.exit(1);
    }
  } finally {
    db.close();
  }
}

async function cmdMemoryIndex(
  config: Config,
  db: VectorDB,
  client: EmbeddingClient
) {
  const { readdirSync, readFileSync } = await import("fs");
  const { join } = await import("path");
  const { homedir } = await import("os");

  const dir = config.report.output_dir.replace("~", homedir());
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();

  if (files.length === 0) {
    console.log("No reports found to index.");
    return;
  }

  const alreadyEmbedded = db.getEmbeddedDates(config.memory!.embedding_model);
  const toEmbed = files.filter((f) => !alreadyEmbedded.has(f.replace(".md", "")));

  if (toEmbed.length === 0) {
    console.log(`All ${files.length} reports already indexed.`);
    return;
  }

  log(`Indexing ${toEmbed.length} report(s) (${alreadyEmbedded.size} already indexed)...`);

  const texts = toEmbed.map((f) => readFileSync(join(dir, f), "utf-8"));
  const embeddings = await client.embedDocuments(texts);

  for (let i = 0; i < toEmbed.length; i++) {
    const date = toEmbed[i].replace(".md", "");
    db.upsert("report", date, texts[i], embeddings[i], config.memory!.embedding_model);
  }

  log(`Indexed ${toEmbed.length} report(s).`);
}

async function cmdMemoryAdd(
  config: Config,
  db: VectorDB,
  client: EmbeddingClient
) {
  const text = args.slice(2).join(" ");
  if (!text) {
    error('Missing note text. Usage: reporter memory add "your note here"');
    process.exit(1);
  }

  const embedding = await client.embedDocument(text);
  const date = new Date().toISOString();
  db.upsert("note", date, text, embedding, config.memory!.embedding_model);
  log("Note stored.");
}

async function cmdMemorySearch(
  db: VectorDB,
  client: EmbeddingClient
) {
  const query = args.slice(2).join(" ");
  if (!query) {
    error('Missing query. Usage: reporter memory search "your query"');
    process.exit(1);
  }

  const embedding = await client.embedQuery(query);
  const results = db.query(embedding, 5);

  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  for (const r of results) {
    const label = r.type === "note" ? "Note" : "Report";
    const score = (1 - r.distance).toFixed(3);
    const preview = r.content.slice(0, 200).replace(/\n/g, " ");
    console.log(`[${label}] ${r.date} (relevance: ${score})`);
    console.log(`  ${preview}${r.content.length > 200 ? "..." : ""}\n`);
  }
}

function cmdMemoryStats(db: VectorDB) {
  const stats = db.getStats();
  console.log(`Memory statistics:`);
  console.log(`  Reports indexed: ${stats.reports}`);
  console.log(`  Notes stored:    ${stats.notes}`);
  console.log(`  Total:           ${stats.reports + stats.notes}`);
}

function cmdMemoryClear(db: VectorDB) {
  db.clearAll();
  log("All embeddings cleared.");
}

function cmdMemoryNotes(db: VectorDB) {
  const notes = db.getNotes();
  if (notes.length === 0) {
    console.log("No notes stored.");
    return;
  }

  console.log("Stored notes:");
  for (const n of notes) {
    const dateStr = n.date.split("T")[0];
    console.log(`  [${dateStr}] ${n.content}`);
  }
}

function cmdMemoryForget(db: VectorDB) {
  const date = args[2];
  if (!date) {
    error('Missing date. Usage: reporter memory forget <date>');
    process.exit(1);
  }

  // Try to find notes that match — notes use ISO timestamps, so match by prefix
  const notes = db.getNotes();
  const matching = notes.filter((n) => n.date.startsWith(date));

  if (matching.length === 0) {
    error(`No notes found matching "${date}".`);
    process.exit(1);
  }

  for (const n of matching) {
    db.deleteByDate("note", n.date);
  }
  log(`Removed ${matching.length} note(s).`);
}

function cmdHistory() {
  if (!configExists()) {
    error(`Config not found. Run "reporter init" first.`);
    process.exit(1);
  }

  const config = loadConfig();
  const reports = listReports(config);

  if (reports.length === 0) {
    console.log("No reports yet. Run \"reporter run\" to generate one.");
    return;
  }

  console.log("Past reports:");
  for (const r of reports) {
    console.log(`  ${r}`);
  }
}

async function cmdSchedule() {
  if (args[1] === "run") {
    return cmdScheduleRun();
  }

  console.log(`Usage:
  reporter schedule run <name>    Run a scheduled report (used by cron)

Manage schedules interactively in chat:
  /schedule                       List schedules
  /schedule add                   Create a new schedule
  /schedule remove <name>         Remove a schedule`);
}

async function cmdScheduleRun() {
  const name = args[2];
  if (!name) {
    error("Missing schedule name. Usage: reporter schedule run <name>");
    process.exit(1);
  }

  const schedule = getSchedule(name);
  if (!schedule) {
    error(`No schedule named "${name}" found.`);
    process.exit(1);
  }

  if (!configExists()) {
    error(`Config not found. Run "reporter init" first.`);
    process.exit(1);
  }

  const config = loadConfig();
  const servers = getEnabledServers(config);

  // Merge custom MCP servers
  let customServerNames: string[] = [];
  try {
    const mcpConfig = loadMCPConfig();
    const customServers = mcpConfigToServers(mcpConfig);
    customServerNames = customServers.map((s) => s.name);
    servers.push(...customServers);
  } catch (e) {
    error(`Failed to load .mcp.json: ${e instanceof Error ? e.message : e}`);
  }

  if (servers.length === 0) {
    const msg = "No integrations enabled.";
    error(msg);
    await sendNotification("Reporter", name, msg);
    process.exit(1);
  }

  const mcpClient = new MCPClientManager(config.github.orgs ?? []);

  try {
    await mcpClient.connect(servers);

    const { content: pastReports, usedVectorSearch } = await loadRelevantReports(config);
    const systemPrompt = buildSystemPrompt(config, pastReports, customServerNames, usedVectorSearch);
    const userMessage = buildScheduleUserMessage(config, schedule.prompt || undefined);

    const provider = createProvider(config);
    const report = await runAgent(provider, mcpClient, systemPrompt, userMessage);

    // Save with schedule-specific filename
    const { writeFileSync, mkdirSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");
    const dir = config.report.output_dir.replace("~", homedir());
    mkdirSync(dir, { recursive: true });
    const date = new Date().toISOString().split("T")[0];
    const path = join(dir, `${date}-${name}.md`);
    writeFileSync(path, report);

    log(`Report saved to ${path}`);
    await sendNotification("Reporter", name, "Report generated successfully.");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    error(msg);
    await sendNotification("Reporter", `${name} failed`, msg.slice(0, 200));
    process.exit(1);
  } finally {
    await mcpClient.disconnect();
  }
}

function cmdHelp() {
  console.log(`reporter — AI-powered work assistant

Commands:
  reporter                             Start interactive chat (default)
  reporter chat                        Start interactive chat
  reporter init                        Create config at ~/reporter/config.toml
  reporter run                         Generate report (stdout)
  reporter run --dry                   List available tools, skip LLM
  reporter run --no-save               Don't save report to disk
  reporter login anthropic             Authenticate with Anthropic via OAuth
  reporter logout anthropic            Remove stored Anthropic tokens
  reporter login openai                Authenticate with OpenAI via OAuth (ChatGPT Pro/Plus)
  reporter logout openai               Remove stored OpenAI tokens
  reporter login github                Authenticate with GitHub via browser OAuth
  reporter logout github               Remove stored GitHub token
  reporter login slack                 Authenticate with Slack via bot token
  reporter logout slack                Remove stored Slack token
  reporter auth login                  Authenticate with Atlassian (Jira) via browser OAuth
  reporter auth logout                 Remove stored Atlassian tokens
  reporter auth status                 Show Atlassian authentication status
  reporter auth slack                  Authenticate with Slack via bot token
  reporter mcp add <name> ...          Add a custom MCP server
  reporter mcp remove <name>           Remove a custom MCP server
  reporter mcp list                    List custom MCP servers
  reporter memory index                Embed existing reports into vector DB
  reporter memory add <text>           Store a note for future context
  reporter memory search <query>       Search memory (debug tool)
  reporter memory stats                Show memory statistics
  reporter memory clear                Wipe all embeddings
  reporter memory notes                List stored notes
  reporter memory forget <date>        Remove a note by date
  reporter history                     List past reports
  reporter schedule run <name>         Run a scheduled report (used by cron)

Options:
  -v, --version                    Show version

Environment:
  ANTHROPIC_API_KEY    Claude API key (optional if using "reporter login anthropic")
  OPENAI_API_KEY       OpenAI API key (optional if using "reporter login openai")
  GITHUB_TOKEN         GitHub token (optional if using "reporter login github")
  SLACK_BOT_TOKEN      Slack bot token (optional if using "reporter auth slack")
  REPORTER_DEBUG       Set to 1 for debug logging`);
}

main().catch((e) => {
  error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
