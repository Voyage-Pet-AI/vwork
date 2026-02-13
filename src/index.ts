#!/usr/bin/env bun
import { loadConfig, initConfig, configExists, getConfigPath, resolveSecret, updateSlackConfig, type SlackOAuthInit } from "./config.js";
import { getEnabledServers } from "./mcp/registry.js";
import { MCPClientManager } from "./mcp/client.js";
import { AnthropicProvider } from "./llm/anthropic.js";
import { runAgent } from "./llm/agent.js";
import { buildSystemPrompt, buildUserMessage } from "./report/prompt.js";
import { loadPastReports, saveReport, listReports } from "./report/memory.js";
import { loginGitHub, logoutGitHub, loadStoredGitHubToken } from "./auth/github.js";
import {
  loginAnthropicApiKey,
  loginAnthropicMax,
  logoutAnthropic,
  hasAnthropicAuth,
} from "./auth/anthropic.js";
import { getSlackToken } from "./auth/tokens.js";
import { performSlackOAuth } from "./auth/slack.js";
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
import { log, error } from "./utils/log.js";
import { readLine } from "./utils/readline.js";

const args = process.argv.slice(2);
const command = args[0] ?? "help";

async function main() {
  switch (command) {
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

  // Check Anthropic auth and offer login if needed
  const anthropicAuth = hasAnthropicAuth();
  if (anthropicAuth.mode !== "none") {
    log(`Anthropic: authenticated (${anthropicAuth.mode})`);
  } else if (!config.llm.api_key_env || !resolveSecret(config.llm.api_key_env)) {
    process.stderr.write("\nLog in to Anthropic with OAuth? (Y/n) ");
    const answer = await readLine();
    if (answer.trim().toLowerCase() !== "n") {
      process.stderr.write("Use Pro/Max subscription (free inference)? (y/N) ");
      const maxAnswer = await readLine();
      if (maxAnswer.trim().toLowerCase() === "y") {
        await loginAnthropicMax();
      } else {
        await loginAnthropicApiKey();
      }
    }
  } else {
    log("Anthropic: authenticated (config)");
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
      printSlackSetupGuide();

      process.stderr.write("  Slack app client ID: ");
      const clientId = (await readLine()).trim();
      if (!clientId) {
        error("Client ID is required. Skipping Slack setup.");
        break;
      }

      process.stderr.write("  Client secret env var [SLACK_CLIENT_SECRET]: ");
      const secretEnv = (await readLine()).trim() || "SLACK_CLIENT_SECRET";

      process.stderr.write("  Channels (comma-separated, e.g. #general, #eng): ");
      const channelsRaw = (await readLine()).trim();
      const channels = channelsRaw
        ? channelsRaw.split(",").map((c) => c.trim()).filter(Boolean)
        : [];

      const slackInit: SlackOAuthInit = { client_id: clientId, client_secret_env: secretEnv, channels };
      updateSlackConfig(slackInit);
      log("Slack config saved.");

      const clientSecret = resolveSecret(secretEnv);
      if (clientSecret) {
        await performSlackOAuth(clientId, clientSecret);
      } else {
        log(`Set ${secretEnv} env var, then run "reporter auth slack".`);
      }
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

function printSlackSetupGuide() {
  console.error(
    `\n  To get your Slack credentials:\n` +
    `  1. Create a Slack app at https://api.slack.com/apps → "Create New App"\n` +
    `  2. Go to "OAuth & Permissions" → add redirect URL: http://localhost:8371/callback\n` +
    `  3. Under "Scopes" → "Bot Token Scopes", add: channels:history, channels:read, users:read, search:read\n` +
    `  4. Go to "Basic Information" → copy "Client ID" and "Client Secret"\n` +
    `  5. Set the secret as an env var: export SLACK_CLIENT_SECRET="your-secret"\n`
  );
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
  reporter auth slack     Authenticate with Slack via browser OAuth`);
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
    return;
  }
  console.log("Atlassian: Authenticated");
  if (info.scope) console.log(`  Scope: ${info.scope}`);
  if (info.expiresIn) console.log(`  Token expires in: ${info.expiresIn}s`);
}

async function cmdAuthSlack() {
  if (!configExists()) {
    error(`Config not found. Run "reporter init" first.`);
    process.exit(1);
  }

  const config = loadConfig();
  if (!config.slack.client_id) {
    error(
      `Missing client_id in [slack] config.\n` +
      `  1. Create a Slack app at https://api.slack.com/apps\n` +
      `  2. Under "OAuth & Permissions", add redirect URL: http://localhost:8371/callback\n` +
      `  3. Add bot token scopes: channels:history, channels:read, users:read, search:read\n` +
      `  4. Copy "Client ID" from "Basic Information" into ~/reporter/config.toml under [slack]`
    );
    process.exit(1);
  }

  if (!config.slack.client_secret_env) {
    error(
      `Missing client_secret_env in [slack] config.\n` +
      `  1. Copy "Client Secret" from your app's "Basic Information" page:\n` +
      `     https://api.slack.com/apps\n` +
      `  2. Set it as an env var: export SLACK_CLIENT_SECRET="xoxe-..."\n` +
      `  3. Add client_secret_env = "SLACK_CLIENT_SECRET" to [slack] in config`
    );
    process.exit(1);
  }

  const clientSecret = resolveSecret(config.slack.client_secret_env);
  if (!clientSecret) {
    error(
      `Could not resolve Slack client secret from "${config.slack.client_secret_env}".\n` +
      `  Set the ${config.slack.client_secret_env} environment variable.`
    );
    process.exit(1);
  }

  await performSlackOAuth(config.slack.client_id, clientSecret);
}

async function cmdLogin() {
  const service = args[1];
  switch (service) {
    case "github":
      return loginGitHub();
    case "anthropic":
      if (args.includes("--max")) {
        return loginAnthropicMax();
      }
      return loginAnthropicApiKey();
    default:
      console.log(`Usage:
  reporter login github               Authenticate with GitHub via browser OAuth
  reporter login anthropic             Authenticate with Anthropic via OAuth (creates API key)
  reporter login anthropic --max       Authenticate with Anthropic Pro/Max subscription`);
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
    default:
      console.log(`Usage:
  reporter logout github      Remove stored GitHub token
  reporter logout anthropic   Remove stored Anthropic tokens`);
      process.exit(1);
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
    const pastReports = loadPastReports(config);
    const systemPrompt = buildSystemPrompt(config, pastReports, customServerNames);
    const userMessage = buildUserMessage(config);

    // Run the agentic loop
    const provider = new AnthropicProvider(config);
    const report = await runAgent(provider, mcpClient, systemPrompt, userMessage);

    // Output to stdout
    console.log(report);

    // Save report
    if (!noSave) {
      const path = saveReport(config, report);
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

function cmdSchedule() {
  const everyIdx = args.indexOf("--every");
  if (everyIdx === -1 || !args[everyIdx + 1]) {
    console.log('Usage: reporter schedule --every "9am"');
    console.log('       reporter schedule --every "*/6h"');
    console.log('       reporter schedule --every "*/15m"');
    process.exit(1);
  }

  const time = args[everyIdx + 1];
  const binPath = process.argv[1];

  // Parse simple time formats
  let cronExpr: string;
  if (time.match(/^\d{1,2}(am|pm)$/i)) {
    let hour = parseInt(time);
    if (time.toLowerCase().includes("pm") && hour !== 12) hour += 12;
    if (time.toLowerCase().includes("am") && hour === 12) hour = 0;
    cronExpr = `0 ${hour} * * *`;
  } else if (time.match(/^\*\/\d+h$/)) {
    const hours = parseInt(time.slice(2));
    cronExpr = `0 */${hours} * * *`;
  } else if (time.match(/^\*\/\d+m$/)) {
    const minutes = parseInt(time.slice(2));
    cronExpr = `*/${minutes} * * * *`;
  } else {
    // Assume raw cron expression
    cronExpr = time;
  }

  const cronLine = `${cronExpr} ${process.execPath} ${binPath} run`;

  console.log("Add this to your crontab (crontab -e):\n");
  console.log(`  ${cronLine}`);
  console.log("\nOr run:");
  console.log(`  (crontab -l 2>/dev/null; echo "${cronLine}") | crontab -`);
}

function cmdHelp() {
  console.log(`reporter — AI-powered daily work report generator

Commands:
  reporter init                        Create config at ~/reporter/config.toml
  reporter login anthropic             Authenticate with Anthropic via OAuth (creates API key)
  reporter login anthropic --max       Authenticate with Anthropic Pro/Max subscription
  reporter logout anthropic            Remove stored Anthropic tokens
  reporter login github                Authenticate with GitHub via browser OAuth
  reporter logout github               Remove stored GitHub token
  reporter auth login                  Authenticate with Atlassian (Jira) via browser OAuth
  reporter auth logout                 Remove stored Atlassian tokens
  reporter auth status                 Show Atlassian authentication status
  reporter auth slack                  Authenticate with Slack via browser OAuth
  reporter run                         Generate report (stdout)
  reporter run --dry                   List available tools, skip LLM
  reporter run --no-save               Don't save report to disk
  reporter mcp add <name> ...          Add a custom MCP server
  reporter mcp remove <name>           Remove a custom MCP server
  reporter mcp list                    List custom MCP servers
  reporter history                     List past reports
  reporter schedule --every "9am"      Show crontab entry for scheduling
  reporter schedule --every "*/15m"    Every N minutes
  reporter schedule --every "*/6h"     Every N hours

Environment:
  ANTHROPIC_API_KEY    Claude API key (optional if using "reporter login anthropic")
  GITHUB_TOKEN         GitHub token (optional if using "reporter login github")
  SLACK_BOT_TOKEN      Slack bot token (optional if using "reporter auth slack")
  REPORTER_DEBUG       Set to 1 for debug logging`);
}

main().catch((e) => {
  error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
