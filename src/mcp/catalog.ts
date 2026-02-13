export interface CatalogPrompt {
  /** Where to put the value: "args" appends to args array, "env.KEY" sets env var */
  key: string;
  message: string;
  required: boolean;
  placeholder?: string;
}

export interface CatalogEntry {
  name: string;
  label: string;
  description: string;
  builtin?: boolean;
  type?: "stdio";
  command?: string;
  args?: string[];
  prompts?: CatalogPrompt[];
}

export const MCP_CATALOG: CatalogEntry[] = [
  {
    name: "github",
    label: "GitHub",
    description: "Pull requests, commits, issues",
    builtin: true,
  },
  {
    name: "jira",
    label: "Jira",
    description: "Atlassian Jira issue tracking",
    builtin: true,
  },
  {
    name: "slack",
    label: "Slack",
    description: "Channel messages and threads",
    builtin: true,
    prompts: [
      {
        key: "slack.client_id",
        message: "Slack app client ID",
        required: true,
      },
      {
        key: "slack.client_secret_env",
        message: "Client secret env var",
        required: false,
        placeholder: "SLACK_CLIENT_SECRET",
      },
      {
        key: "slack.channels",
        message: "Channels (comma-separated, e.g. #general, #eng)",
        required: false,
      },
    ],
  },
  {
    name: "filesystem",
    label: "Filesystem",
    description: "Browse and read local files",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    prompts: [
      {
        key: "args",
        message: "Path to expose (e.g. /Users/me/projects)",
        required: true,
        placeholder: "/tmp",
      },
    ],
  },
  {
    name: "fetch",
    label: "Fetch",
    description: "Fetch and process web content",
    type: "stdio",
    command: "npx",
    args: ["-y", "@anthropic-ai/mcp-fetch"],
  },
  {
    name: "memory",
    label: "Memory",
    description: "Persistent memory across sessions",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
  },
  {
    name: "brave-search",
    label: "Brave Search",
    description: "Web search via Brave API",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    prompts: [
      {
        key: "env.BRAVE_API_KEY",
        message: "Brave API key",
        required: true,
      },
    ],
  },
  {
    name: "postgres",
    label: "PostgreSQL",
    description: "Query PostgreSQL databases",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    prompts: [
      {
        key: "args",
        message: "Connection string (e.g. postgresql://user:pass@localhost/db)",
        required: true,
      },
    ],
  },
  {
    name: "sentry",
    label: "Sentry",
    description: "Error and performance monitoring",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sentry"],
    prompts: [
      {
        key: "env.SENTRY_AUTH_TOKEN",
        message: "Sentry auth token",
        required: true,
      },
    ],
  },
  {
    name: "linear",
    label: "Linear",
    description: "Issue tracking and project management",
    type: "stdio",
    command: "npx",
    args: ["-y", "mcp-server-linear"],
    prompts: [
      {
        key: "env.LINEAR_API_KEY",
        message: "Linear API key",
        required: true,
      },
    ],
  },
  {
    name: "notion",
    label: "Notion",
    description: "Docs and knowledge base",
    type: "stdio",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    prompts: [
      {
        key: "env.OPENAPI_MCP_HEADERS",
        message: 'Notion headers JSON (e.g. {"Authorization":"Bearer ntn_...","Notion-Version":"2022-06-28"})',
        required: true,
      },
    ],
  },
];
