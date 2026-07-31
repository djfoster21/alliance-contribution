import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ActivityType,
  OverallRanking as OverallRankingData,
  WeeklyRanking as WeeklyRankingData,
  WeeklyRankingRow,
} from "@shared/types";
import { api } from "@/lib/api";
import { useApi, firstError } from "@/lib/useApi";
import { RankingScopeToggle, type RankingScope } from "@/components/RankingScopeToggle";
import { RankByActivity } from "@/components/RankByActivity";
import { AttendanceBadge } from "@/components/AttendanceBadge";
import { AllianceRankBadge } from "@/components/AllianceRankBadge";
import { MEDALS, Movement, PodiumCard, ScoreCell } from "@/components/ranking-parts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LoadingState, ErrorState, EmptyState } from "@/components/States";

// CSS order classes for responsive podium: at md+ restores desktop arrangement (4th, 2nd, 1st, 3rd, 5th).
// Below md uses DOM order (rank 1 first).
const PODIUM_ORDER_CLASSES = ["md:order-3", "md:order-2", "md:order-4", "md:order-1", "md:order-5"];

export function Ranking({ initialScope = "overall" }: { initialScope?: RankingScope }) {
  const [scope, setScope] = useState<RankingScope>(initialScope);
  const [week, setWeek] = useState<string | null>(null);
  const [activity, setActivity] = useState("all"); // "all" | activity.key

  const weeksState = useApi(() => api.weeks(), []);
  const activitiesState = useApi<ActivityType[]>(() => api.activityTypes.list({ active: true }), []);

  // Default to the latest week once available.
  useEffect(() => {
    if (week === null && weeksState.data && weeksState.data.length > 0) {
      setWeek(weeksState.data[0]);
    }
  }, [week, weeksState.data]);

  const activityParam = activity === "all" ? undefined : activity;

  const rankingState = useApi<WeeklyRankingData | OverallRankingData>(
    () =>
      scope === "weekly"
        ? api.rankings.weekly(week ?? undefined, activityParam)
        : api.rankings.overall(activityParam),
    [scope, week, activity],
  );

  const activities = useMemo(
    () => (activitiesState.data ?? []).slice().sort((a, b) => a.sort - b.sort),
    [activitiesState.data],
  );

  const weekly = scope === "weekly";
  // Overall rows lack `movement`; safe to widen because every `row.movement` read is gated behind
  // `weekly` (the Move column and PodiumCard's `showMovement={weekly}`), so it never runs on the overall board.
  const rows = (rankingState.data?.rows ?? []) as WeeklyRankingRow[];
  const possible = rankingState.data?.possible ?? 0;
  const scoreLabel = weekly ? "This-Week Score" : "Season Score";
  const activityLabel =
    activity === "all" ? "all activities" : (activities.find((a) => a.key === activity)?.name ?? activity);
  // Names the attendance column's scope — the original scoping bug existed because it was invisible.
  const attendanceScope = `Attendance: ${weekly ? "this week" : "season"} · ${activityLabel}`;
  // The weekly payload flags a week with no events of the selected activity; that is the only reliable
  // signal (`possible` is 0 for a tier-less activity, and boards are roster-seeded so rows are never empty).
  const noEvents = weekly && (rankingState.data as WeeklyRankingData | null)?.hasEvents === false;

  // Top-5 podium only when at least 5 members have scored; otherwise table-only.
  const top5 = rows.slice(0, 5);
  const showPodium = top5.length === 5 && top5.every((r) => r.score > 0);

  const error = firstError(weeksState, activitiesState, rankingState);
  const busy = rankingState.loading || activitiesState.loading;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <RankingScopeToggle value={scope} onChange={setScope} />
        {weekly ? (
          <Select value={week ?? undefined} onValueChange={setWeek} disabled={(weeksState.data ?? []).length === 0}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select week" />
            </SelectTrigger>
            <SelectContent>
              {(weeksState.data ?? []).map((w) => (
                <SelectItem key={w} value={w} className="num">
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="inline-flex items-center rounded-[8px] border border-border bg-muted-surface px-3 py-1.5 text-[13px] font-medium text-secondary">
            Season · all weeks combined
          </span>
        )}
        <span className="text-[12.5px] text-muted">{weekly ? "Movement vs previous week" : ""}</span>
      </div>

      <div>
        <RankByActivity value={activity} onChange={setActivity} activities={activities} />
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : busy ? (
        <Card className="overflow-hidden">
          <LoadingState />
        </Card>
      ) : noEvents || rows.length === 0 ? (
        <Card className="overflow-hidden">
          <EmptyState message={weekly ? "No participation recorded for this week." : "No participation recorded yet."} />
        </Card>
      ) : (
        <>
          {showPodium && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 items-end gap-4">
              {top5.map((row, i) => (
                <div key={row.member_id} className={PODIUM_ORDER_CLASSES[i]}>
                  <PodiumCard row={row} scoreLabel={scoreLabel} showMovement={weekly} />
                </div>
              ))}
            </div>
          )}

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-[18px] py-[15px]">
              <div>
                <div className="text-[14px] font-semibold">Full Standings</div>
                <div className="text-[12px] text-muted">
                  <span className="num">{rows.length}</span> members · {weekly ? "this week" : "overall"} · sorted by rank
                </div>
              </div>
              <Badge variant="neutral">Click any row → profile</Badge>
            </div>
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[70px]">Rank</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead className="w-[110px]">Alliance Rank</TableHead>
                  <TableHead className="w-[240px]">Score</TableHead>
                  <TableHead className="w-28 text-right" title={attendanceScope}>
                    Attendance
                  </TableHead>
                  {weekly && <TableHead className="w-24 text-right">Move</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const medal = MEDALS[row.rank];
                  return (
                    <TableRow key={row.member_id} className="cursor-pointer">
                      <TableCell>
                        <Link to={`/members/${row.member_id}`} className="block">
                          <Badge
                            className="num h-6 min-w-[26px] justify-center rounded-[6px] border-0 px-1.5 text-[13px] font-bold"
                            style={{
                              background: medal ? medal.badgeBg : "transparent",
                              color: medal ? medal.badgeFg : "var(--color-muted)",
                            }}
                          >
                            {row.rank}
                          </Badge>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link to={`/members/${row.member_id}`} className="flex items-center gap-2.5">
                          <Avatar name={row.governor} size={30} />
                          <span className="font-semibold text-foreground">{row.governor}</span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <AllianceRankBadge rank={row.alliance_rank} />
                      </TableCell>
                      <TableCell>
                        <ScoreCell score={row.score} possible={possible} barColor={medal?.bar} />
                      </TableCell>
                      <TableCell className="text-right">
                        <AttendanceBadge pct={row.attendance} />
                      </TableCell>
                      {weekly && (
                        <TableCell className="text-right">
                          <Movement value={row.movement} />
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
