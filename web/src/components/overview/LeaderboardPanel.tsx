import { Link } from "react-router-dom";
import type { WeeklyRankingRow } from "@shared/types";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/States";
import { MEDALS, Movement, ScoreCell } from "@/components/ranking-parts";
import { AllianceRankBadge } from "@/components/AllianceRankBadge";

/**
 * Top of this week's leaderboard. Rows arrive pre-sliced and already rank-sorted by the API; this
 * component never re-sorts. `possible` scales every bar to the same denominator.
 *
 * `hasEvents` is the only signal for "no board this week" — weekly boards are roster-seeded, so a
 * populated `rows` at score 0 is exactly what a week with no events looks like (see WeeklyRanking in
 * shared/types.ts). Branching the empty state on `rows.length` would render a medalled podium for a
 * week in which nothing happened.
 *
 * Medalled rows carry no row tint: the gold tint is invisible against the light-mode card, and
 * applying it to silver and bronze rows fought their own badge colour. The rank badge and the bar
 * carry the medal colour on their own.
 */
export function LeaderboardPanel({
  rows,
  possible,
  rankedCount,
  hasEvents,
}: {
  rows: WeeklyRankingRow[];
  possible: number;
  rankedCount: number;
  hasEvents: boolean;
}) {
  return (
    <Card className="p-[18px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">Top of the leaderboard</h2>
          {/* Same roster-seeded trap as the empty state below: rows.length is the full roster even
              in a week with no events, so an ungated subtitle reads "86 governors ranked" directly
              above "No ranked week yet". */}
          {hasEvents && (
            <p className="mt-0.5 text-[12px] text-muted">
              This week · <span className="num">{rankedCount}</span> governors ranked
            </p>
          )}
        </div>
        <Button asChild size="sm">
          <Link to="/rankings">View full ranking →</Link>
        </Button>
      </div>

      {!hasEvents ? (
        <EmptyState message="No ranked week yet — the leaderboard fills in once events are logged." />
      ) : (
        <ul className="mt-4 flex flex-col">
          {rows.map((row) => {
            const medal = MEDALS[row.rank];
            return (
              <li
                key={row.member_id}
                className="flex items-center gap-3 border-t border-border py-3 first:border-t-0"
              >
                <span
                  className="num flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                  style={{
                    background: medal ? medal.badgeBg : "var(--color-muted-surface)",
                    color: medal ? medal.badgeFg : "var(--color-muted)",
                  }}
                >
                  <span className="sr-only">Rank</span>
                  {row.rank}
                </span>
                <Avatar name={row.governor} size={28} />
                <Link
                  to={`/members/${row.member_id}`}
                  title={row.governor}
                  className="min-w-0 flex-1 truncate text-[14px] font-semibold hover:underline"
                >
                  {row.governor}
                </Link>
                <AllianceRankBadge rank={row.alliance_rank} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  {/* ScoreCell renders a bare integer next to a bar — name what the number is. */}
                  <span className="sr-only">Score</span>
                  <ScoreCell score={row.score} possible={possible} barColor={medal?.bar} />
                </div>
                <span className="w-10 shrink-0 text-right">
                  <Movement value={row.movement} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
