// Pure name resolution. No I/O, no fuzzy matching — exact map lookups only.

const ALLIANCE_TAG = /\[[A-Za-z0-9]{1,6}\]/g;

// Strip the alliance tag, trim, and Unicode NFC-normalize. Case is preserved (comparison is case-sensitive).
export function normalizeName(raw: string): string {
  return raw.replace(ALLIANCE_TAG, "").trim().normalize("NFC");
}

// Deterministic resolution order:
//   1. exact hit in aliases (normalized key) -> its member_id
//   2. else exact hit in governors (normalized key) -> that member_id
//   3. else null (unmapped — never guessed)
// The maps' KEYS are assumed already normalized via normalizeName by the caller.
// A rawName that normalizes to "" resolves to null.
export function resolveName(
  rawName: string,
  aliases: ReadonlyMap<string, number>,
  governors: ReadonlyMap<string, number>,
): number | null {
  const name = normalizeName(rawName);
  if (name === "") return null;
  return aliases.get(name) ?? governors.get(name) ?? null;
}
