/**
 * tests/security/egress-allowlist.test.ts
 *
 * Security regression: ensures the hunt scan flow only calls expected hosts.
 *
 * Only `api.osv.dev` (OSV advisory fetches) and configured provider hosts
 * should receive outbound requests during a hunt scan. Any other host
 * indicates a potential egress leak or misconfiguration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** Hosts that are explicitly allowed to receive outbound requests. */
const ALLOWED_HOSTS = new Set([
  "api.osv.dev",
  "api.anthropic.com",
  "api.openai.com",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
]);

/** Extracts the hostname from a URL string or URL object. */
function extractHost(input: string | URL | Request): string {
  try {
    const url = input instanceof Request ? input.url : String(input);
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

describe("Egress allowlist — hunt scan flow", () => {
  const capturedHosts: string[] = [];
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    capturedHosts.length = 0;

    // Replace global fetch with a spy that captures all outbound hosts
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const host = extractHost(input);
      if (host) capturedHosts.push(host);

      // Simulate a successful response for allowed hosts
      if (ALLOWED_HOSTS.has(host)) {
        return new Response(
          JSON.stringify({ vulns: [], status: "ok" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // Return 403 for unexpected hosts — this makes tests fail loudly
      return new Response(
        JSON.stringify({ error: "not allowed" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("OSV client only calls api.osv.dev", async () => {
    const { fetchAdvisory, clearAdvisoryCache } = await import("@/lib/advisories/osv-client");
    clearAdvisoryCache();

    await fetchAdvisory("CVE-2024-12345");

    const externalHosts = capturedHosts.filter((h) => h && h !== "");
    expect(externalHosts.every((h) => ALLOWED_HOSTS.has(h))).toBe(true);

    // Must have called the OSV API
    expect(externalHosts.some((h) => h === "api.osv.dev")).toBe(true);
  });

  it("no unexpected hosts are called when OSV returns empty result", async () => {
    const { fetchAdvisory, clearAdvisoryCache } = await import("@/lib/advisories/osv-client");
    clearAdvisoryCache();

    await fetchAdvisory("GHSA-xxxx-xxxx-xxxx");

    const unexpectedHosts = capturedHosts.filter(
      (h) => h !== "" && !ALLOWED_HOSTS.has(h),
    );
    expect(unexpectedHosts).toHaveLength(0);
  });

  it("extractHost helper correctly parses valid URLs", () => {
    expect(extractHost("https://api.osv.dev/v1/query")).toBe("api.osv.dev");
    expect(extractHost("https://api.anthropic.com/v1/messages")).toBe("api.anthropic.com");
    expect(extractHost("http://localhost:3000/api/test")).toBe("localhost");
  });

  it("extractHost helper returns empty string for invalid URLs", () => {
    expect(extractHost("not-a-url")).toBe("");
    expect(extractHost("")).toBe("");
  });

  it("allowlist contains only the expected provider and advisory hosts", () => {
    // Verify the allowlist itself is not overly permissive
    expect(ALLOWED_HOSTS.has("api.osv.dev")).toBe(true);
    expect(ALLOWED_HOSTS.has("api.anthropic.com")).toBe(true);
    // Ensure random hosts are NOT in allowlist
    expect(ALLOWED_HOSTS.has("evil.example.com")).toBe(false);
    expect(ALLOWED_HOSTS.has("data-exfil.attacker.io")).toBe(false);
  });
});
