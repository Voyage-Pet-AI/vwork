# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Reporter is "Claude Code for everyone else" — an AI-powered CLI for PMs, managers, and anyone who works with computers but doesn't write code. It connects to the tools people already use (GitHub, Jira, Slack, Linear, Notion, etc.) via MCP servers, then uses Claude's agentic tool-use loop to gather data, correlate events across tools, and produce a structured Markdown report to stdout. The long-term vision is a general-purpose AI assistant for non-developers, starting with work reporting as the entry point.

## Commands

```bash
bun install              # Install dependencies
bun src/index.ts run     # Generate a report
bun src/index.ts run --dry   # List available MCP tools without calling LLM
bun run build            # Bundle to dist/index.js (bun build src/index.ts --outdir dist --target bun)
bash scripts/publish.sh [patch|minor|major|x.y.z]  # Bump version, tag, push (triggers release CI)
```

There are no tests or linters configured.

## Architecture

**Runtime:** Bun (native TypeScript execution, no compile step for dev). Production deps: Anthropic SDK, MCP SDK, smol-toml, picocolors, sqlite-vec.

**Core flow** (`src/index.ts` → `cmdRun`):
1. Load TOML config from `~/reporter/config.toml`
2. `src/mcp/registry.ts` maps enabled integrations to MCP server spawn configs
3. `src/mcp/client.ts` (`MCPClientManager`) spawns each server as a child process, namespaces tools as `{server}__{tool}` (e.g., `github__search_issues`), and routes `callTool()` to the correct server
4. `src/report/prompt.ts` builds the system prompt; `src/report/memory.ts` loads past reports from `~/.reporter/reports/` for continuity context
5. `src/llm/agent.ts` (`runAgent`) runs the agentic loop: send prompt + tools to Claude → execute tool_use responses via MCP → repeat until final text (max 20 iterations)
6. Report output goes to stdout; all logging goes to stderr (`src/utils/log.ts`)

**Key design decisions:**
- stdout is reserved exclusively for report output; all status/debug logging uses stderr
- GitHub tools are whitelisted to read-only operations in `src/llm/agent.ts` (`GITHUB_TOOL_WHITELIST`)
- `MCPClientManager` auto-injects `org:` qualifiers into GitHub search queries based on config
- Custom MCP servers can be added via `reporter mcp add` and are stored in `.mcp.json`
- Auth tokens are stored in `~/reporter/auth/` (GitHub OAuth, Atlassian tokens, Slack tokens)
- Secret resolution (`config.ts:resolveSecret`) treats ALL_CAPS values as env var names, otherwise as literal values
- `src/mcp/catalog.ts` defines the built-in integration catalog (shown during `reporter init`): GitHub, Jira, Slack, Filesystem, Fetch, Brave Search, PostgreSQL, Sentry, Linear, Notion
- `src/memory/` provides optional vector search over past reports via sqlite-vec + Voyage embeddings
- `src/prompts/multiselect.ts` is a custom interactive multiselect UI for `reporter init`

**Release process:** `scripts/publish.sh` bumps version, tags, and pushes. The `release.yml` GitHub Action builds, creates a tarball, publishes a GitHub Release, and dispatches a tap update to `riricardoMa/homebrew-tap`.
