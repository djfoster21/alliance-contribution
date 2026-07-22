import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { createServices } from "../../src/services";
import { SCHEMA_VERSION } from "../../src/domain/backup";
import { BackupRepo } from "../../src/repositories/backup-repo";
import { BackupService } from "../../src/services/backup-service";
import type { RecomputeService } from "../../src/services/recompute-service";

const { DB, SEED_STATEMENTS } = env;

beforeAll(async () => {
  for (const stmt of SEED_STATEMENTS) await DB.prepare(stmt).run();
  const { memberService, eventService } = createServices(DB);
  await memberService.create({ governor: "SvcMember" });
  await eventService.create({
    activity: "contribution",
    date: "2026-12-01",
    rows: [{ raw_name: "SvcMember", value: 25000 }],
  });
});

describe("BackupService", () => {
  it("export produces a valid envelope stamped with the current schema", async () => {
    const { backupService } = createServices(DB);
    const file = await backupService.export("2026-12-01T00:00:00.000Z");
    expect(file.format).toBe("alliance-backup");
    expect(file.schema).toBe(SCHEMA_VERSION);
    expect(file.tables.members.some((r) => r.governor === "SvcMember")).toBe(true);
  });

  it("import round-trips an exported file and recomputes", async () => {
    const { backupService } = createServices(DB);
    const file = await backupService.export("2026-12-01T00:00:00.000Z");
    const result = await backupService.import(file);
    expect(result.recomputed).toBe(true);
    expect(result.imported.members).toBe(file.tables.members.length);

    const after = await backupService.export("2026-12-01T00:00:00.000Z");
    expect(after.tables.participations).toEqual(file.tables.participations);
  });

  it("import throws BackupValidationError on a bad file (DB untouched)", async () => {
    const { backupService } = createServices(DB);
    const membersBefore = (await backupService.export("x")).tables.members.length;
    await expect(backupService.import({ format: "nope" })).rejects.toThrow("format");
    const membersAfter = (await backupService.export("x")).tables.members.length;
    expect(membersAfter).toBe(membersBefore);
  });

  it("import returns recomputed:false (not throw) when recompute fails, keeping imported rows", async () => {
    const { backupService } = createServices(DB);
    const file = await backupService.export("2026-12-01T00:00:00.000Z");
    const failing = {
      run: async () => {
        throw new Error("boom");
      },
    } as unknown as RecomputeService;
    const svc = new BackupService(new BackupRepo(DB), failing);
    const result = await svc.import(file);
    expect(result.recomputed).toBe(false);
    expect(result.error).toBe("boom");
    expect(result.imported.members).toBe(file.tables.members.length);
  });
});
