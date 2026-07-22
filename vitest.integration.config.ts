import path from "node:path";
import { defineProject } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { buildSeedSql } from "./seed/sql";

export default defineProject({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          API_KEY: "test-key",
          ADMIN_API_KEY: "test-admin-key",
          VIEWER_API_KEY: "test-viewer-key",
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          // Built here, in node (integration tests run in workerd), then handed to the test as a
          // binding — same pattern as TEST_MIGRATIONS above.
          SEED_STATEMENTS: buildSeedSql(),
        },
      },
    })),
  ],
  test: {
    name: "integration",
    include: ["test/integration/**/*.test.ts"],
    setupFiles: ["./test/integration/setup.ts"],
  },
});
