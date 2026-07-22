// Mirrors src/domain/resolve.ts normalizeName — strip the alliance tag, trim, NFC (case-preserving).
// The worker/web module boundary prevents importing it directly; this 1-line pure mirror is acceptable.
export function normalizeName(raw: string): string {
  return raw.replace(/\[[A-Za-z0-9]{1,6}\]/g, "").trim().normalize("NFC");
}
