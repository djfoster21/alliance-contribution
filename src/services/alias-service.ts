import type { Alias } from "../../shared/types";
import {
  findTwoTrapOverlaps,
  findWithinEventDuplicates,
  type ResolvedRow,
} from "../domain/ingest-validation";
import { normalizeName } from "../domain/resolve";
import type { AliasRepo } from "../repositories/alias-repo";
import type { MemberRepo } from "../repositories/member-repo";
import type { ParticipationRepo } from "../repositories/participation-repo";
import type { RecomputeService } from "./recompute-service";

export type AliasConflict =
  | { type: "within_event_duplicate"; event_id: number; member_id: number; raw_names: string[] }
  | { type: "two_trap_overlap"; activity_type_id: number; date: string; raw_names: string[] };

export type AliasChangeResult = { alias?: Alias; recomputed: number; conflicts: AliasConflict[] };

export class AliasService {
  constructor(
    private readonly aliasRepo: AliasRepo,
    private readonly memberRepo: MemberRepo,
    private readonly participationRepo: ParticipationRepo,
    private readonly recompute: RecomputeService,
  ) {}

  async list(opts?: { member_id?: number }): Promise<Alias[]> {
    return this.aliasRepo.list(opts);
  }

  // Add a human-verified mapping, then recompute so every participation whose raw_name now resolves via this
  // alias attaches to the member and re-scores. A retroactive within-event/two-trap conflict is surfaced in
  // the result, not thrown — recompute only re-resolves + re-scores, it never re-validates.
  async add(dto: { alias: string; member_id: number; note?: string | null }): Promise<AliasChangeResult> {
    const alias = assertNonEmptyAlias(dto.alias);

    const member = await this.memberRepo.getById(dto.member_id);
    if (!member) throw new Error("member not found");

    await this.assertUnique(alias);

    const inserted = await this.aliasRepo.insert({ alias, member_id: dto.member_id, note: dto.note ?? null });
    const { participations } = await this.recompute.run();
    const conflicts = await this.scanConflicts();

    return { alias: inserted, recomputed: participations, conflicts };
  }

  // Remove a mapping, then recompute — rows that resolved via it fall back to the governor or to NULL/unmapped.
  async remove(id: number): Promise<AliasChangeResult> {
    const alias = await this.aliasRepo.getById(id);
    if (!alias) throw new Error("alias not found");

    await this.aliasRepo.delete(id);
    const { participations } = await this.recompute.run();
    const conflicts = await this.scanConflicts();

    return { recomputed: participations, conflicts };
  }

  // Resolution is alias-first and compares on the NORMALIZED key (strip the alliance tag, trim, NFC). Reject
  // an alias that normalizes to an existing governor (it would never actually resolve to this member) or to
  // an existing alias (the UNIQUE constraint only catches byte-identical duplicates, not NFD vs NFC). Never
  // auto-create — a mapping is human-verified only.
  private async assertUnique(alias: string): Promise<void> {
    const key = normalizeName(alias);
    // A non-empty alias that normalizes away to "" (e.g. "[ABC]") could never resolve — resolveName returns
    // null for "" — so it would be a permanently dead mapping. Reject it rather than insert it.
    if (key === "") {
      throw new Error(`Invalid alias: "${alias}" normalizes to an empty name and could never resolve`);
    }

    const [members, aliases] = await Promise.all([this.memberRepo.list(), this.aliasRepo.list()]);

    if (members.some((m) => normalizeName(m.governor) === key)) {
      throw new Error(`conflict: alias "${alias}" equals an existing governor`);
    }
    if (aliases.some((a) => normalizeName(a.alias) === key)) {
      throw new Error(`conflict: alias "${alias}" equals an existing alias`);
    }
  }

  // Read-only scan of the current participation set for retroactive conflicts introduced by a resolution
  // change. Reuses the pure domain detectors — never re-implements the logic, never writes.
  private async scanConflicts(): Promise<AliasConflict[]> {
    const rows = await this.participationRepo.listForConflictScan();
    const conflicts: AliasConflict[] = [];

    // Within-event duplicates: two raw names resolving to the same member inside one event.
    const byEvent = new Map<number, ResolvedRow[]>();
    for (const row of rows) {
      const resolved: ResolvedRow = { raw_name: row.raw_name, member_id: row.member_id };
      const list = byEvent.get(row.event_id);
      if (list) list.push(resolved);
      else byEvent.set(row.event_id, [resolved]);
    }
    for (const [event_id, eventRows] of byEvent) {
      for (const dup of findWithinEventDuplicates(eventRows)) {
        conflicts.push({
          type: "within_event_duplicate",
          event_id,
          member_id: dup.member_id,
          raw_names: dup.raw_names,
        });
      }
    }

    // Two-trap overlaps: a member (or unresolved raw name) appearing in both traps on the same date.
    const byTrapKey = new Map<
      string,
      { activity_type_id: number; date: string; instance1: ResolvedRow[]; instance2: ResolvedRow[] }
    >();
    for (const row of rows) {
      if (row.max_instance !== 2) continue;
      const key = `${row.activity_type_id}|${row.date}`;
      let group = byTrapKey.get(key);
      if (!group) {
        group = { activity_type_id: row.activity_type_id, date: row.date, instance1: [], instance2: [] };
        byTrapKey.set(key, group);
      }
      const resolved: ResolvedRow = { raw_name: row.raw_name, member_id: row.member_id };
      if (row.instance === 1) group.instance1.push(resolved);
      else if (row.instance === 2) group.instance2.push(resolved);
    }
    for (const group of byTrapKey.values()) {
      const overlaps = findTwoTrapOverlaps(group.instance1, group.instance2);
      if (overlaps.length > 0) {
        conflicts.push({
          type: "two_trap_overlap",
          activity_type_id: group.activity_type_id,
          date: group.date,
          raw_names: [...new Set(overlaps.map((o) => o.raw_name))],
        });
      }
    }

    return conflicts;
  }
}

function assertNonEmptyAlias(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Invalid alias: alias must be a non-empty string");
  }
  return value.trim();
}
