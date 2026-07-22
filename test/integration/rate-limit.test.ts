import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// The binding caps /api/* at 120 requests per 60s per client IP (wrangler.toml [[ratelimits]]).
// Each case uses its own CF-Connecting-IP so the buckets stay independent, and so the rest of the
// suite — which sends no CF-Connecting-IP and is therefore not rate limited — is unaffected.
//
// The cap is enforced against a wall-clock window, so these cases flood until the limiter answers
// 429 rather than sending a fixed count: a window that rolls over mid-flood hands out a fresh
// allowance, and a fixed count with only a few requests of slack would then never observe a 429.
const FLOOD_CAP = 400;

async function floodUntilLimited(
  path: string,
  ip: string,
  extraHeaders: (i: number) => Record<string, string> = () => ({}),
) {
  const statuses = new Set<number>();

  for (let i = 0; i < FLOOD_CAP; i++) {
    const res = await SELF.fetch(`https://example.com${path}`, {
      headers: { "CF-Connecting-IP": ip, ...extraHeaders(i) },
    });
    statuses.add(res.status);

    if (res.status === 429) {
      expect(res.headers.get("Retry-After")).toBe("60");
      expect(await res.json()).toEqual({ error: "rate limited" });
      break;
    }
  }

  return statuses;
}

describe("rate limiting", () => {
  it("returns 429 once one IP exceeds the per-minute cap", async () => {
    const statuses = await floodUntilLimited("/api/health", "203.0.113.10");

    expect(statuses.has(200)).toBe(true);
    expect(statuses.has(429)).toBe(true);
  }, 30_000);

  it("does not charge one IP's flood to another IP", async () => {
    await floodUntilLimited("/api/health", "203.0.113.20");

    const bystander = await SELF.fetch("https://example.com/api/health", {
      headers: { "CF-Connecting-IP": "203.0.113.21" },
    });
    expect(bystander.status).toBe(200);
  }, 30_000);

  it("throttles before auth, so key guessing is capped too", async () => {
    // A different guess per request: the limiter buckets by IP, so rotating keys earns no extra
    // allowance. Guesses start as 401s and become 429s — the limiter is reached without a valid key.
    const statuses = await floodUntilLimited("/api/members", "203.0.113.30", (i) => ({
      "X-Api-Key": `guess-${i}`,
    }));

    expect(statuses.has(401)).toBe(true);
    expect(statuses.has(429)).toBe(true);
  }, 30_000);
});
