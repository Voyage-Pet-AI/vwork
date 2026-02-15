import { isIP } from "net";
import type { ComputerPolicy } from "./types.js";

export interface PolicyCheckResult {
  ok: boolean;
  code?: string;
  message?: string;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, "");
}

function domainMatches(hostname: string, pattern: string): boolean {
  const host = normalizeDomain(hostname);
  const p = normalizeDomain(pattern);
  if (!p) return false;
  if (p.startsWith("*.")) {
    const suffix = p.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return host === p;
}

function inCidrV4(ip: string, base: string, mask: number): boolean {
  const toInt = (v: string): number =>
    v.split(".").map(Number).reduce((acc, n) => (acc << 8) + n, 0) >>> 0;
  const bits = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
  return (toInt(ip) & bits) === (toInt(base) & bits);
}

function isPrivateIpv4(ip: string): boolean {
  return (
    inCidrV4(ip, "10.0.0.0", 8) ||
    inCidrV4(ip, "127.0.0.0", 8) ||
    inCidrV4(ip, "169.254.0.0", 16) ||
    inCidrV4(ip, "172.16.0.0", 12) ||
    inCidrV4(ip, "192.168.0.0", 16) ||
    inCidrV4(ip, "0.0.0.0", 8)
  );
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized === "::"
  );
}

function isBlockedHost(hostname: string): boolean {
  const host = normalizeDomain(hostname);
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local")) return true;

  const ipType = isIP(host);
  if (ipType === 4) return isPrivateIpv4(host);
  if (ipType === 6) return isPrivateIpv6(host);
  return false;
}

export function validateComputerUrlPolicy(
  urlString: string,
  policy: ComputerPolicy
): PolicyCheckResult {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { ok: false, code: "INVALID_URL", message: `Invalid URL: ${urlString}` };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return {
      ok: false,
      code: "UNSUPPORTED_PROTOCOL",
      message: "Only HTTP/HTTPS URLs are supported",
    };
  }

  const host = parsed.hostname;
  if (isBlockedHost(host)) {
    return {
      ok: false,
      code: "POLICY_BLOCKED_PRIVATE_NETWORK",
      message: `Blocked private/local target: ${host}`,
    };
  }

  const allow = policy.allowDomains ?? [];
  const block = policy.blockDomains ?? [];

  if (block.some((p) => domainMatches(host, p))) {
    return {
      ok: false,
      code: "POLICY_BLOCKED_DOMAIN",
      message: `Domain blocked by policy: ${host}`,
    };
  }

  if (allow.length > 0 && !allow.some((p) => domainMatches(host, p))) {
    return {
      ok: false,
      code: "POLICY_NOT_ALLOWLISTED",
      message: `Domain not in allowlist: ${host}`,
    };
  }

  return { ok: true };
}

