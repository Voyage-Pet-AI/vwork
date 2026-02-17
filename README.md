# vwork

**Claude Code is for developers. VWork is for everyone else.**

VWork is an AI assistant for work. Chat with it, ask questions, manage todos, generate reports, and automate browser tasks. It connects to the tools you already use (GitHub, Jira, Slack, Linear, Notion, and more) and uses Claude or GPT to make sense of what's happening across all of them.

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

## Who it's for

- **PMs** — get a daily digest that connects Jira tickets to PRs to Slack threads, automatically
- **Engineering managers** — see what your team shipped, what's blocked, and what needs attention
- **ICs who hate writing standups** — let AI do it; you just review
- **Anyone who works across multiple tools** — stop context-switching to piece together what happened

## Install

```bash
# via Homebrew
brew install riricardoMa/tap/vwork

# via npm (requires Bun runtime)
npm install -g vwork

# from source
git clone https://github.com/boxiangma/vwork.git
cd vwork && bun install && bun link
```

## Getting started

```bash
# Interactive setup — picks integrations, authenticates, creates config
vwork init

# Or set up step by step:
vwork login anthropic       # Authenticate with Anthropic (or set ANTHROPIC_API_KEY)
vwork login openai          # Authenticate with OpenAI
vwork login github          # Authenticate with GitHub
vwork auth login            # Authenticate with Atlassian (Jira)
vwork auth slack            # Authenticate with Slack

# Launch VWork
vwork
```

## Two ways to use it

### Terminal (TUI)

```bash
vwork            # Launch interactive chat in your terminal
```

Full-featured terminal interface with streaming responses, slash commands, file mentions, and a todo sidebar.

### Web UI

```bash
vwork serve      # Start the web server
```

Open `http://localhost:3141` for a browser-based chat interface. Same capabilities — streaming responses, tool calls, reports, todos, and settings — in a modern web UI.

For development with hot reload:
```bash
bun run dev:server    # Backend on :3141
bun run dev:web       # Frontend on :5173 (proxies API to backend)
```

## Features

### Chat

The core experience. Ask questions about your work and get answers that pull from all your connected tools.

```
> what PRs need my review?
> summarize what the team shipped this week
> what Jira tickets are blocked?
> check the #engineering channel for anything I missed
```

**Slash commands** — type `/` to see the palette:

| Command | What it does |
|---------|-------------|
| `/report` | Manage report schedules |
| `/todo` | View and manage todos |
| `/connect` | Switch LLM provider |
| `/model` | Change model |
| `/copy` | Copy last response to clipboard |
| `/clear` | Clear conversation |

**File mentions** — type `@` followed by a filename to attach file contents to your message.

### Reports

Ask naturally — "what happened today?", "weekly summary", "standup update" — and VWork generates a structured report.

```bash
vwork run              # Generate a report to stdout
vwork run > report.md  # Pipe to file
```

Reports include:
- **What Happened** — cross-tool timeline linking PRs, tickets, and messages
- **Decision Trail** — what got resolved and what's still open
- **Needs Attention** — stale PRs, blockers, unanswered questions

Schedule recurring reports with `/report add` — they run on cron and send desktop notifications.

### Todos

Persistent task list that integrates into chat. Ask the AI to manage your todos naturally, or use `/todo`.

- Priorities (high / medium / low) and statuses (pending / in progress / completed)
- Yesterday's unfinished todos carry over automatically
- Projected to daily Markdown files in `~/vwork/notebook/`

### Browser automation

VWork can navigate websites and interact with UIs on your behalf. Just describe what you need:

```
> check the deploy status on Vercel
> update the sprint board
```

Domain policies let you control which sites it can visit. Session approval is on by default.

### Memory

Past reports are saved and fed back as context, so VWork tracks ongoing threads and flags things that fell through the cracks.

```bash
vwork memory add "Q4 planning starts next week"
vwork memory search "auth migration status"
```

## Integrations

Built-in support for:

| Integration | What it provides |
|-------------|-----------------|
| **GitHub** | PRs, commits, issues, reviews, code search |
| **Jira** | Tickets, sprints, transitions, comments |
| **Slack** | Messages, threads, channels |
| **Linear** | Issues, projects, cycles |
| **Notion** | Pages, databases |
| **Sentry** | Errors, events |

Plus Filesystem, Fetch, Brave Search, PostgreSQL — or add any MCP server:

```bash
vwork mcp add my-server --transport stdio -- npx my-mcp-server
vwork mcp add my-api --transport http https://my-mcp.example.com
vwork mcp list
```

## Config

`~/vwork/config.toml` — created by `vwork init`. Key settings:

```toml
[llm]
provider = "anthropic"              # "anthropic" or "openai"
model = "claude-sonnet-4-5-20250929"

[github]
enabled = true
orgs = ["your-org"]

[jira]
enabled = false

[slack]
enabled = false
channels = ["#engineering"]

[report]
lookback_days = 1       # 1 = daily, 7 = weekly

[todo]
enabled = true
```

## License

MIT
