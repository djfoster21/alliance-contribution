// Pure ingest integrity checks. No I/O, no fuzzy matching — resolved identity only.

export type ResolvedRow = { raw_name: string; member_id: number | null };

// Groups of raw names that resolve to the same non-null member_id within one event.
// Only returns groups of size >= 2. Null member_ids are never grouped (unknowns are distinct).
export function findWithinEventDuplicates(
  rows: ResolvedRow[],
): { member_id: number; raw_names: string[] }[] {
  const byMember = new Map<number, string[]>();
  for (const row of rows) {
    if (row.member_id === null) continue;
    const names = byMember.get(row.member_id);
    if (names) names.push(row.raw_name);
    else byMember.set(row.member_id, [row.raw_name]);
  }

  const duplicates: { member_id: number; raw_names: string[] }[] = [];
  for (const [member_id, raw_names] of byMember) {
    if (raw_names.length >= 2) duplicates.push({ member_id, raw_names });
  }
  return duplicates;
}

// Rows in `rows` whose identity also appears in `siblingRows` (the other trap instance, same date).
// Identity = member_id when non-null, else the raw_name. Returns the offending rows from `rows`.
export function findTwoTrapOverlaps(
  rows: ResolvedRow[],
  siblingRows: ResolvedRow[],
): ResolvedRow[] {
  const siblingIdentities = new Set<number | string>(
    siblingRows.map((row) => row.member_id ?? row.raw_name),
  );

  return rows.filter((row) => siblingIdentities.has(row.member_id ?? row.raw_name));
}
