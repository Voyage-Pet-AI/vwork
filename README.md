# reporter

AI-powered daily work report generator. Connects to GitHub, Jira, and Slack via MCP servers, uses Claude to correlate events across tools, and outputs a Markdown report to stdout.

## How it works

```
reporter (MCP client)
    ├── github-mcp-server
    ├── atlassian-mcp-server
    └── slack-mcp-server
    │
    ▼
Claude API → correlate events → Markdown report → stdout
```

1. Spawns MCP servers for each enabled integration
2. Collects all available tools from each server
3. Runs an agentic loop — Claude calls tools to gather data, then generates the report
4. Report has three sections: **What Happened**, **Decision Trail**, **Needs Attention**
5. Past reports are saved as plain `.md` files and fed back as context for continuity

## Install

```bash
bun install
```

## Setup

```bash
# Create config at ~/.reporter/config.toml
bun src/index.ts init

# Set your API keys
export ANTHROPIC_API_KEY=sk-ant-...
export GITHUB_TOKEN=ghp_...
export SLACK_BOT_TOKEN=xoxb-...  # optional
```

Edit `~/.reporter/config.toml` to enable/disable integrations and set your orgs/channels.

## Usage

```bash
# Generate a report
bun src/index.ts run

# Pipe to file
bun src/index.ts run > report.md

# See what tools are available (no LLM call)
bun src/index.ts run --dry

# Don't save report to ~/.reporter/reports/
bun src/index.ts run --no-save

# List past reports
bun src/index.ts history

# Get a crontab entry for scheduling
bun src/index.ts schedule --every "9am"
bun src/index.ts schedule --every "*/15m"
bun src/index.ts schedule --every "*/6h"
```

## Config

`~/.reporter/config.toml`:

```toml
[llm]
provider = "anthropic"
model = "claude-sonnet-4-5-20250929"
api_key_env = "ANTHROPIC_API_KEY"

[github]
enabled = true
token_env = "GITHUB_TOKEN"
orgs = ["your-org"]

[jira]
enabled = false
url = "https://mcp.atlassian.com/v1/mcp"

[slack]
enabled = false
token_env = "SLACK_BOT_TOKEN"
channels = ["#engineering"]

[report]
lookback_days = 1      # How many days back to fetch activity
output_dir = "~/.reporter/reports"
memory_depth = 5       # Number of past reports to include as context
```

- `lookback_days` — How far back to look when gathering events from GitHub/Jira/Slack. Set to `1` for a daily report, `7` for a weekly summary.
- `memory_depth` — How many previous reports to feed into the prompt as context. This is what powers the **Decision Trail** section — Claude reads your past N reports to connect today's events to earlier decisions and threads.

## Report output

Each report contains:

- **What Happened** — Cross-tool event timeline grouped by theme. Links PRs to Jira tickets to Slack threads.
- **Decision Trail** — What carried forward from previous reports. What got resolved, what's still open.
- **Needs Attention** — Stale PRs, blockers, unanswered questions, failing CI.

## Project structure

```
src/
├── index.ts           # CLI entry point
├── config.ts          # TOML config loader
├── mcp/
│   ├── client.ts      # MCP client manager
│   └── registry.ts    # Server spawn configs
├── llm/
│   ├── provider.ts    # LLM provider interface
│   ├── anthropic.ts   # Claude implementation
│   └── agent.ts       # Agentic tool-use loop
├── report/
│   ├── prompt.ts      # System prompt
│   └── memory.ts      # Past report loader/saver
└── utils/
    └── log.ts         # stderr logger
```

## License

MIT
