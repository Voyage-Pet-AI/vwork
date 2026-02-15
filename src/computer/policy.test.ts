import { describe, expect, test } from "bun:test";
import { validateComputerUrlPolicy } from "./policy.js";

const openPolicy = { allowDomains: [], blockDomains: [] };

describe("computer URL policy", () => {
  test("blocks non-http protocols", () => {
    const res = validateComputerUrlPolicy("file:///etc/passwd", openPolicy);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("UNSUPPORTED_PROTOCOL");
  });

  test("blocks localhost and private network targets", () => {
    expect(validateComputerUrlPolicy("http://localhost:3000", openPolicy).ok).toBe(false);
    expect(validateComputerUrlPolicy("http://127.0.0.1", openPolicy).ok).toBe(false);
    expect(validateComputerUrlPolicy("http://10.0.0.5", openPolicy).ok).toBe(false);
    expect(validateComputerUrlPolicy("http://192.168.1.9", openPolicy).ok).toBe(false);
  });

  test("supports blocklist and allowlist domain controls", () => {
    const blocked = validateComputerUrlPolicy("https://example.com", {
      allowDomains: [],
      blockDomains: ["example.com"],
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe("POLICY_BLOCKED_DOMAIN");

    const notAllowed = validateComputerUrlPolicy("https://example.com", {
      allowDomains: ["docs.example.com"],
      blockDomains: [],
    });
    expect(notAllowed.ok).toBe(false);
    expect(notAllowed.code).toBe("POLICY_NOT_ALLOWLISTED");

    const allowed = validateComputerUrlPolicy("https://docs.example.com", {
      allowDomains: ["*.example.com"],
      blockDomains: [],
    });
    expect(allowed.ok).toBe(true);
  });
});

