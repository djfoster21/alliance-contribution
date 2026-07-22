// Pure roster-paste parsing behind the import wizard. Deliberately free of JSX, DOM types, and
// path aliases: web/ has no test runner, so this lives as plain TypeScript that test/unit/ can
// import by relative path and the root Vitest unit project can execute.

import { normalizeName } from "./normalize";

/** The closed set of alliance ranks. Anything else in a paste is an OCR error, never stored. */
const ALLIANCE_RANKS = new Set(["R1", "R2", "R3", "R4", "R5"]);

/** One parsed roster line. `line` is 1-based against the raw paste so invalid rows can be pointed at. */
export type ParsedRosterRow = {
  line: number;
  /** Already `normalizeName`d by `parseRoster`. Re-normalized at lookup sites only so the key
   *  provably matches the map keys built from raw `MemberLike`/`AliasLike` input — not because
   *  this value is ever raw. */
  governor: string;
  alliance_rank: string | null;
  power: number | null;
  power_position: number | null;
};

/** A cell that failed validation — the operator needs to know which column to fix. */
export type InvalidRosterRow = {
  line: number;
  governor: string;
  field: "rank" | "power" | "power_position";
  value: string;
};

export type RosterParseResult = {
  rows: ParsedRosterRow[];
  noGovernor: number; // lines with no governor
  invalid: InvalidRosterRow[];
};

/**
 * A numeric cell. Empty → null, meaning the cell was absent and the stored value must be left
 * alone. Non-empty but unreadable → "bad": returning null there would omit the field from the
 * batch, so the member would keep their old power and that STALE value would be written into this
 * capture's snapshot (member-service.ts:397), which then reports as "no change".
 *
 * `/^\d+$/` rather than `Number.isInteger(Number(t)) && n >= 0`: the looser check accepts "-0"
 * (contradicting "no negatives"), "0x10" as hex, and "1e5" as scientific notation — none of which
 * a roster screenshot can produce. A plain digit string is the only shape a power or leaderboard
 * position ever has.
 *
 * Exported because the Add/Edit member dialogs validate the same two columns by hand and must not
 * accept a shape the paste rejects — the server validates neither.
 */
export function parseNumCell(text: string): number | null | "bad" {
  const t = text.replace(/[,\s]/g, "");
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number(t) : "bad";
}

/**
 * Parse the roster paste: one member per non-blank line, tab-separated —
 * `Governor<TAB>Rank<TAB>Power<TAB>Position`. A line with no governor is a parse-skip (counted); a
 * line whose rank, power, or power_position cell fails validation is dropped into `invalid` rather
 * than sent to the server, which would reject the whole batch for it.
 *
 * The row is dropped from `rows` entirely — safe only because invalid rows block Apply; if that
 * ever becomes non-blocking, the member would fall into the absent set (Task 2's `classifyRoster`:
 * active members not observed) and be offered for deactivation.
 */
export function parseRoster(text: string): RosterParseResult {
  const rows: ParsedRosterRow[] = [];
  const invalid: InvalidRosterRow[] = [];
  let noGovernor = 0;

  // \r?\n so a CRLF clipboard does not leave \r on the last cell of every line.
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") continue;
    // Ignore fenced-code-block markers — the LLM is prompted to wrap output in ``` fences, and the
    // fence keeps literal tabs intact through the copy (mirrors web/src/pages/Events.tsx's guard).
    if (trimmed.startsWith("```")) continue;
    const lineNo = i + 1;
    const parts = line.split("\t").map((p) => p.trim());
    const governor = normalizeName(parts[0] ?? "");
    if (governor === "") {
      noGovernor++;
      continue;
    }

    const rawRank = parts[1] ?? "";
    let alliance_rank: string | null = null;
    if (rawRank !== "") {
      const upper = rawRank.toUpperCase();
      if (!ALLIANCE_RANKS.has(upper)) {
        // First failure wins: only the rank is reported here even if power/power_position are also
        // bad. The operator fixes this, re-pastes, and the next bad cell (if any) surfaces then.
        invalid.push({ line: lineNo, governor, field: "rank", value: rawRank });
        continue;
      }
      alliance_rank = upper;
    }

    const rawPower = parts[2] ?? "";
    const power = parseNumCell(rawPower);
    if (power === "bad") {
      invalid.push({ line: lineNo, governor, field: "power", value: rawPower });
      continue;
    }

    const rawPosition = parts[3] ?? "";
    const power_position = parseNumCell(rawPosition);
    if (power_position === "bad") {
      invalid.push({ line: lineNo, governor, field: "power_position", value: rawPosition });
      continue;
    }

    rows.push({ line: lineNo, governor, alliance_rank, power, power_position });
  }

  return { rows, noGovernor, invalid };
}

/** Structural — see the file header. Mirrors the fields of shared Member / Alias that matter here. */
export type MemberLike = { id: number; governor: string; active: number };
export type AliasLike = { alias: string; member_id: number };

export type MatchedRow = { row: ParsedRosterRow; memberId: number };

/** Two or more pasted names that resolve to one member. Blocking — the server rejects the batch. */
export type ConflictGroup = { memberId: number; governor: string; names: string[] };

export type Classification = {
  matched: MatchedRow[];
  unrecognized: ParsedRosterRow[];
  duplicates: number; // rows collapsed because an identical name appeared earlier
  conflicts: ConflictGroup[];
  absent: MemberLike[]; // active members this capture never observed
  returning: MemberLike[]; // inactive members the paste matched
  leaderWarning: string | null;
};

/**
 * Resolve every parsed row against the current roster, exactly as the backend does: alias table
 * first, then governor. Identity is never guessed — an unresolved name is `unrecognized` and waits
 * for an operator decision.
 *
 * `aliasTargets` maps a normalized pasted name to the member a step-2 "Alias of…" decision points
 * at. Decisions are folded in here rather than after the fact because both derived sets depend on
 * them: a renamed member must not read as absent, and any member named twice — by two matched rows,
 * by two decisions, or by one of each — is the duplicate-identity error the server rejects with
 * `member N appears twice in this batch`.
 *
 * Only decisions whose name is still `unrecognized` in THIS paste are read. The wizard keeps a
 * decision keyed by name after the paste is edited, so a stale decision would otherwise claim a
 * member who is no longer mentioned — conflicting against the row that now matches them, and
 * quietly removing them from `absent` while nothing in the batch refers to them.
 */
export function classifyRoster(input: {
  rows: ParsedRosterRow[];
  members: MemberLike[];
  aliases: AliasLike[];
  aliasTargets?: Record<string, number | null>;
}): Classification {
  const { rows, members, aliases, aliasTargets = {} } = input;

  const governorMap = new Map<string, number>();
  for (const m of members) governorMap.set(normalizeName(m.governor), m.id);
  const aliasMap = new Map<string, number>();
  for (const a of aliases) aliasMap.set(normalizeName(a.alias), a.member_id);

  const matched: MatchedRow[] = [];
  const unrecognized: ParsedRosterRow[] = [];
  const seenNames = new Set<string>();
  const namesByMember = new Map<number, string[]>();
  let duplicates = 0;

  const claim = (memberId: number, name: string) => {
    const names = namesByMember.get(memberId) ?? [];
    names.push(name);
    namesByMember.set(memberId, names);
  };

  for (const row of rows) {
    const key = normalizeName(row.governor);
    if (seenNames.has(key)) {
      // The Alliance Ranking screen pins the viewer's own row at the bottom, so the same name
      // appearing twice is the common case, not an edge case. Keep the first, count the rest.
      duplicates++;
      continue;
    }
    seenNames.add(key);

    const memberId = aliasMap.get(key) ?? governorMap.get(key) ?? null;
    if (memberId === null) {
      unrecognized.push(row);
      continue;
    }
    matched.push({ row, memberId });
    claim(memberId, row.governor);
  }

  for (const row of unrecognized) {
    // `typeof === "number"` excludes both `undefined` (no decision yet) and `null` ("New member" —
    // claims nobody), and reads a plain Record by key safely: a governor literally named
    // "toString" or "constructor" would otherwise return an inherited function, not a decision.
    const target = aliasTargets[normalizeName(row.governor)];
    if (typeof target === "number") claim(target, row.governor);
  }

  const memberById = new Map(members.map((m) => [m.id, m]));
  const conflicts: ConflictGroup[] = [];
  for (const [memberId, names] of namesByMember) {
    if (names.length > 1) {
      conflicts.push({
        memberId,
        governor: memberById.get(memberId)?.governor ?? `#${memberId}`,
        names,
      });
    }
  }

  const observed = new Set<number>(namesByMember.keys());
  const absent = members.filter((m) => m.active === 1 && !observed.has(m.id));
  const returning = members.filter((m) => m.active === 0 && observed.has(m.id));

  // Counted AFTER the duplicate collapse. The leader is the most likely operator, and the screen
  // pins their own row again at the bottom — counting raw rows would warn on every import.
  const survivors = [...matched.map((m) => m.row), ...unrecognized];
  const r5 = survivors.filter((r) => r.alliance_rank === "R5").length;
  const leaderWarning =
    r5 === 1
      ? null
      : r5 === 0
        ? "No R5 in this paste — the alliance leader is missing or the paste is partial."
        : `${r5} rows claim R5 — an alliance has exactly one leader, so check the paste.`;

  return { matched, unrecognized, duplicates, conflicts, absent, returning, leaderWarning };
}

/**
 * The meta a row carries, as a partial for the import batch. A field is included ONLY when the cell
 * was present: `MemberService.metaFields` (src/services/member-service.ts:515) copies keys that are
 * `in` the row, so an absent key leaves the stored value untouched while an explicit `null` would
 * wipe it. A blank cell in a partial paste must not erase a rank the roster already knows.
 */
export function metaFields(row: ParsedRosterRow): {
  alliance_rank?: string | null;
  power?: number | null;
  power_position?: number | null;
} {
  return {
    ...(row.alliance_rank !== null ? { alliance_rank: row.alliance_rank } : {}),
    ...(row.power !== null ? { power: row.power } : {}),
    ...(row.power_position !== null ? { power_position: row.power_position } : {}),
  };
}
