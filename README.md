# reporter

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
# Create config at ~/reporter/config.toml
bun src/index.ts init

# Authenticate with GitHub (opens browser for OAuth)
bun src/index.ts login github

# Set your Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-...

# Optional: set tokens manually instead of OAuth
# export GITHUB_TOKEN=ghp_...
# export SLACK_BOT_TOKEN=xoxb-...
```

Edit `~/reporter/config.toml` to enable/disable integrations and set your orgs/channels.

## Usage

```bash
# Authenticate with GitHub (browser-based OAuth)
bun src/index.ts login github

# Remove stored GitHub token
bun src/index.ts logout github

# Generate a report
bun src/index.ts run

# Pipe to file
bun src/index.ts run > report.md

# See what tools are available (no LLM call)
bun src/index.ts run --dry

# Don't save report to ~/reporter/reports/
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
├── auth/
│   └── github.ts      # GitHub OAuth device flow
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
