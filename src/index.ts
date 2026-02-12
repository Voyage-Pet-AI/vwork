#!/usr/bin/env bun
import { loadConfig, initConfig, configExists, getConfigPath } from "./config.js";
import { getEnabledServers } from "./mcp/registry.js";
import { MCPClientManager } from "./mcp/client.js";
import { AnthropicProvider } from "./llm/anthropic.js";
import { runAgent } from "./llm/agent.js";
import { buildSystemPrompt, buildUserMessage } from "./report/prompt.js";
import { loadPastReports, saveReport, listReports } from "./report/memory.js";
import { log, error } from "./utils/log.js";

const args = process.argv.slice(2);
const command = args[0] ?? "help";

async function main() {
  switch (command) {
    case "init":
      return cmdInit();
    case "run":
      return cmdRun();
    case "history":
      return cmdHistory();
    case "schedule":
      return cmdSchedule();
    default:
      return cmdHelp();
  }
}

function cmdInit() {
  console.log(initConfig());
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
  if (servers.length === 0) {
    error("No integrations enabled. Edit your config: " + getConfigPath());
    process.exit(1);
  }

  const mcpClient = new MCPClientManager();

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
    const systemPrompt = buildSystemPrompt(config, pastReports);
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
  reporter init                    Create config at ~/.reporter/config.toml
  reporter run                     Generate report (stdout)
  reporter run --dry               List available tools, skip LLM
  reporter run --no-save           Don't save report to disk
  reporter history                 List past reports
  reporter schedule --every "9am"  Show crontab entry for scheduling
  reporter schedule --every "*/15m" Every N minutes
  reporter schedule --every "*/6h"  Every N hours

Environment:
  ANTHROPIC_API_KEY    Claude API key
  GITHUB_TOKEN         GitHub personal access token
  SLACK_BOT_TOKEN      Slack bot token
  REPORTER_DEBUG       Set to 1 for debug logging`);
}

main().catch((e) => {
  error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
