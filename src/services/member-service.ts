import type {
  Alias,
  Member,
  MemberDelta,
  MemberSnapshot,
  MemberSnapshotSeries,
  RosterImportBatch,
  RosterImportResult,
} from "../../shared/types";
import { normalizeName } from "../domain/resolve";
import { computeDelta, computeMemberDeltas } from "../domain/roster-delta";
import type { AliasRepo } from "../repositories/alias-repo";
import type { MemberRepo } from "../repositories/member-repo";
import type { SnapshotRepo } from "../repositories/snapshot-repo";
import type { RecomputeService } from "./recompute-service";

export type CreateMemberInput = {
  governor: string;
  alliance_rank?: string | null;
  power?: number | null;
  power_position?: number | null;
  active?: number;
};

// Meta fields only — `governor` is deliberately absent, see MemberService.update.
export type UpdateMemberInput = Partial<Pick<Member, "alliance_rank" | "power" | "power_position" | "active">>;

export type RenameResult = { member: Member; addedAlias: boolean; warning?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLIANCE_RANKS = new Set(["R1", "R2", "R3", "R4", "R5"]);

// Meta fields `update` accepts — kept in sync with `UpdateMemberInput`. `governor` is rejected separately
// (see MemberService.update) with its own message; anything else is a stale/unknown client field.
const UPDATABLE_FIELDS = new Set(["alliance_rank", "power", "power_position", "active"]);

export class MemberService {
  constructor(
    private readonly memberRepo: MemberRepo,
    private readonly aliasRepo: AliasRepo,
    private readonly snapshotRepo: SnapshotRepo,
    private readonly recompute: RecomputeService,
  ) {}

  async list(opts?: { active?: boolean }): Promise<Member[]> {
    return this.memberRepo.list(opts);
  }

  async get(id: number): Promise<Member | null> {
    return this.memberRepo.getById(id);
  }

  async create(dto: CreateMemberInput): Promise<Member> {
    assertAllianceRank(dto.alliance_rank);
    const governor = assertGovernorAvailable(await this.loadNameIndex(), dto.governor);

    return this.memberRepo.insert({
      governor,
      alliance_rank: dto.alliance_rank ?? null,
      power: dto.power ?? null,
      power_position: dto.power_position ?? null,
      active: dto.active ?? 1,
    });
  }

  // Plain meta-field update (alliance_rank/power/power_position/active) — persists whatever fields are provided.
  // `governor` is rejected: changing a canonical name here would add no alias and run no recompute, so
  // history would keep its member_id until some unrelated recompute re-resolved the old raw names to NULL
  // and silently dropped that member's whole history to unmapped. `rename` is the only governor path.
  async update(id: number, fields: UpdateMemberInput): Promise<Member | null> {
    // The route hands over an unvalidated JSON body, so the type alone can't enforce this.
    if ("governor" in fields) {
      throw new Error("Invalid member: governor cannot be changed via update — use rename");
    }
    // A stale/unknown key (e.g. a client still sending a renamed field) would otherwise fall through as a
    // silent no-op: the repo skips keys not in its allowlist, so the write applies zero assignments and
    // still returns 200 with the unchanged member — no error, no signal that nothing happened.
    for (const key of Object.keys(fields)) {
      if (!UPDATABLE_FIELDS.has(key)) {
        throw new Error(`Invalid member: unknown field "${key}"`);
      }
    }
    assertAllianceRank(fields.alliance_rank);
    return this.memberRepo.update(id, fields);
  }

  // Deactivate rather than delete — keeps history scorable (spec: never hard-delete a member with rows).
  async deactivate(id: number): Promise<void> {
    await this.memberRepo.deactivate(id);
  }

  // How many snapshot rows a capture date already holds. The import wizard asks before Apply, because
  // re-importing a short paste over a full capture replaces it and turns the missing members into gaps.
  async captureCount(captured_on: string): Promise<number> {
    if (!isCalendarDate(captured_on)) throw new Error(`Invalid captured_on: must be YYYY-MM-DD`);
    return this.snapshotRepo.countForDate(captured_on);
  }

  // The newest capture on record — the wizard compares its chosen date against this to know it is
  // backfilling before it offers the membership step.
  async latestCapture(): Promise<string | null> {
    return this.snapshotRepo.latestCaptureDate();
  }

  // Each member's power/position move since their own previous observation — the roster table's Δ
  // columns. Members with a single observation come back with null deltas, not omitted, so the table
  // can render a dash on the row instead of leaving a hole.
  async deltas(): Promise<MemberDelta[]> {
    return computeMemberDeltas(await this.snapshotRepo.lastTwoPerMember());
  }

  // One member's observation history plus the full capture axis. Returns null for an unknown member so
  // the route can 404 — an empty series is a real answer for a member who has simply never been in a paste.
  async snapshots(id: number): Promise<MemberSnapshotSeries | null> {
    const member = await this.memberRepo.getById(id);
    if (!member) return null;

    const [captures, rows] = await Promise.all([
      this.snapshotRepo.distinctCaptureDates(),
      this.snapshotRepo.listForMember(id),
    ]);
    return { captures, rows };
  }

  // Every name already claimed, keyed by the normalized key. One read of each table, shared by the
  // canonical-name gate and (in rename) the "does this member already own the old name" question.
  private async loadNameIndex(): Promise<NameIndex> {
    const [members, aliases] = await Promise.all([this.memberRepo.list(), this.aliasRepo.list()]);
    return buildNameIndex(members, aliases);
  }

  // First-class canonical rename (governor change). By default the old name becomes an alias so every
  // historical row that resolved via it stays attached to this member across the triggered recompute.
  // Opting out (addAlias: false) sends those rows to NULL/unmapped — surfaced via `warning`.
  async rename(id: number, newGovernor: string, opts?: { addAlias?: boolean }): Promise<RenameResult> {
    const member = await this.memberRepo.getById(id);
    if (!member) throw new Error("member not found");

    const index = await this.loadNameIndex();
    const governor = assertGovernorAvailable(index, newGovernor, id);

    const oldGovernor = member.governor;
    const willAddAlias = oldGovernor !== governor && opts?.addAlias !== false;

    // Insert the old-name alias FIRST, then update the governor. If the alias collides (UNIQUE) it aborts
    // before the governor changes, never renamed-with-no-alias (silent unmapped). If the governor update
    // then failed we would be left with an alias equal to the still-current governor: resolution is
    // unharmed (both keys point at this member), but that alias now OWNS the key, so the next attempt to
    // rename onto it would trip aliases.alias UNIQUE. That is why the gate above exempts names this
    // member already owns and why the insert below is skipped when the alias is already there.
    let addedAlias = false;
    let warning: string | undefined;
    if (willAddAlias) {
      // The old name is often already one of this member's own aliases — that is exactly what a
      // rename-back looks like. It already carries the history, so re-inserting it would do nothing but
      // trip UNIQUE; skip the insert and still report the old name as covered.
      if (index.aliases.get(normalizeName(oldGovernor)) !== id) {
        await this.aliasRepo.insert({ alias: oldGovernor, member_id: id, note: "rename" });
      }
      addedAlias = true;
    } else if (oldGovernor !== governor) {
      warning = `Historical rows logged under "${oldGovernor}" will resolve to NULL/unmapped after recompute; no alias was added.`;
    }

    await this.memberRepo.update(id, { governor });
    await this.recompute.run();

    const fresh = await this.memberRepo.getById(id);
    if (!fresh) throw new Error("MemberService.rename: member missing after write");
    return { member: fresh, addedAlias, warning };
  }

  // Apply an already-decided roster import batch atomically. The operator (via the frontend) has already
  // classified every pasted row into an existing-member `update`, a brand-new-member `create`, or an
  // `alias` of an existing member — the backend never guesses identity. VALIDATE-THEN-APPLY: load the
  // current members + aliases once, collect ALL violations, and if any exist throw a single error listing
  // them (nothing is written). Only when clean do we apply the writes and run ONE recompute — adding
  // members/aliases can retroactively resolve previously-unmapped participation rows, which is the point.
  async importRoster(batch: RosterImportBatch): Promise<RosterImportResult> {
    const { captured_on, updates = [], creates = [], aliases = [], deactivate = [], reactivate = [] } = batch;

    const [members, existingAliases] = await Promise.all([this.memberRepo.list(), this.aliasRepo.list()]);
    const memberById = new Map(members.map((m) => [m.id, m]));
    const index = buildNameIndex(members, existingAliases);

    // What THIS batch says about each observed member. Kept separate from the stored row because a
    // backdated import (Task 3) deliberately does not write these values onto `members` — the snapshot
    // still has to record what the paste said, not what the member currently is.
    const batchMeta = new Map<number, { alliance_rank?: string | null; power?: number | null; power_position?: number | null }>();
    for (const row of [...updates, ...aliases]) batchMeta.set(row.member_id, row);

    // A capture older than one already on record is a BACKFILL: it may add history, but it may not move
    // anyone's current standing backwards, and it is not evidence about who is in the alliance today.
    const latestCapture = await this.snapshotRepo.latestCaptureDate();
    const backdated = latestCapture !== null && typeof captured_on === "string" && captured_on < latestCapture;
    const observedSince = new Set(
      backdated && typeof captured_on === "string"
        ? await this.snapshotRepo.membersWithCaptureAfter(captured_on)
        : [],
    );

    const violations: string[] = [];

    if (typeof captured_on !== "string" || !isCalendarDate(captured_on)) {
      violations.push(`captured_on must be a real YYYY-MM-DD date, got "${String(captured_on)}"`);
    }

    // alliance_rank is a closed set; anything else is an OCR error and must not reach the column.
    for (const row of [...updates, ...creates, ...aliases]) {
      const rank = (row as { alliance_rank?: string | null }).alliance_rank;
      if (rank !== undefined && rank !== null && !ALLIANCE_RANKS.has(rank)) {
        violations.push(`alliance_rank "${rank}" is not one of R1-R5`);
      }
    }

    // The snapshot row takes each observed member's EFFECTIVE rank — the batch value when the row carries
    // one (metaFields overwrites), otherwise whatever is already stored — and `member_snapshots` HAS the
    // CHECK that `members` could not get (0004: no CHECK without a table rebuild). Checking only the ranks
    // present in the batch leaves a stored out-of-set value from any other ingress (an older release, a
    // restored backup, hand-run SQL) to blow up replaceForDate mid-apply, after the member updates and
    // deactivations have already committed.
    for (const row of [...updates, ...aliases]) {
      if ("alliance_rank" in row) continue; // covered above; the batch value replaces the stored one
      const stored = memberById.get(row.member_id)?.alliance_rank;
      if (stored !== undefined && stored !== null && !ALLIANCE_RANKS.has(stored)) {
        violations.push(
          `member ${row.member_id} has a stored alliance_rank "${stored}" that is not one of R1-R5 — ` +
            `fix the member before importing`,
        );
      }
    }

    // Every row that will produce a snapshot must resolve to a DISTINCT member. Two pasted names can
    // resolve to one member (a governor and one of its aliases), which name-level deduplication in the
    // client cannot catch. Without this the UNIQUE (member_id, captured_on) violation surfaces at apply
    // step 3 — after member updates and deactivations have committed — leaving a half-reconciled roster.
    // This check is what keeps the documented no-transaction rationale true rather than merely inherited.
    const observedIds = [...updates.map((u) => u.member_id), ...aliases.map((a) => a.member_id)];
    const seenMembers = new Set<number>();
    for (const id of observedIds) {
      if (seenMembers.has(id)) violations.push(`member ${id} appears twice in this batch`);
      seenMembers.add(id);
    }

    // A membership list may not name the same member twice: `deactivated`/`reactivated` would over-count
    // and the delta would list the member once per occurrence.
    for (const [field, ids] of [["deactivate", deactivate] as const, ["reactivate", reactivate] as const]) {
      const seen = new Set<number>();
      for (const id of ids) {
        if (seen.has(id)) violations.push(`member ${id} appears twice in ${field}`);
        seen.add(id);
      }
    }

    // The same paste cannot be evidence that a member is both present and gone: they would get a snapshot
    // row for this capture AND be listed in the delta's `departed`, with active = 0.
    const deactivateSet = new Set(deactivate);
    for (const id of new Set(observedIds)) {
      if (deactivateSet.has(id)) {
        violations.push(`member ${id} is both observed in this capture and marked for deactivation`);
      }
    }

    for (const id of deactivate) {
      if (!memberById.has(id)) violations.push(`member ${id} not found`);
      else if (memberById.get(id)!.active !== 1) violations.push(`member ${id} is not active`);
    }
    for (const id of reactivate) {
      if (!memberById.has(id)) violations.push(`member ${id} not found`);
      else if (memberById.get(id)!.active === 1) violations.push(`member ${id} is already active`);
    }

    if (backdated && (deactivate.length > 0 || reactivate.length > 0)) {
      violations.push(
        `capture ${captured_on} is backdated (newest on record is ${latestCapture}) — membership changes ` +
          `are not accepted from an old roster; who was in the alliance then is not evidence about now`,
      );
    }

    // A referenced member (an update target, or the member an alias renames onto) must exist.
    for (const u of updates) {
      if (!memberById.has(u.member_id)) violations.push(`member ${u.member_id} not found`);
    }
    for (const a of aliases) {
      if (!memberById.has(a.member_id)) violations.push(`member ${a.member_id} not found`);
    }

    // Every NEW name — a create's governor or an alias's alias — must be non-empty and must not collide, on
    // the NORMALIZED key, with an existing governor, an existing alias, or another new name in this same
    // batch. Resolution is alias-first and case-sensitive on the NFC key (see domain/resolve); a collision
    // would silently duplicate or shadow an identity, so the whole batch is rejected.
    const batchKeys = new Set<string>();
    for (const c of creates) {
      if (typeof c.governor !== "string" || c.governor.trim() === "") {
        violations.push("create governor must be a non-empty string");
        continue;
      }
      const governor = c.governor.trim();
      const key = normalizeName(governor);
      // A non-empty name that normalizes away to "" (e.g. a tag-only "[ABC]") could never resolve — it would
      // be a dead member — so reject it rather than insert it (mirrors the alias path).
      const clash = nameClash(key, index, { batchKeys });
      if (clash === "empty") {
        violations.push(`governor "${governor}" normalizes to an empty name and could never resolve`);
        continue;
      }
      if (clash !== null) {
        violations.push(`governor "${governor}" duplicates an existing name or another row in this batch`);
      }
      batchKeys.add(key);
    }
    for (const a of aliases) {
      // A promote row is a rename: the pasted name becomes this member's governor, so a key this SAME
      // member already owns is a rename-back, not a merge — see the apply step and rename().
      const selfId = a.promote_to_governor ? a.member_id : undefined;

      if (typeof a.alias !== "string" || a.alias.trim() === "") {
        violations.push("alias must be a non-empty string");
      } else {
        const alias = a.alias.trim();
        const key = normalizeName(alias);
        const clash = nameClash(key, index, { batchKeys, selfId });
        if (clash === "empty") {
          violations.push(`alias "${alias}" normalizes to an empty name and could never resolve`);
        } else {
          if (clash !== null) {
            violations.push(`alias "${alias}" duplicates an existing name or another row in this batch`);
          }
          batchKeys.add(key);
        }
      }

      // The alias a promote row INSERTS is the member's OLD governor, not the pasted name, so it needs the
      // same gate — otherwise an old governor that is already someone else's alias trips aliases.alias
      // UNIQUE at apply time, after the member updates and deactivations have committed. Their own
      // governor key is exempted by selfId, as is an alias they already own (the apply step skips that
      // insert rather than duplicating it).
      const oldGovernor = a.promote_to_governor ? memberById.get(a.member_id)?.governor : undefined;
      if (oldGovernor !== undefined) {
        const key = normalizeName(oldGovernor);
        const clash = nameClash(key, index, { batchKeys, selfId: a.member_id });
        if (clash === "empty") {
          violations.push(`alias "${oldGovernor}" normalizes to an empty name and could never resolve`);
        } else {
          if (clash !== null) {
            violations.push(`alias "${oldGovernor}" duplicates an existing name or another row in this batch`);
          }
          batchKeys.add(key);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(`Roster import rejected:\n- ${violations.join("\n- ")}`);
    }

    // Apply — every write lands before the single recompute. No DB transaction, which is safe only because
    // the validation above covers every constraint these writes can violate:
    //   members.governor NOT NULL UNIQUE          — the non-empty + normalized-key gate (strictly stronger
    //                                               than the byte-exact UNIQUE), for creates AND promotes
    //   aliases.alias NOT NULL UNIQUE             — the same gate on each pasted alias AND on the OLD
    //                                               governor a promote inserts; a key this member already
    //                                               owns is a rename-back, and its insert is skipped below
    //   aliases.member_id FK                      — the member-exists checks
    //   member_snapshots.member_id FK             — observed ids are those same checked ids, plus ids we
    //                                               just inserted
    //   member_snapshots(member_id, captured_on)  — the distinct-member check (created ids are fresh)
    //   member_snapshots.captured_on NOT NULL     — the real-calendar-date check
    //   member_snapshots.alliance_rank CHECK      — the EFFECTIVE-rank check (batch value, else stored)
    // Two limits on that claim, both real. It is a claim about CONSTRAINTS, not about input types: `power`
    // and `power_position` have no constraint to violate, so junk there is stored, not rejected. And it
    // holds for ONE caller at a time — validation and apply are separated by awaits, so a concurrent
    // create/rename/import can invalidate the reads underneath us. If a future migration adds a constraint
    // this list does not cover, wrap the block in a db.batch(). The catch is the backstop for all of it.
    let created: Member[];
    let observed: Member[];
    let previous: MemberSnapshot[];
    let afterById: Map<number, Member>;
    try {
      for (const u of updates) {
        // Observed since this capture → their current standing is newer than this paste. History still
        // gets the snapshot row below; only the member row is left alone.
        if (observedSince.has(u.member_id)) continue;
        await this.memberRepo.update(u.member_id, metaFields(u));
      }
      created = [];
      for (const c of creates) {
        created.push(
          await this.memberRepo.insert({
            governor: c.governor.trim(),
            alliance_rank: c.alliance_rank ?? null,
            power: c.power ?? null,
            power_position: c.power_position ?? null,
            active: 1,
          }),
        );
      }
      for (const a of aliases) {
        const alias = a.alias.trim();
        if (a.promote_to_governor) {
          // A rename: the pasted name becomes the governor and the OLD name is kept as the alias, so every
          // historical row that resolved via it stays attached across the recompute below. Aliasing the
          // pasted name instead would leave the old name mapping nowhere — silent unmapped history — and
          // would also leave a permanent alias equal to a governor, which every other path forbids.
          // Alias first, then the governor swap — same ordering rationale as rename(): if the insert
          // collides the canonical name is untouched, never renamed-with-no-alias.
          const oldGovernor = memberById.get(a.member_id)!.governor;
          // Renaming back to a name this member used before is routine (the alliance cycles decoy names),
          // and then the old governor is ALREADY one of their aliases. It already covers the history, so
          // re-inserting it would only trip aliases.alias UNIQUE — same skip as rename().
          if (index.aliases.get(normalizeName(oldGovernor)) !== a.member_id) {
            await this.aliasRepo.insert({
              alias: oldGovernor,
              member_id: a.member_id,
              note: "roster import rename",
            });
          }
          await this.memberRepo.update(a.member_id, { governor: alias });
        } else {
          await this.aliasRepo.insert({ alias, member_id: a.member_id, note: "roster import" });
        }
        if (!observedSince.has(a.member_id)) {
          await this.memberRepo.update(a.member_id, metaFields(a));
        }
      }

      for (const id of deactivate) await this.memberRepo.update(id, { active: 0 });
      for (const id of reactivate) await this.memberRepo.update(id, { active: 1 });

      // Read back AFTER the writes so governors reflect renames and creates have their ids. The delta's
      // `governor` values must be post-rename — the client's member list is stale for anything we changed.
      afterById = new Map((await this.memberRepo.list()).map((m) => [m.id, m]));

      // Every row the operator actually saw in the paste, and only those: a member absent from the capture
      // gets NO snapshot row — a gap, not a zero. Validation guarantees these ids are distinct and exist,
      // which is what protects UNIQUE (member_id, captured_on) without a transaction.
      observed = [
        ...updates.map((u) => u.member_id),
        ...aliases.map((a) => a.member_id),
        ...created.map((m) => m.id),
      ].map((id) => afterById.get(id)!);

      // Read the baseline BEFORE replaceForDate purely so it reflects the pre-import world in one place;
      // the query itself is unaffected either way, because `captured_on < ?` already excludes the date
      // replaceForDate rewrites. Keep the order, but do not move a write in here expecting it to matter.
      previous = await this.snapshotRepo.latestPerMemberBefore(captured_on);
      // An import that observed NOBODY (e.g. one that only deactivates people) must not touch snapshot
      // history: replaceForDate would delete whatever capture already exists for this date and write
      // nothing back. The spec's overwrite guard is client-side only, so this is the server-side stop.
      if (observed.length > 0) {
        await this.snapshotRepo.replaceForDate(
          captured_on,
          observed.map((m) => ({
            member_id: m.id,
            captured_on,
            ...effectiveMeta(m, batchMeta.get(m.id)),
          })),
        );
      }
    } catch (err) {
      throw new Error(
        "roster import failed mid-apply — the roster is PARTIALLY APPLIED (some member updates, creates, " +
          "aliases and membership changes landed, others did not), the snapshot for this capture was NOT " +
          "written, and the recompute did NOT run, so participation history is stale against the members " +
          "that did change. Reconcile the roster by hand before re-importing — the batch will no longer " +
          "validate as-is: " +
          (err as Error).message,
      );
    }

    const ref = (id: number) => ({ member_id: id, governor: afterById.get(id)!.governor });
    const delta = computeDelta({
      captured_on,
      current: observed.map((m) => ({
        member_id: m.id,
        governor: m.governor,
        ...effectiveMeta(m, batchMeta.get(m.id)),
      })),
      previous,
      joined: created.map((m) => ({ member_id: m.id, governor: m.governor })),
      departed: deactivate.map(ref),
      returned: reactivate.map(ref),
    });

    const { participations } = await this.recompute.run();

    return {
      updated: updates.length,
      created: creates.length,
      aliased: aliases.length,
      deactivated: deactivate.length,
      reactivated: reactivate.length,
      recomputed: participations,
      delta,
    };
  }
}

// Every name the DB already answers to, keyed by the NORMALIZED key (strip the alliance tag, trim, NFC) → the member
// that owns it. Resolution is alias-first on exactly this key (domain/resolve), so two names sharing a key
// are ONE identity to the app even though `members.governor` / `aliases.alias` UNIQUE are byte-exact and
// would happily accept both.
type NameIndex = { governors: Map<string, number>; aliases: Map<string, number> };

// Why a candidate name cannot be used, or null if it is free.
type NameClash = "empty" | "governor" | "alias" | "batch";

function buildNameIndex(members: readonly Member[], aliases: readonly Alias[]): NameIndex {
  return {
    governors: new Map(members.map((m) => [normalizeName(m.governor), m.id])),
    aliases: new Map(aliases.map((a) => [normalizeName(a.alias), a.member_id])),
  };
}

// The single identity gate, shared by create, rename and importRoster.
// `selfId` exempts names this same member already owns: reverting to a name they used before is routine
// here (the alliance deliberately cycles decoy names) and is a rename-back, never an identity merge.
// `batchKeys` holds the new names accumulated earlier in the same import batch.
function nameClash(
  key: string,
  index: NameIndex,
  opts: { batchKeys?: ReadonlySet<string>; selfId?: number } = {},
): NameClash | null {
  // A non-empty name that normalizes away to "" (e.g. a tag-only "[ABC]") could never resolve — it would
  // be a dead identity — so it is rejected rather than stored.
  if (key === "") return "empty";
  const governorOwner = index.governors.get(key);
  if (governorOwner !== undefined && governorOwner !== opts.selfId) return "governor";
  const aliasOwner = index.aliases.get(key);
  if (aliasOwner !== undefined && aliasOwner !== opts.selfId) return "alias";
  if (opts.batchKeys?.has(key)) return "batch";
  return null;
}

// The canonical-name gate for the single-member paths. `members.governor` UNIQUE is byte-exact, so without
// this "Zeta" and "[ABC]Zeta" both insert and the first member's whole history silently resolves to the
// second — the same merge importRoster already rejects.
function assertGovernorAvailable(index: NameIndex, value: unknown, selfId?: number): string {
  const governor = assertNonEmptyGovernor(value);
  switch (nameClash(normalizeName(governor), index, { selfId })) {
    case "empty":
      throw new Error(
        `Invalid member: governor "${governor}" normalizes to an empty name and could never resolve`,
      );
    case "governor":
      throw new Error(`conflict: governor "${governor}" duplicates an existing member (UNIQUE)`);
    case "alias":
      throw new Error(`conflict: governor "${governor}" would be shadowed by an existing alias`);
  }
  return governor;
}

// A real calendar date in YYYY-MM-DD, not just the shape: the regex alone accepts "2026-13-45", which
// stores fine and then rolls over inside the delta's daysBetween into a nonsense elapsed_days.
// Pure — both the shape and the roundtrip come from the argument, never from the clock.
function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

// The meta fields a roster row carries, including ONLY the keys actually present so an omitted field
// is left untouched rather than nulled.
function metaFields(row: {
  alliance_rank?: string | null;
  power?: number | null;
  power_position?: number | null;
}): UpdateMemberInput {
  const fields: UpdateMemberInput = {};
  if ("alliance_rank" in row) fields.alliance_rank = row.alliance_rank;
  if ("power" in row) fields.power = row.power;
  if ("power_position" in row) fields.power_position = row.power_position;
  return fields;
}

// The value a capture records for a member: the batch's value when the pasted row carried that cell,
// otherwise whatever is stored. Identical to the stored row for a normal import (the meta write already
// applied the batch value) and deliberately different for a backdated one, where the meta write is skipped.
function effectiveMeta(
  member: Member,
  batch: { alliance_rank?: string | null; power?: number | null; power_position?: number | null } | undefined,
): { alliance_rank: string | null; power: number | null; power_position: number | null } {
  return {
    alliance_rank: batch && "alliance_rank" in batch ? batch.alliance_rank ?? null : member.alliance_rank,
    power: batch && "power" in batch ? batch.power ?? null : member.power,
    power_position: batch && "power_position" in batch ? batch.power_position ?? null : member.power_position,
  };
}

function assertNonEmptyGovernor(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Invalid member: governor must be a non-empty string");
  }
  return value.trim();
}

// `members.alliance_rank` has no CHECK (0004's comment: the table cannot gain one without a rebuild) but
// `member_snapshots.alliance_rank` does. Without this guard an out-of-set rank set through create/update
// survives on the member and then throws inside replaceForDate on the NEXT import — after that import's
// member updates and deactivations have already committed. Reject it at the door instead.
function assertAllianceRank(value: string | null | undefined): void {
  if (value !== undefined && value !== null && !ALLIANCE_RANKS.has(value)) {
    throw new Error(`Invalid member: alliance_rank "${value}" is not one of R1-R5`);
  }
}
