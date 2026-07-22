import { BackupValidationError, buildBackup, validateBackup, type BackupFile, type TableName } from "../domain/backup";
import type { BackupRepo } from "../repositories/backup-repo";
import type { RecomputeService } from "./recompute-service";

export type ImportResult = {
  imported: Record<TableName, number>;
  recomputed: boolean;
  error?: string;
};

export class BackupService {
  constructor(
    private readonly repo: BackupRepo,
    private readonly recompute: RecomputeService,
  ) {}

  async export(exportedAt: string): Promise<BackupFile> {
    const tables = await this.repo.dumpAll();
    return buildBackup(tables, exportedAt);
  }

  // Validate fully BEFORE touching data. On execution success, recompute; if recompute alone fails, the
  // rows are already loaded — report recomputed:false so the operator just re-runs recompute.
  async import(parsed: unknown): Promise<ImportResult> {
    const result = validateBackup(parsed);
    if (!result.ok) throw new BackupValidationError(result.error);

    const imported = await this.repo.replaceAll(result.file);

    try {
      await this.recompute.run();
    } catch (err) {
      return { imported, recomputed: false, error: (err as Error).message };
    }
    return { imported, recomputed: true };
  }
}
