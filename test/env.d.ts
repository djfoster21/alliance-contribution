import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      API_KEY: string;
      ADMIN_API_KEY: string;
      VIEWER_API_KEY: string;
      TEST_MIGRATIONS: D1Migration[];
      SEED_STATEMENTS: string[];
    }
  }
}
