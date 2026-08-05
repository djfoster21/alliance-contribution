import { StatCard } from "@/components/overview/StatCard";
import { rankTone } from "@/lib/alliance-rank";
import { cn } from "@/lib/utils";
import { TIER_ORDER, type RosterRow, type RosterStatus, type RosterSummary } from "@/lib/roster-view";

/** U+2212. A hyphen is narrower than a digit and breaks tabular alignment down a numeric column. */
const MINUS = "−";

/** Signed, thousands-separated, with a real minus sign. */
function signed(value: number): string {
  return value < 0 ? `${MINUS}${Math.abs(value).toLocaleString()}` : `+${value.toLocaleString()}`;
}

/** R1–R5 chip on the roster — same per-rank tones as AllianceRankBadge (2026-08-03 spec). */
export function RankChip({ rank }: { rank: string | null }) {
  if (rank === null) return <span className="text-faint">—</span>;
  return (
    <span
      className={cn(
        "inline-flex h-[22px] w-8 items-center justify-center rounded-[6px] font-mono text-[11.5px] font-semibold",
        rankTone(rank),
      )}
    >
      {rank}
    </span>
  );
}

/** "R3→R4" under the rank chip — only when a real change was observed. Quiet otherwise. */
export function RankChangeChip({ change }: { change: { from: string; to: string } | null }) {
  if (!change) return null;
  const up = (TIER_ORDER[change.to] ?? 0) > (TIER_ORDER[change.from] ?? 0);
  return (
    <span className={cn("num block text-[10.5px] font-semibold", up ? "text-up" : "text-down")}>
      {change.from}→{change.to}
    </span>
  );
}

/** A right-filled 3px bar. `pct` is already clamped 0..100 by the callers below. */
function Bar({ pct, className, width }: { pct: number; className: string; width: string }) {
  return (
    <div className={cn("h-[3px] overflow-hidden rounded-[2px] bg-muted-surface", width)}>
      <div className={cn("ml-auto h-full rounded-[2px]", className)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Power plus its share of the strongest member's power. */
export function PowerCell({ power, maxPower, top }: { power: number | null; maxPower: number; top: boolean }) {
  if (power === null) return <span className="text-faint">—</span>;
  const pct = maxPower > 0 ? Math.min(100, (power / maxPower) * 100) : 0;
  return (
    <div className="flex flex-col items-end gap-[5px]">
      <span className="num text-[14px] font-bold text-foreground">{power.toLocaleString()}</span>
      <Bar pct={pct} width="w-[88px]" className={top ? "bg-foreground" : "bg-faint"} />
    </div>
  );
}

/**
 * Change since this member's own last observation. Three states, never two: null is "no prior
 * observation" and renders an em dash; 0 is a real observed zero and says "no change" in words, so
 * the two can never be confused for one another.
 */
export function PowerChangeCell({ delta, maxAbsDelta }: { delta: number | null; maxAbsDelta: number }) {
  if (delta === null) {
    return (
      <div className="flex flex-col items-end gap-[5px]">
        <span className="text-[13.5px] text-faint">—</span>
        <Bar pct={0} width="w-[104px]" className="bg-faint" />
      </div>
    );
  }
  // Floor at 4% so a small real change is still a visible mark rather than an empty track.
  const pct = maxAbsDelta > 0 && delta !== 0 ? Math.max(4, Math.min(100, (Math.abs(delta) / maxAbsDelta) * 100)) : 0;
  const tone = delta > 0 ? "text-up" : delta < 0 ? "text-down" : "text-faint";
  const fill = delta > 0 ? "bg-up" : delta < 0 ? "bg-down" : "bg-faint";
  return (
    <div className="flex flex-col items-end gap-[5px]">
      <span className={cn("flex items-center justify-end gap-1.5", tone)}>
        <span className="text-[9px] leading-none">{delta > 0 ? "▲" : delta < 0 ? "▼" : "—"}</span>
        <span className="num text-[13.5px] font-bold">{delta === 0 ? "no change" : signed(delta)}</span>
      </span>
      <Bar pct={pct} width="w-[104px]" className={fill} />
    </div>
  );
}

/**
 * Places gained or lost on the power board. Replaces the old bare signed integer, where "+3" read
 * as a gain but meant a three-place drop — `move` is already sign-corrected by buildRosterRows.
 *
 * Null renders an em dash (no prior observation); zero renders a literal "0" (observed, did not
 * move). Two greyed dashes would be the same cell to a reader.
 */
export function MoveCell({ move }: { move: number | null }) {
  if (move === null) return <span className="text-faint">—</span>;
  if (move === 0) return <span className="num text-[11.5px] text-faint">0</span>;
  const up = move > 0;
  return (
    <span
      className={cn(
        "num inline-flex h-[22px] min-w-[44px] items-center justify-center gap-[3px] whitespace-nowrap rounded-[6px] px-[7px] text-[11.5px] font-bold",
        up ? "bg-up/10 text-up" : "bg-down/10 text-down",
      )}
    >
      <span className="text-[9px] leading-none">{up ? "▲" : "▼"}</span>
      {Math.abs(move)}
    </span>
  );
}

/**
 * Inverted emphasis: Active is the normal state and wears no chip, so the handful of at-risk rows
 * are the only thing shouting. 86 saturated green badges drowned them out before.
 */
export function StatusCell({ status }: { status: RosterStatus }) {
  if (status === "unknown") return <span className="text-[12.5px] text-faint">—</span>;
  if (status === "at-risk") {
    return (
      <span className="inline-flex h-[22px] items-center gap-1.5 rounded-[6px] border border-warn/20 bg-warn/10 py-0 pl-[7px] pr-[9px] text-[11.5px] font-bold text-warn">
        <span className="size-1.5 shrink-0 rounded-full bg-warn" />
        At risk
      </span>
    );
  }
  const inactive = status === "inactive";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11.5px]",
        inactive ? "font-semibold text-faint" : "font-medium text-muted",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", inactive ? "bg-faint" : "bg-up")} />
      {inactive ? "Inactive" : "Active"}
    </span>
  );
}

/**
 * The four headline numbers, over the LIVE roster (summarizeRoster excludes deactivated members).
 *
 * `powerDelta` is Σ of per-member changes measured over DIFFERENT spans — each member against their
 * own last observation. The sub-label says so; there is no single previous-capture date to name.
 * The at-risk tile only goes orange when there is something to be alarmed about.
 */
export function RosterStats({ summary }: { summary: RosterSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="Alliance power"
        value={summary.totalPower.toLocaleString()}
        sub={`${summary.tracked} active member${summary.tracked === 1 ? "" : "s"}`}
      />
      <StatCard
        label="Δ power"
        value={<span className={summary.powerDelta >= 0 ? "text-up" : "text-down"}>{signed(summary.powerDelta)}</span>}
        sub="vs. each member's last capture"
      />
      <StatCard
        label="Gained / dropped"
        value={
          <>
            <span className="text-up">{summary.gained}</span>
            <span className="px-1.5 text-[18px] font-semibold text-faint">/</span>
            <span className="text-down">{summary.dropped}</span>
          </>
        }
        sub="members by power change"
      />
      <StatCard
        label="At risk"
        value={summary.atRisk}
        sub="below 50% attendance"
        tone={summary.atRisk > 0 ? "warn" : "default"}
      />
    </div>
  );
}

/** Not decoration — it is what makes the colour coding legible to an admin who visits once a week. */
export function RosterLegend({ shown }: { shown: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background px-4 py-2.5 text-[11.5px] text-faint">
      <span>{shown} shown</span>
      <div className="flex flex-wrap items-center gap-3.5">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-up" />
          Active
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-warn" />
          At risk — under 50% attendance
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-faint" />
          Inactive
        </span>
        <span>MOVE = places gained/lost in power rank</span>
      </div>
    </div>
  );
}

/** Inactive rows recede. */
export function rowClass(row: RosterRow): string {
  return row.status === "inactive" ? "opacity-60" : "";
}

/**
 * The at-risk left edge, scannable down the whole table. It goes on the row's FIRST CELL, not the
 * row: `Table` sets `border-collapse: collapse` (ui/table.tsx:8), and in the collapsing-border model
 * browsers do not paint box-shadow on row boxes at all — on the `<tr>` this marker is invisible.
 */
export function riskEdgeClass(row: RosterRow): string {
  return row.status === "at-risk" ? "[box-shadow:inset_3px_0_0_var(--color-warn)]" : "";
}
