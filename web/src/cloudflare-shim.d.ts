// The SPA imports domain types from shared/types.ts, which also declares the Worker
// `Env` binding referencing `D1Database` — a Cloudflare Workers runtime global. Provide a
// minimal ambient stand-in so the frontend type-checks without pulling in
// @cloudflare/workers-types (which would clash with the DOM lib).
declare global {
  type D1Database = unknown;
  type Fetcher = unknown;
  type RateLimit = unknown;
}

export {};
