# VWork — Design Document

A local CLI that auto-generates daily work reports. It connects to Jira, Slack, and GitHub via MCP servers, uses an LLM to correlate events across tools, and outputs Markdown to stdout.

## Architecture

```
┌─────────────────┐
│    vwork         │  TypeScript CLI (MCP Client)
└────────┬────────┘
         │ spawns MCP servers via stdio
         ├──── github-mcp-server         (GitHub official)
         ├──── atlassian-mcp-server      (Atlassian official, via mcp-remote)
         └──── @modelcontextprotocol/server-slack
         │
         ▼
┌─────────────────┐
│   Claude API     │  Orchestrates tool calls, generates report
│   (BYOK)         │
└────────┬────────┘
         │
         ▼
      stdout (Markdown)
```

**Flow:**

1. CLI reads config, spawns MCP servers as child processes
2. Collects all available tools from each server
3. Sends a structured prompt to Claude with all MCP tools attached
4. Claude makes tool calls — search Jira issues, read Slack messages, list GitHub PRs
5. CLI executes tool calls against MCP servers, returns results to Claude
6. Claude correlates events across tools, generates Markdown report
7. Report printed to stdout

## Report Sections

Each generated report contains three sections:

- **What Happened** — Cross-tool event timeline, grouped by theme. A PR merge is linked to the Jira ticket it closes and the Slack thread that discussed it.
- **Decision Trail** — Connections to previous reports. What was a blocker yesterday, what got resolved, what decisions carried forward.
- **Needs Attention** — Stale PRs, unanswered questions, approaching deadlines, recurring blockers.

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | Best MCP SDK support, Anthropic SDK native |
| Runtime | Bun | Native TS execution, no build step needed, fast |
| MCP SDK | `@modelcontextprotocol/sdk` 1.26 | Official, stable |
| LLM SDK | `@anthropic-ai/sdk` 0.74 | BYOK, start with Claude |
| Config | TOML (`~/.vwork/config.toml`) | Human-readable |
| Memory | Plain `.md` files in `~/.vwork/reports/` | No database |
| Scheduling | System cron / launchd | No reinventing the wheel |

**Production dependencies: 3** — Anthropic SDK, MCP SDK, TOML parser. No build step for dev.

## Project Structure

```
vwork/
├── src/
│   ├── index.ts          # Entry point, CLI arg routing
│   ├── config.ts         # Load/validate TOML config
│   ├── mcp/
│   │   ├── client.ts     # MCP client manager — spawn & connect to servers
│   │   └── registry.ts   # Map server names to spawn commands/args
│   ├── llm/
│   │   ├── provider.ts   # LLM provider interface (BYOK)
│   │   ├── anthropic.ts  # Claude implementation
│   │   └── agent.ts      # Agentic loop: prompt → tool_use → iterate → output
│   ├── report/
│   │   ├── prompt.ts     # System prompt & report generation instructions
│   │   └── memory.ts     # Load past reports for decision trail context
│   └── utils/
│       └── log.ts        # stderr logger (stdout reserved for report)
├── package.json
├── tsconfig.json
└── .vwork.example.toml
```

## Config File

Located at `~/.vwork/config.toml`:

```toml
[llm]
provider = "anthropic"
model = "claude-sonnet-4-5-20250929"
api_key_env = "ANTHROPIC_API_KEY"

[github]
enabled = true
token_env = "GITHUB_TOKEN"
orgs = ["Voyage-Pet-AI"]

[jira]
enabled = true
url = "https://mcp.atlassian.com/v1/mcp"

[slack]
enabled = true
token_env = "SLACK_BOT_TOKEN"
channels = ["#engineering", "#standup"]

[report]
lookback_days = 1
output_dir = "~/.vwork/reports"
memory_depth = 5
```

## CLI Interface

```bash
vwork init                  # Generate config file interactively
vwork run                   # Generate report to stdout
vwork run > report.md       # Pipe to file
vwork run --dry             # Show discovered tools, skip LLM call
vwork history               # List past saved reports
vwork schedule --every "9am"    # Write crontab/launchd entry
vwork schedule --every "*/15m"  # Every 15 minutes
vwork schedule --every "*/6h"   # Every 6 hours
```

## Key Components

### MCP Client Manager (`src/mcp/client.ts`)

Spawns each enabled MCP server as a child process using `StdioClientTransport`:

- **GitHub**: `npx github-mcp-server` with `GITHUB_PERSONAL_ACCESS_TOKEN`
- **Jira**: `npx mcp-remote https://mcp.atlassian.com/v1/mcp` (OAuth)
- **Slack**: `npx @modelcontextprotocol/server-slack` with `SLACK_BOT_TOKEN`

Tools are namespaced per server (`github__list_pull_requests`, `jira__search_issues`). A unified `callTool(name, args)` routes to the correct server.

### Agentic Loop (`src/llm/agent.ts`)

Standard tool-use loop:

1. Send system prompt + user message + all MCP tools to Claude
2. If response contains `tool_use` blocks, execute each via MCP client
3. Append tool results, re-send to Claude
4. Repeat until Claude returns a final text response (the report)
5. Cap at 20 iterations to prevent runaway

### Memory Chain (`src/report/memory.ts`)

- After each run, optionally save the report to `~/.vwork/reports/YYYY-MM-DD.md`
- On next run, load the last N reports (configured by `memory_depth`)
- Injected as context so Claude can build the "Decision Trail" section
- Plain files. Searchable with grep. No database.

### Report Prompt (`src/report/prompt.ts`)

Instructs Claude to:

1. **Gather** — Call MCP tools to fetch recent PRs, commits, Jira issues, Slack messages
2. **Correlate** — Match Jira ticket IDs across PR titles, commit messages, Slack threads
3. **Remember** — Reference injected past reports for continuity
4. **Generate** — Produce the three-section Markdown report

## Implementation Phases

### Phase 1: Skeleton + GitHub

- `vwork init` and `vwork run`
- MCP client connects to GitHub server only
- Agentic loop working end-to-end
- Markdown output to stdout

### Phase 2: Jira + Slack

- Add Jira server (via mcp-remote for OAuth)
- Add Slack server
- Cross-tool event correlation in the prompt

### Phase 3: Memory

- Save reports to `~/.vwork/reports/`
- Load past reports as context
- `vwork history` command
- Decision Trail section

### Phase 4: Scheduling + Polish

- `vwork schedule` writes crontab/launchd entry
- `vwork run --dry` for debugging
- Graceful degradation when a server is unreachable
- BYOK provider interface for future OpenAI support

## Verification

| Phase | Test |
|-------|------|
| 1 | `ANTHROPIC_API_KEY=xxx GITHUB_TOKEN=xxx vwork run` outputs GitHub activity report |
| 2 | Jira ticket IDs in GitHub PRs appear linked in report |
| 3 | Second-day report references decisions from first-day report |
| 4 | `vwork schedule --every "9am"` creates valid crontab entry |
