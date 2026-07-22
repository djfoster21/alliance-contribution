import { Link } from "react-router-dom";
import { ArrowUp, ArrowDown } from "lucide-react";
import type { WeeklyRankingRow } from "@shared/types";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { AttendanceBadge } from "@/components/AttendanceBadge";
import { AllianceRankBadge } from "@/components/AllianceRankBadge";

/**
 * The three bar colors ScoreCell knows how to paint. Narrow on purpose: ScoreCell string-matches
 * these exact values, so renaming one here becomes a type error instead of silently degrading every
 * medal bar to the neutral fill.
 */
type MedalBar = "var(--color-gold)" | "var(--color-silver)" | "var(--color-bronze)";

/** Medal palette for the top 3 — the only color pops in an otherwise monochrome list. */
export const MEDALS: Record<number, { bar: MedalBar; badgeBg: string; badgeFg: string; card: string }> = {
  1: {
    bar: "var(--color-gold)",
    badgeBg: "var(--color-gold-bg)",
    badgeFg: "var(--color-gold-fg)",
    card: "border-gold bg-gradient-to-b from-[var(--color-gold-tint)] to-surface",
  },
  2: {
    bar: "var(--color-silver)",
    badgeBg: "var(--color-silver-bg)",
    badgeFg: "var(--color-silver-fg)",
    card: "border-silver bg-surface",
  },
  3: {
    bar: "var(--color-bronze)",
    badgeBg: "var(--color-bronze-bg)",
    badgeFg: "var(--color-bronze-fg)",
    card: "border-bronze bg-gradient-to-b from-[var(--color-bronze-tint)] to-surface",
  },
};

/** Movement = prevRank - rank. Positive → moved up (green); negative → down (red); 0/null → em dash. */
export function Movement({ value }: { value: number | null }) {
  if (value === null || value === 0) {
    return <span className="num text-muted">—</span>;
  }
  const up = value > 0;
  return (
    <span
      className={cn(
        "num inline-flex items-center justify-end gap-0.5 font-semibold",
        up ? "text-up" : "text-down",
      )}
    >
      {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {Math.abs(value)}
    </span>
  );
}

/** One podium card. Places 1–3 use the medal palette; 4–5 render neutral. Rank 1 is raised + larger. */
export function PodiumCard({
  row,
  scoreLabel,
  showMovement,
}: {
  row: WeeklyRankingRow;
  scoreLabel: string; // "Season Score" | "This-Week Score"
  showMovement: boolean;
}) {
  const m = MEDALS[row.rank]; // undefined for ranks 4 & 5
  const first = row.rank === 1;
  return (
    <Link
      to={`/members/${row.member_id}`}
      className={cn(
        "flex flex-col items-center rounded-[14px] border p-4 shadow-[0_2px_10px_rgba(0,0,0,0.05)] transition-transform hover:-translate-y-0.5",
        m ? m.card : "border-border bg-surface",
        first && "-translate-y-1.5 p-5",
      )}
    >
      <div
        className="flex size-[26px] items-center justify-center rounded-full font-mono text-[13px] font-bold"
        style={{
          background: m ? m.bar : "var(--color-muted-surface)",
          color: m ? "#fff" : "var(--color-muted)",
        }}
      >
        {row.rank}
      </div>
      <Avatar
        name={row.governor}
        size={first ? 64 : 52}
        className="mt-2.5"
        style={m ? { boxShadow: `0 0 0 2px ${m.bar}` } : undefined}
      />
      <div className={cn("mt-2.5 text-center font-semibold", first ? "text-[17px]" : "text-[15px]")}>
        {row.governor}
      </div>
      <AllianceRankBadge rank={row.alliance_rank} className="mt-1" />
      <div
        className={cn(
          "num text-center font-bold tracking-[-0.04em]",
          first ? "text-[40px]" : "text-[30px]",
        )}
      >
        {row.score}
      </div>
      <div className="text-center text-[11px] text-muted">{scoreLabel}</div>
      <div className="mt-3 flex items-center gap-5">
        <div className="flex flex-col items-center gap-1">
          <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
            Attend
          </span>
          <AttendanceBadge pct={row.attendance} />
        </div>
        {showMovement && (
          <div className="flex flex-col items-center gap-1">
            <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
              Move
            </span>
            <Movement value={row.movement} />
          </div>
        )}
      </div>
    </Link>
  );
}

/** Score cell: raw integer score with a bar filling score/possible. Bar color from medal, else neutral. */
export function ScoreCell({
  score,
  possible,
  barColor,
}: {
  score: number;
  possible: number;
  barColor?: MedalBar;
}) {
  const pct = possible > 0 ? Math.min(100, Math.round((score / possible) * 100)) : 0;
  const indicatorClassName =
    barColor === "var(--color-gold)"
      ? "bg-gold"
      : barColor === "var(--color-silver)"
        ? "bg-silver"
        : barColor === "var(--color-bronze)"
          ? "bg-bronze"
          : "bg-foreground";
  return (
    <div className="flex items-center gap-3">
      <span className="num w-8 text-[15px] font-bold">{score}</span>
      <Progress value={pct} className="h-1.5 flex-1" indicatorClassName={indicatorClassName} />
    </div>
  );
}
