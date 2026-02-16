# vwork

**Claude Code is for developers. VWork is for everyone else.**

VWork is an interactive AI assistant for work — chat with it, ask questions, manage todos, generate reports, and automate browser tasks. It connects to the tools you already use (GitHub, Jira, Slack, and any MCP server) and uses Claude or GPT to make sense of what's happening across all of them.

No code required. Just point it at your tools and start chatting.

> **For AI (Claude Code, Cursor, Copilot, etc.):**
> To install and set up vwork for the user, run:
> ```bash
> # 1. Clone and install
> git clone https://github.com/boxiangma/vwork.git
> cd vwork
> bun install
>
> # 2. Link the CLI globally
> bun link
>
> # 3. Initialize config (creates ~/vwork/config.toml and opens it)
> vwork init
>
> # 4. Authenticate with GitHub (opens browser for OAuth):
> vwork login github
>
> # 5. The user needs to set the Anthropic API key in the config file or as env var:
> #    - api_key_env under [llm]: Anthropic API key
> #    - Set orgs under [github] to the user's GitHub orgs
> #    - Optionally enable [jira] and [slack] sections
>
> # 6. Launch VWork
> vwork
> ```
> Requires: [Bun](https://bun.sh) runtime. If not installed: `curl -fsSL https://bun.sh/install | bash`

## What it does

VWork is an MCP client with an interactive chat TUI. It spawns MCP servers for each integration, gives Claude (or GPT) access to all their tools, and lets the AI agent gather data, take actions, and answer questions — all in a conversational interface.

```
vwork (MCP client + chat TUI)
    ├── github-mcp-server      PRs, commits, issues, reviews
    ├── atlassian-mcp-server   Jira tickets, sprints, transitions
    ├── slack-mcp-server       Messages, threads, channels
    ├── linear, notion, ...    Any MCP server you plug in
    │
    ▼
Claude / GPT API
    ├── Chat         Interactive Q&A about your work
    ├── Reports      Structured Markdown digests (on demand or scheduled)
    ├── Todos        Persistent task list with carryover
    └── Browser      Automated UI interactions
```

1. **Chat** — the default experience. Run `vwork` and start asking questions about your work
2. **Reports** — ask naturally ("what happened today?") or run `vwork run` for a batch report to stdout
3. **Todos** — persistent, day-keyed task list that carries over across sessions
4. **Browser automation** — the AI can navigate websites and interact with UIs on your behalf
5. **Memory** — past reports are saved and fed back as context, so the AI tracks ongoing threads

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
vwork init

# Or set up step by step:
vwork login anthropic       # Authenticate with Anthropic (or set ANTHROPIC_API_KEY)
vwork login openai          # Authenticate with OpenAI (ChatGPT Pro/Plus OAuth)
vwork login github          # Authenticate with GitHub via browser OAuth
vwork auth login            # Authenticate with Atlassian (Jira) via browser OAuth
vwork auth slack            # Authenticate with Slack via bot token
```

Edit `~/vwork/config.toml` to enable/disable integrations and set your orgs/channels.

Run `vwork` to launch the interactive chat, or `vwork run` to generate a batch report to stdout.

## Chat

The default command (`vwork` or `vwork chat`) launches an interactive TUI with streaming responses. Ask questions about your work, generate reports, manage todos, or just chat.

### Slash commands

Type `/` to see the command palette:

| Command | Description |
|---------|-------------|
| `/report` | Manage report schedules (list / add / remove) |
| `/todo` | View and manage your todo list |
| `/connect` | Switch LLM provider (Anthropic / OpenAI) |
| `/model` | Change model (Claude Opus, Sonnet, Haiku / GPT-5.x) |
| `/auth` | Manage LLM authentication |
| `/copy` | Copy last response to clipboard |
| `/clear` | Clear conversation history |
| `/help` | Show help |
| `/exit` | Quit (`/quit`, `/q` also work) |

### File mentions

Type `@` followed by a filename to attach file contents to your message. VWork searches your filesystem and shows a fuzzy-matched file picker — select a file and its contents are included as context.

### Report intent detection

Just ask naturally — "what happened today?", "give me a standup update", "weekly summary" — and VWork auto-triggers report generation with the right lookback window.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+T` | Toggle todo panel |
| `Ctrl+J` | Insert newline |
| `Ctrl+C` | Abort current response (press twice to exit) |
| `Esc` | Abort current response |
| `Up/Down` | Command history |

## Todo list

VWork includes a persistent, day-keyed todo system that integrates directly into the chat experience.

- **Manage via chat** — ask the AI to add, complete, or prioritize todos naturally, or use `/todo`
- **Toggle panel** — press `Ctrl+T` to show/hide the todo sidebar
- **Priorities** — high, medium, low
- **Statuses** — pending, in_progress, completed, cancelled
- **Carryover** — unfinished todos from yesterday are automatically carried forward
- **Notebook** — todos are projected to daily Markdown files in `~/vwork/notebook/` (e.g., `2026-02-15.md`)

## Reports

### Batch mode

```bash
# Generate a report to stdout
vwork run

# Pipe to file
vwork run > report.md

# See available tools without calling the LLM
vwork run --dry

# Don't save report to disk
vwork run --no-save
```

### In chat

Ask naturally ("what happened today?", "weekly summary") or use `/report` to manage schedules.

### Scheduling

Use `/report add` in chat to create cron-based recurring reports with desktop notifications. Schedules are managed interactively:

- `/report` — list active schedules
- `/report add` — create a new schedule
- `/report remove <name>` — remove a schedule

Under the hood, schedules use crontab entries that run `vwork schedule run <name>`.

### Report structure

Each report contains three sections:

- **What Happened** — cross-tool event timeline grouped by theme. Links PRs to Jira tickets to Slack threads.
- **Decision Trail** — what carried forward from previous reports. What got resolved, what's still open.
- **Needs Attention** — stale PRs, blockers, unanswered questions, failing CI.

Past reports are saved to `~/.vwork/reports/` and fed back as context for continuity.

## Browser automation

VWork includes a browser-use subagent (`vwork__computer`) that can navigate websites and interact with UIs on your behalf. When the AI determines it needs to interact with a web page, it launches a browser session.

- **Session approval** — enabled by default; VWork asks for your OK before starting a browser session
- **Domain policies** — configure `allow_domains` and `block_domains` to control which sites the AI can visit
- **Audit trail** — all browser actions are logged
- **Triggered naturally** — just describe what you need ("check the deploy status on Vercel", "update the sprint board") and the AI decides when to use the browser

## Extend with any MCP server

VWork isn't limited to GitHub, Jira, and Slack. Add any MCP server — the AI gets access to all its tools automatically.

```bash
# Add a custom MCP server
vwork mcp add my-server --transport stdio -- npx my-mcp-server
vwork mcp add my-api --transport http https://my-mcp.example.com

# Built-in catalog (offered during `vwork init`):
# Filesystem, Fetch, Brave Search, PostgreSQL, Sentry, Linear, Notion, and more

# List configured servers
vwork mcp list
```

## Memory

VWork remembers. Past reports are saved as plain `.md` files and fed back as context, so the AI can track ongoing threads, connect today's work to last week's decisions, and flag things that fell through the cracks.

For deeper memory, enable vector search:

```bash
# Index past reports into vector DB
vwork memory index

# Store a note for future context
vwork memory add "Q4 planning starts next week, focus on auth migration"

# Search your memory
vwork memory search "auth migration status"
```

## Config

`~/vwork/config.toml`:

```toml
[llm]
provider = "anthropic"                   # "anthropic" or "openai"
model = "claude-sonnet-4-5-20250929"
# api_key_env = "ANTHROPIC_API_KEY"

[github]
enabled = true
orgs = ["your-org"]

[jira]
enabled = false
url = "https://mcp.atlassian.com/v1/mcp"

[slack]
enabled = false
channels = ["#engineering"]

[report]
lookback_days = 1        # 1 = daily, 7 = weekly
output_dir = "~/vwork/reports"
memory_depth = 5         # Past reports included as context

[chat]
report_postprocess_enabled = false    # Second-pass summary after report
report_inbox_replay_limit = 20       # Scheduled-run messages replayed on chat start

[todo]
enabled = true
notebook_dir = "~/vwork/notebook"    # Daily markdown files (YYYY-MM-DD.md)
default_mode = "minimal"             # "minimal" or "full" (todo panel visibility)
carryover_prompt = true              # Carry over yesterday's open todos

[computer]
enabled = true
require_session_approval = true
max_steps = 150
max_duration_sec = 900
allow_domains = []
block_domains = []

# [memory]
# enabled = true
# embedding_model = "voyage-3.5-lite"
# api_key_env = "VOYAGE_API_KEY"
# db_path = "~/vwork/memory.db"
```

## Project structure

```
src/
├── index.ts              # CLI entry point
├── config.ts             # TOML config loader
├── auth/
│   ├── anthropic.ts      # Anthropic OAuth
│   ├── openai.ts         # OpenAI OAuth
│   ├── atlassian.ts      # Atlassian OAuth
│   ├── github.ts         # GitHub OAuth device flow
│   ├── slack.ts          # Slack bot token
│   ├── callback.ts       # OAuth callback server
│   └── tokens.ts         # Token storage
├── tui/
│   ├── app.tsx           # TUI entry point (Ink)
│   ├── input.tsx         # Chat input with slash commands
│   ├── messages.tsx      # Message rendering
│   ├── todo-panel.tsx    # Todo sidebar panel
│   ├── header.tsx        # Status bar
│   ├── multiline-input.tsx
│   ├── markdown.ts       # Markdown rendering
│   ├── file-mentions.ts  # @file resolution
│   ├── use-file-search.ts
│   └── tool-summary.ts   # Tool call display
├── chat/
│   ├── session.ts        # Chat session manager
│   ├── prompt.ts         # Chat system prompt builder
│   ├── report-intent.ts  # Auto-detect report requests
│   └── tools/            # Chat-specific tool implementations
│       ├── computer.ts   # Browser automation trigger
│       ├── todo.ts       # Todo management
│       ├── report-schedule.ts
│       ├── bash.ts       # Shell command execution
│       ├── file.ts       # File read/write
│       ├── glob.ts       # File search
│       ├── grep.ts       # Content search
│       └── webfetch.ts   # URL fetching
├── llm/
│   ├── provider.ts       # LLM provider interface
│   ├── anthropic.ts      # Claude implementation
│   ├── openai.ts         # OpenAI/GPT implementation
│   └── agent.ts          # Agentic tool-use loop
├── report/
│   ├── runner.ts         # Report subagent orchestrator
│   ├── prompt.ts         # Report system prompt builder
│   └── memory.ts         # Past report loader/saver
├── todo/
│   ├── manager.ts        # Todo CRUD operations
│   ├── store.ts          # JSON persistence
│   ├── notebook.ts       # Markdown projection
│   └── types.ts          # Todo type definitions
├── schedule/
│   ├── store.ts          # Schedule persistence
│   ├── crontab.ts        # Crontab management
│   └── notify.ts         # Desktop notifications
├── computer/
│   ├── session.ts        # Browser session manager
│   ├── policy.ts         # Domain allow/block policies
│   ├── audit.ts          # Action audit trail
│   └── types.ts          # Computer type definitions
├── mcp/
│   ├── client.ts         # MCP client manager
│   ├── registry.ts       # Server spawn configs
│   ├── catalog.ts        # Integration catalog
│   └── config.ts         # .mcp.json config
├── memory/
│   ├── vectordb.ts       # SQLite vector DB
│   └── embeddings.ts     # Voyage embeddings client
├── prompts/
│   └── multiselect.ts    # Interactive multiselect UI
└── utils/
    ├── log.ts            # stderr logger
    └── readline.ts       # Line input helper
```

## License

MIT
