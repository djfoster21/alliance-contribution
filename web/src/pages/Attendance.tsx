import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp } from "lucide-react";
import { DEFAULT_RANK_BANDS, type RankBands } from "@shared/types";
import type { ActivityType, Attendance as AttendanceData } from "@shared/types";
import { api } from "@/lib/api";
import { useApi, firstError } from "@/lib/useApi";
import { attendanceSummary } from "@/lib/overview-derive";
import { assignBands, BAND_EDGE_CLASS, BAND_EXPECTED_RANK, BAND_ROW_CLASS } from "@/lib/alliance-rank";
import { BandLegend } from "@/components/BandLegend";
import { cn } from "@/lib/utils";
import { RankingScopeToggle, type RankingScope } from "@/components/RankingScopeToggle";
import { RankByActivity } from "@/components/RankByActivity";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
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
import { Avatar } from "@/components/ui/avatar";
import { AllianceRankBadge } from "@/components/AllianceRankBadge";
import { LoadingState, ErrorState, EmptyState } from "@/components/States";

// Nothing to fetch until the week picker has resolved: with no week the endpoint means "all-time", so
// firing it under the weekly scope would flash the season board. Reads as "no events in scope".
const NO_SCOPE: AttendanceData = { total_event_days: 0, rows: [] };

/** Traffic-light threshold on pct×100: green ≥ 80, amber ≥ 50, red < 50. Color is the ONLY varying signal. */
function thresholdColor(pctInt: number): string {
  if (pctInt >= 80) return "var(--color-up)";
  if (pctInt >= 50) return "var(--color-warn)";
  return "var(--color-down)";
}

/** Signed percentage-point change vs the prior event-week. Rendered only when the API sent the
 *  field (weekly view). null / ±0pp both read as "no change" (em dash). */
function DeltaPct({ delta }: { delta: number | null | undefined }) {
  if (delta === undefined) return null;
  const pp = delta === null ? 0 : Math.round(delta * 100);
  if (pp === 0) return <span className="num ml-1.5 text-[11px] text-muted">—</span>;
  const up = pp > 0;
  return (
    <span
      className={cn(
        "num ml-1.5 inline-flex items-center gap-0.5 text-[11px] font-semibold",
        up ? "text-up" : "text-down",
      )}
      title="Change vs previous event week (percentage points)"
    >
      {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {Math.abs(pp)}pp
    </span>
  );
}

export function Attendance() {
  const [scope, setScope] = useState<RankingScope>("overall");
  const [week, setWeek] = useState<string | null>(null);
  const [activity, setActivity] = useState("all"); // "all" | activity.key
  const [hideLeadership, setHideLeadership] = useState(false);

  const weeksState = useApi(() => api.weeks(), []);
  const activitiesState = useApi<ActivityType[]>(() => api.activityTypes.list({ active: true }), []);

  // Default to the latest week once available.
  useEffect(() => {
    if (week === null && weeksState.data && weeksState.data.length > 0) {
      setWeek(weeksState.data[0]);
    }
  }, [week, weeksState.data]);

  const activities = useMemo(
    () => (activitiesState.data ?? []).slice().sort((a, b) => a.sort - b.sort),
    [activitiesState.data],
  );

  const weekly = scope === "weekly";
  const activityParam = activity === "all" ? undefined : activity;
  const attendanceState = useApi<AttendanceData>(
    () => (weekly && !week ? Promise.resolve(NO_SCOPE) : api.attendance(weekly ? week! : undefined, activityParam)),
    [scope, week, activity],
  );
  // Deliberately outside firstError/busy: bands are cosmetic, so a slow or failed settings
  // fetch falls back to DEFAULT_RANK_BANDS rather than blocking the board.
  const bandsState = useApi<RankBands>(() => api.settings.rankBands(), []);
  const bandsCfg = bandsState.data ?? DEFAULT_RANK_BANDS;
  const data = attendanceState.data;
  const rows = data?.rows ?? [];
  // value = attended count: `total` is one scalar for the whole board, so attended orders and
  // ties identically to the pct the server sorts by.
  const bands = useMemo(
    () => assignBands(rows.map((r) => ({ alliance_rank: r.alliance_rank, value: r.attended })), bandsCfg),
    [rows, bandsCfg],
  );
  // Bands are assigned on the FULL list first — hiding R4/R5 must not shift who counts as top-N
  // (it can't anyway, leadership is uncounted, but pairing row+band before filtering keeps it that way).
  const visible = useMemo(
    () =>
      rows
        .map((row, i) => ({ row, band: bands[i] }))
        .filter((p) => !hideLeadership || p.band !== "leadership"),
    [rows, bands, hideLeadership],
  );
  // Server returns active members only (attendanceCounts filters on m.active = 1). Tiles follow the
  // toggle: with R4/R5 hidden they describe the members the boards are judging.
  const summary = attendanceSummary(visible.map((p) => p.row));
  // Guards the zero-event case: with a populated roster and no events every member reads 0%, so the
  // tiles would announce the whole roster as at risk. Not derivable from rows.length.
  const hasEvents = (data?.total_event_days ?? 0) > 0;
  const hasRoster = rows.length > 0;

  const error = firstError(weeksState, activitiesState, attendanceState);
  const busy = attendanceState.loading || activitiesState.loading;

  return (
    <div className="flex flex-col gap-4">
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
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-secondary">
          <Checkbox checked={hideLeadership} onCheckedChange={(v) => setHideLeadership(v === true)} />
          Hide R4/R5
        </label>
      </div>

      <div>
        <RankByActivity value={activity} onChange={setActivity} activities={activities} label="Filter by" />
      </div>

      {data && (
        <div className="flex justify-end">
          <span className="num text-[12px] text-muted">{data.total_event_days} event days</span>
        </div>
      )}

      {/* Both conditions are load-bearing: events with an all-unmapped ingest gives rows: [] at
          total_event_days > 0, which would stack "Avg 0% / Perfect 0 / At risk 0" on top of an
          empty table. */}
      {hasEvents && hasRoster && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="p-[18px]">
            <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.04em] text-faint">
              Avg attendance
            </div>
            <div className="num mt-1.5 text-[26px] font-bold tracking-[-0.02em] text-foreground">
              {Math.round(summary.avgPct * 100)}%
            </div>
          </Card>
          <Card className="p-[18px]">
            <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.04em] text-faint">
              Perfect (100%)
            </div>
            <div className="num mt-1.5 text-[26px] font-bold tracking-[-0.02em] text-foreground">
              {summary.perfect}
            </div>
          </Card>
          <Card className="p-[18px]">
            <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.04em] text-faint">
              At risk (&lt;50%)
            </div>
            <div className="num mt-1.5 text-[26px] font-bold tracking-[-0.02em] text-risk-fg">
              {summary.atRisk}
            </div>
          </Card>
        </div>
      )}

      {/* Tied to the same pair as the tiles above, not just hasRoster — filtering can leave a
          populated roster with zero events in scope, and the table renders an empty state then too. */}
      {hasEvents && hasRoster && (
        <>
          <div className="flex flex-wrap items-center justify-end gap-4 text-[12px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-3.5 rounded border border-good-border bg-good-bg" />
              ≥80% Good
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3.5 rounded border border-watch-border bg-watch-bg" />
              50–79% Watch
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3.5 rounded border border-risk-border bg-risk-bg" />
              &lt;50% At risk
            </span>
          </div>
          <BandLegend bands={bandsCfg} />
        </>
      )}

      <Card className="overflow-hidden">
        {error ? (
          <div className="p-4">
            <ErrorState message={error} />
          </div>
        ) : busy ? (
          <LoadingState />
        ) : !hasRoster ? (
          <EmptyState message="No attendance recorded yet." />
        ) : !hasEvents ? (
          <EmptyState message={weekly ? "No events recorded for this week." : "No events recorded yet."} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Governor</TableHead>
                <TableHead className="w-[110px]">Alliance Rank</TableHead>
                <TableHead className="w-[45%]">Attendance</TableHead>
                <TableHead className="text-right">Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map(({ row, band }) => {
                const pctInt = row.total > 0 ? Math.round(row.pct * 100) : 0;
                const color = thresholdColor(pctInt);
                return (
                  <TableRow key={row.member_id} className={BAND_ROW_CLASS[band]}>
                    <TableCell className={BAND_EDGE_CLASS[band]}>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={row.governor} size={24} />
                        <Link
                          to={`/members/${row.member_id}`}
                          className="font-medium text-foreground transition-colors hover:text-accent"
                        >
                          {row.governor}
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell>
                      <AllianceRankBadge rank={row.alliance_rank} expected={BAND_EXPECTED_RANK[band]} />
                    </TableCell>
                    <TableCell>
                      <Progress
                        value={pctInt}
                        indicatorClassName="rounded-full"
                        indicatorStyle={{ backgroundColor: color }}
                        className="h-1.5 w-full"
                      />
                    </TableCell>
                    <TableCell className="num text-right">
                      <span className="font-semibold" style={{ color }}>
                        {pctInt}%
                      </span>
                      <span className="ml-1.5 text-muted">
                        {row.attended}/{row.total}
                      </span>
                      <DeltaPct delta={row.delta} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
