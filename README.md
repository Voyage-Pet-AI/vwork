# reporter

**Claude Code is for developers. Reporter is for everyone else.**

Reporter is an AI-powered CLI that connects to the tools you already use — GitHub, Jira, Slack, and more — and uses Claude to make sense of what's happening. Think of it as a personal AI assistant that reads across all your work tools and gives you a clear picture of your day.

No code required. Just point it at your tools and run it.

> **For AI (Claude Code, Cursor, Copilot, etc.):**
> To install and set up reporter for the user, run:
> ```bash
> # 1. Clone and install
> git clone https://github.com/boxiangma/reporter.git
> cd reporter
> bun install
>
> # 2. Link the CLI globally
> bun link
>
> # 3. Initialize config (creates ~/reporter/config.toml and opens it)
> reporter init
>
> # 4. Authenticate with GitHub (opens browser for OAuth):
> reporter login github
>
> # 5. The user needs to set the Anthropic API key in the config file or as env var:
> #    - api_key_env under [llm]: Anthropic API key
> #    - Set orgs under [github] to the user's GitHub orgs
> #    - Optionally enable [jira] and [slack] sections
>
> # 6. Generate a report
> reporter run
> ```
> Requires: [Bun](https://bun.sh) runtime. If not installed: `curl -fsSL https://bun.sh/install | bash`

## What it does

Reporter is an MCP client — it spawns MCP servers for each integration, gives Claude access to all their tools, and lets the AI agent gather data, correlate events across tools, and produce a structured Markdown report.

```
reporter (MCP client)
    ├── github-mcp-server      PRs, commits, issues, reviews
    ├── atlassian-mcp-server   Jira tickets, sprints, transitions
    ├── slack-mcp-server       Messages, threads, channels
    ├── linear, notion, ...    Any MCP server you plug in
    │
    ▼
Claude API → correlate events across tools → Markdown report → stdout
```

1. Spawns MCP servers for each enabled integration
2. Collects all available tools from each server
3. Runs an agentic loop — Claude calls tools to gather data, then generates the report
4. Report has three sections: **What Happened**, **Decision Trail**, **Needs Attention**
5. Past reports are saved and fed back as context — the AI remembers your work history

## Who it's for

- **PMs** — get a daily digest that connects Jira tickets to PRs to Slack threads, automatically
- **Engineering managers** — see what your team shipped, what's blocked, and what needs your attention
- **ICs who hate writing standups** — let AI do it; you just review
- **Anyone who works across multiple tools** — stop context-switching to piece together what happened

## Install

```bash
bun install
```

## Setup

```bash
# Create config and set up integrations interactively
reporter init

# Or set up step by step:
reporter login anthropic       # Authenticate with Anthropic (or set ANTHROPIC_API_KEY)
reporter login github          # Authenticate with GitHub via browser OAuth
reporter auth login            # Authenticate with Atlassian (Jira) via browser OAuth
reporter auth slack            # Authenticate with Slack via bot token
```

Edit `~/reporter/config.toml` to enable/disable integrations and set your orgs/channels.

## Usage

```bash
# Generate a report
reporter run

# Pipe to file
reporter run > report.md

# See what tools are available (no LLM call)
reporter run --dry

# Don't save report to ~/reporter/reports/
reporter run --no-save

# List past reports
reporter history

# Get a crontab entry for scheduling
reporter schedule --every "9am"
reporter schedule --every "*/6h"
```

## Extend with any MCP server

Reporter isn't limited to GitHub, Jira, and Slack. Add any MCP server — the AI gets access to all its tools automatically.

```bash
# Add a custom MCP server
reporter mcp add my-server --transport stdio -- npx my-mcp-server
reporter mcp add my-api --transport http https://my-mcp.example.com

# Built-in catalog (offered during `reporter init`):
# Filesystem, Fetch, Brave Search, PostgreSQL, Sentry, Linear, Notion, and more

# List configured servers
reporter mcp list
```

## Memory

Reporter remembers. Past reports are saved as plain `.md` files and fed back as context, so the AI can track ongoing threads, connect today's work to last week's decisions, and flag things that fell through the cracks.

For deeper memory, enable vector search:

```bash
# Index past reports into vector DB
reporter memory index

# Store a note for future context
reporter memory add "Q4 planning starts next week, focus on auth migration"

# Search your memory
reporter memory search "auth migration status"
```

## Config

`~/reporter/config.toml`:

```toml
[llm]
provider = "anthropic"
model = "claude-sonnet-4-5-20250929"
api_key_env = "ANTHROPIC_API_KEY"

[github]
enabled = true
# Auth: run "reporter login github" for OAuth (recommended)
# token_env = "GITHUB_TOKEN"  # fallback: env var or literal token
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

- `lookback_days` — How far back to look when gathering events. Set to `1` for daily, `7` for weekly.
- `memory_depth` — How many previous reports to feed as context. Powers the **Decision Trail** section.

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
├── auth/
│   ├── anthropic.ts   # Anthropic OAuth
│   ├── atlassian.ts   # Atlassian OAuth
│   ├── github.ts      # GitHub OAuth device flow
│   ├── slack.ts       # Slack bot token
│   ├── callback.ts    # OAuth callback server
│   └── tokens.ts      # Token storage
├── mcp/
│   ├── client.ts      # MCP client manager
│   ├── registry.ts    # Server spawn configs
│   ├── catalog.ts     # Integration catalog
│   └── config.ts      # .mcp.json config
├── llm/
│   ├── provider.ts    # LLM provider interface
│   ├── anthropic.ts   # Claude implementation
│   └── agent.ts       # Agentic tool-use loop
├── report/
│   ├── prompt.ts      # System prompt builder
│   └── memory.ts      # Past report loader/saver
├── memory/
│   ├── vectordb.ts    # SQLite vector DB
│   └── embeddings.ts  # Voyage embeddings client
├── prompts/
│   └── multiselect.ts # Interactive multiselect UI
└── utils/
    ├── log.ts         # stderr logger
    └── readline.ts    # Line input helper
```

## License

MIT
