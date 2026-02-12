import { readFileSync, writeFileSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { getReporterDir } from "../config.js";

const TOKENS_FILE = () => join(getReporterDir(), "tokens.json");

export interface SlackTokenData {
  access_token: string;
  token_type: string;
  scope: string;
  team: { id: string; name: string };
  obtained_at: string;
}

interface TokenStore {
  slack?: SlackTokenData;
}

export function loadTokens(): TokenStore {
  const path = TOKENS_FILE();
  if (!existsSync(path)) return {};

  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as TokenStore;
  } catch {
    return {};
  }
}

export function saveTokens(store: TokenStore): void {
  const path = TOKENS_FILE();
  writeFileSync(path, JSON.stringify(store, null, 2));
  chmodSync(path, 0o600);
}

export function getSlackToken(): string | undefined {
  const store = loadTokens();
  return store.slack?.access_token;
}
