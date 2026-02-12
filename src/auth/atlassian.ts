import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from "fs";
import { join } from "path";
import { getReporterDir } from "../config.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const CALLBACK_PORT = 32191;
const AUTH_DIR = () => join(getReporterDir(), "auth");
const TOKENS_FILE = () => join(AUTH_DIR(), "atlassian-tokens.json");
const CLIENT_FILE = () => join(AUTH_DIR(), "atlassian-client.json");
const VERIFIER_FILE = () => join(AUTH_DIR(), "atlassian-verifier.txt");

function ensureAuthDir(): void {
  mkdirSync(AUTH_DIR(), { recursive: true });
}

export class AtlassianOAuthProvider implements OAuthClientProvider {
  get redirectUrl(): string {
    return `http://localhost:${CALLBACK_PORT}/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "reporter-cli",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const path = CLIENT_FILE();
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      return undefined;
    }
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    ensureAuthDir();
    writeFileSync(CLIENT_FILE(), JSON.stringify(info, null, 2));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const path = TOKENS_FILE();
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      return undefined;
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    ensureAuthDir();
    const path = TOKENS_FILE();
    writeFileSync(path, JSON.stringify(tokens, null, 2));
    chmodSync(path, 0o600);
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    const opener =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    Bun.spawn([opener, url.toString()], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  }

  async saveCodeVerifier(v: string): Promise<void> {
    ensureAuthDir();
    writeFileSync(VERIFIER_FILE(), v);
  }

  async codeVerifier(): Promise<string> {
    return readFileSync(VERIFIER_FILE(), "utf-8");
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier"
  ): Promise<void> {
    const remove = (path: string) => {
      if (existsSync(path)) unlinkSync(path);
    };

    switch (scope) {
      case "all":
        remove(TOKENS_FILE());
        remove(CLIENT_FILE());
        remove(VERIFIER_FILE());
        break;
      case "client":
        remove(CLIENT_FILE());
        break;
      case "tokens":
        remove(TOKENS_FILE());
        break;
      case "verifier":
        remove(VERIFIER_FILE());
        break;
    }
  }
}

/** Check if Atlassian OAuth tokens exist on disk. */
export function hasAtlassianAuth(): boolean {
  return existsSync(TOKENS_FILE());
}

/** Read stored token info (for status display). */
export function getAtlassianTokenInfo(): {
  hasTokens: boolean;
  expiresIn?: number;
  scope?: string;
} {
  const path = TOKENS_FILE();
  if (!existsSync(path)) return { hasTokens: false };
  try {
    const tokens: OAuthTokens = JSON.parse(readFileSync(path, "utf-8"));
    return {
      hasTokens: true,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
    };
  } catch {
    return { hasTokens: false };
  }
}

/** Delete all Atlassian auth files. */
export function clearAtlassianAuth(): void {
  const remove = (path: string) => {
    if (existsSync(path)) unlinkSync(path);
  };
  remove(TOKENS_FILE());
  remove(CLIENT_FILE());
  remove(VERIFIER_FILE());
}
