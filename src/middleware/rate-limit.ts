import type { MiddlewareHandler } from "hono";
import type { Env } from "../../shared/types";

/**
 * Per-minute cap on /api/*, mounted in front of auth so key guessing is throttled too.
 *
 * Keyed by client IP, not by API key: the whole alliance shares one viewer key, so an API-key bucket
 * would have 86 members throttling each other. IP is also the axis abuse actually arrives on — a brute
 * forcer rotating guesses from one host stays in one bucket, where key-based bucketing would hand it a
 * fresh allowance per guess.
 *
 * Cloudflare always sets CF-Connecting-IP at the edge; its absence means we are not behind the edge
 * (the test runner), so there is no bucket to charge and the request passes.
 *
 * The binding is per-Cloudflare-location and eventually consistent, so the real ceiling is
 * (limit x colos reached). Good enough to bound D1 reads and brute-force attempts; it is not metering.
 */
export const rateLimit: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const ip = c.req.header("CF-Connecting-IP");
  if (!ip) {
    await next();
    return;
  }

  const { success } = await c.env.API_RATE_LIMIT.limit({ key: ip });
  if (!success) {
    return c.json({ error: "rate limited" }, 429, { "Retry-After": "60" });
  }

  await next();
};
