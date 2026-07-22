import type { MiddlewareHandler } from "hono";
import type { Env } from "../../shared/types";

export type Role = "admin" | "manager" | "viewer";
export type AuthVariables = { role: Role | null };

// Reachable without any key: the uptime probe, and the endpoint the SPA uses to discover what tier its
// stored key resolves to (it must be able to report "your key is not valid" rather than 401).
const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/me"]);

// Constant-time string compare (portable XOR-loop over UTF-8 bytes) so key comparisons don't leak
// timing information. Length mismatch returns false early since the loop can't run over mismatched
// lengths anyway.
function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

// Explicitly fails closed on an unset binding. Without these guards it still fails closed, but only by
// way of a subtle detail: TextEncoder.encode(input = "") treats an explicit undefined as the default "",
// so safeEqual's length check rejects it. Stating the intent here keeps that from silently regressing.
export function resolveRole(key: string | undefined, env: Env): Role | null {
  if (!key) return null;
  if (env.ADMIN_API_KEY && safeEqual(key, env.ADMIN_API_KEY)) return "admin";
  if (env.API_KEY && safeEqual(key, env.API_KEY)) return "manager";
  if (env.VIEWER_API_KEY && safeEqual(key, env.VIEWER_API_KEY)) return "viewer";
  return null;
}

// Resolves X-Api-Key to a role and stores it on context for downstream middleware/handlers. Gating rule:
// every /api route outside PUBLIC_PATHS needs a key that resolves to some role (401 otherwise), and the
// viewer tier is read-only — it may not touch /api/admin or any non-GET method (403).
export const apiKeyAuth: MiddlewareHandler<{ Bindings: Env; Variables: AuthVariables }> = async (c, next) => {
  const role = resolveRole(c.req.header("X-Api-Key"), c.env);
  c.set("role", role);

  if (PUBLIC_PATHS.has(c.req.path)) {
    await next();
    return;
  }

  if (role === null) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const isAdminRoute = c.req.path === "/api/admin" || c.req.path.startsWith("/api/admin/");
  const needsWriteTier = isAdminRoute || c.req.method !== "GET";
  if (needsWriteTier && role === "viewer") {
    return c.json({ error: "forbidden" }, 403);
  }

  await next();
};

// Gates destructive endpoints on top of apiKeyAuth: the admin key is required, the manager key is not enough.
export const requireAdmin: MiddlewareHandler<{ Bindings: Env; Variables: AuthVariables }> = async (c, next) => {
  if (c.get("role") !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }

  await next();
};
