import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import type { PowerChange, RankChange, RosterDelta } from "@shared/types";
import { Alert, AlertContent } from "@/components/ui/alert";

/** Largest power moves worth listing. The count of what was dropped is always shown. */
const POWER_MOVE_LIMIT = 10;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-secondary">{title}</span>
      <div className="text-[13px] text-foreground">{children}</div>
    </div>
  );
}

function RankLine({ c }: { c: RankChange }) {
  return (
    <>
      {c.governor}: <span className="num">{c.from ?? "—"}</span> →{" "}
      <span className="num">{c.to ?? "—"}</span> (since <span className="num">{c.since}</span>)
    </>
  );
}

/**
 * `from` is guaranteed non-null for every `verify` entry (roster-delta.ts guards it before dividing
 * by it), so the percentage — the figure the verify threshold actually reasons about — is shown
 * whenever it's computable. A zero baseline (0 -> large power, the exact identity-swap shape the
 * tripwire exists to catch) yields no percentage rather than an infinite one.
 */
function PowerLine({ c }: { c: PowerChange }) {
  const sign = c.delta > 0 ? "+" : "";
  const pct = c.from ? ` (${sign}${Math.round((c.delta / c.from) * 100)}%)` : "";
  const positionAbs = c.delta_position === null ? null : Math.abs(c.delta_position);

  return (
    <>
      {c.governor}:{" "}
      <span className="num">
        {sign}
        {c.delta.toLocaleString()}
        {pct}
      </span>
      {positionAbs !== null && positionAbs !== 0 && (
        <>
          , {c.delta_position! < 0 ? "up" : "down"} <span className="num">{positionAbs}</span> place
          {positionAbs === 1 ? "" : "s"}
        </>
      )}{" "}
      over <span className="num">{c.elapsed_days}d</span>
    </>
  );
}

/**
 * What this capture reports changed in-game since each member's OWN last observation. It never
 * proposes a promotion or a demotion — every line describes something that already happened.
 */
export function RosterDeltaPanel({ delta, capturedOn }: { delta: RosterDelta; capturedOn: string }) {
  // `verify` is a subset of `powerMoves` (roster-delta.ts pushes both in the same branch) and both
  // are sorted by magnitude and rendered with the same line formatter, so listing powerMoves whole
  // would show the verify members twice — and with 10+ of them the power-move section would be
  // nothing but the verify list. The domain keeps the overlap on purpose; the panel dedupes it.
  const verifyIds = new Set(delta.verify.map((c) => c.member_id));
  const otherMoves = delta.powerMoves.filter((c) => !verifyIds.has(c.member_id));
  const extraMoves = Math.max(0, otherMoves.length - POWER_MOVE_LIMIT);
  // Only the baseline-derived sections. joined/departed/returned render ABOVE this branch and need
  // no baseline, so counting them here would suppress the reassurance line and leave the "compared
  // against…" header with no body under it — which reads as a rendering failure.
  const nothing =
    delta.leadership.length === 0 &&
    delta.promotions.length === 0 &&
    delta.demotions.length === 0 &&
    delta.powerMoves.length === 0;

  return (
    <div className="flex flex-col gap-3 rounded-[6px] border border-border bg-background p-3">
      {/* Membership changes need no baseline, so they render even for a backdated import with no
          capture before it — otherwise such an import would silently drop a Deactivated list the
          operator just authored. */}
      {delta.joined.length > 0 && (
        <Section title={`Joined (${delta.joined.length})`}>
          <ul className="flex flex-col gap-0.5">
            {delta.joined.map((m) => (
              <li key={m.member_id} className="text-[12px] text-secondary">
                {m.governor}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {delta.departed.length > 0 && (
        <Section title={`Deactivated (${delta.departed.length})`}>
          <ul className="flex flex-col gap-0.5">
            {delta.departed.map((m) => (
              <li key={m.member_id} className="text-[12px] text-secondary">
                {m.governor}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {delta.returned.length > 0 && (
        <Section title={`Reactivated (${delta.returned.length})`}>
          <ul className="flex flex-col gap-0.5">
            {delta.returned.map((m) => (
              <li key={m.member_id} className="text-[12px] text-secondary">
                {m.governor}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {delta.previousCapture === null ? (
        <p className="text-[13px] text-muted">
          No capture on record before <span className="num">{capturedOn}</span> — nothing to compare
          it against yet.
        </p>
      ) : (
        <>
          <span className="text-[12px] text-muted">
            Compared against each member's last observation (previous capture:{" "}
            <span className="num text-secondary">{delta.previousCapture}</span> — individual
            baselines may be older).
          </span>

          {nothing && (
            <p className="text-[13px] text-muted">
              Nothing changed since each member's last observation.
            </p>
          )}

          {delta.verify.length > 0 && (
            <Alert variant="warn">
              <TriangleAlert />
              <AlertContent>
                <div className="font-medium">
                  {delta.verify.length} member{delta.verify.length === 1 ? "'s" : "s'"} power moved
                  far more than the elapsed time explains. Confirm the name in the screenshot belongs
                  to the member it matched.
                </div>
                <ul className="flex flex-col gap-0.5">
                  {delta.verify.map((c) => (
                    <li key={c.member_id} className="text-[12px]">
                      <PowerLine c={c} />
                    </li>
                  ))}
                </ul>
              </AlertContent>
            </Alert>
          )}

          {delta.leadership.length > 0 && (
            <Section title="Leadership (R4 / R5)">
              <ul className="flex flex-col gap-0.5">
                {delta.leadership.map((c) => (
                  <li key={c.member_id} className="text-[12px] text-secondary">
                    <RankLine c={c} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {delta.promotions.length > 0 && (
            <Section title={`Promoted (${delta.promotions.length})`}>
              <ul className="flex flex-col gap-0.5">
                {delta.promotions.map((c) => (
                  <li key={c.member_id} className="text-[12px] text-secondary">
                    <RankLine c={c} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {delta.demotions.length > 0 && (
            <Section title={`Demoted (${delta.demotions.length})`}>
              <ul className="flex flex-col gap-0.5">
                {delta.demotions.map((c) => (
                  <li key={c.member_id} className="text-[12px] text-secondary">
                    <RankLine c={c} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {otherMoves.length > 0 && (
            <Section title={`Largest power moves (${otherMoves.length})`}>
              <ul className="flex flex-col gap-0.5">
                {otherMoves.slice(0, POWER_MOVE_LIMIT).map((c) => (
                  <li key={c.member_id} className="text-[12px] text-secondary">
                    <PowerLine c={c} />
                  </li>
                ))}
              </ul>
              {extraMoves > 0 && (
                <p className="mt-0.5 text-[12px] text-muted">
                  and <span className="num">{extraMoves}</span> more not shown
                </p>
              )}
            </Section>
          )}
        </>
      )}
    </div>
  );
}
