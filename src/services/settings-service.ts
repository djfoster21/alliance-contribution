import { DEFAULT_RANK_BANDS, type RankBands } from "../../shared/types";
import type { SettingsRepo } from "../repositories/settings-repo";

/** Stored TEXT that isn't a non-negative integer (missing row, hand-edited DB, restored backup)
 *  reads as "unset" — the boards must always get renderable sizes. */
function parseBandSize(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export class SettingsService {
  constructor(private repo: SettingsRepo) {}

  async getRankBands(): Promise<RankBands> {
    return {
      top: parseBandSize(await this.repo.get("band_top")) ?? DEFAULT_RANK_BANDS.top,
      mid: parseBandSize(await this.repo.get("band_mid")) ?? DEFAULT_RANK_BANDS.mid,
    };
  }

  async setRankBands(input: { top?: unknown; mid?: unknown }): Promise<RankBands> {
    const { top, mid } = input;
    if (
      typeof top !== "number" || !Number.isInteger(top) || top < 0 ||
      typeof mid !== "number" || !Number.isInteger(mid) || mid < 0
    ) {
      throw new Error("top and mid must be integers >= 0");
    }
    await this.repo.set("band_top", String(top));
    await this.repo.set("band_mid", String(mid));
    return { top, mid };
  }
}
