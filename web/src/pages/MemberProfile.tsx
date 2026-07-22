import { useMemo } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type {
  ActivityType,
  Alias,
  Attendance,
  MemberProfile as MemberProfileData,
  MemberSnapshotSeries,
  OverallRanking,
} from "@shared/types";
import { api, ApiError } from "@/lib/api";
import { useApi, firstError } from "@/lib/useApi";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar } from "@/components/ui/avatar";
import { AllianceRankBadge } from "@/components/AllianceRankBadge";
import { PowerHistoryCard } from "@/components/PowerHistoryCard";
import { LoadingState, ErrorState, EmptyState } from "@/components/States";
import { activitySolidClass, activityFillVar } from "@/lib/activity";

/** Monday (week-start) date of an ISO "YYYY-Www" label, or null if unparseable. */
function isoWeekStart(w: string): Date | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(w);
  if (!m) return null;
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4));
  const jan4Mon = (jan4.getUTCDay() + 6) % 7; // Mon=0
  const d = new Date(jan4);
  d.setUTCDate(jan4.getUTCDate() - jan4Mon + (Number(m[2]) - 1) * 7);
  return d;
}

/** "2026-W22" -> "May 25". Falls back to the raw label if not an ISO week. */
function weekLabel(w: string): string {
  const d = isoWeekStart(w);
  return d
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : w;
}

/**
 * Bar dataKey for an activity. Activity keys are user-created at runtime, so they are namespaced
 * to keep one (e.g. a key literally named "label") from clobbering the chart's own X-axis key.
 */
function barKey(activityKey: string): string {
  return `a:${activityKey}`;
}

/** A single stat card — mono uppercase label over a large tabular value. */
function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub: React.ReactNode }) {
  return (
    <Card className="p-[18px]">
      <div className="mb-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.04em] text-faint">
        {label}
      </div>
      <div className="num text-[26px] font-bold leading-none tracking-[-0.02em]">{value}</div>
      <div className="mt-1.5 text-[11.5px] text-faint">{sub}</div>
    </Card>
  );
}

type CompTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: { name?: string; value?: number; color?: string }[];
};

/** Composition tooltip: week label over each activity's points that week. */
function CompTooltip({ active, payload, label }: CompTooltipProps) {
  if (!active || !payload?.length) return null;
  const shown = payload.filter((p) => (p.value ?? 0) > 0);
  return (
    <div className="rounded-[8px] border border-border bg-surface px-2.5 py-1.5 shadow-md">
      <div className="num mb-1 text-[11px] text-muted">{label}</div>
      {shown.map((p) => (
        <div key={p.name} className="flex items-center gap-1.5 text-[12px]">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted">{p.name}</span>
          <span className="num ml-auto font-semibold text-foreground">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function MemberProfile() {
  const { id } = useParams();
  const memberId = Number(id);

  // A 404 is a legitimate outcome (bad URL / removed member), not a fetch failure — resolve it to
  // null so the not-found copy stays reserved for that case and real errors surface their message.
  const profileState = useApi<MemberProfileData | null>(
    () =>
      api.members.profile(memberId).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }),
    [memberId],
  );
  // ALL activity types, not just active ones: totals/perActivity cover deactivated activities too,
  // so the breakdown has to as well or it won't sum to the headline score.
  const activitiesState = useApi<ActivityType[]>(() => api.activityTypes.list(), []);
  const attendanceState = useApi<Attendance>(() => api.attendance(), []);
  const aliasesState = useApi<Alias[]>(() => api.aliases.list({ member_id: memberId }), [memberId]);
  const rankingState = useApi<OverallRanking>(() => api.rankings.overall(), []);
  // Same 404-is-an-answer handling as the profile fetch above: a bad member URL 404s BOTH endpoints,
  // and letting this one reach firstError would replace the "Member not found." copy with a raw error.
  const snapshotsState = useApi<MemberSnapshotSeries | null>(
    () =>
      api.members.snapshots(memberId).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }),
    [memberId],
  );

  const activities = useMemo(
    () => (activitiesState.data ?? []).slice().sort((a, b) => a.sort - b.sort),
    [activitiesState.data],
  );

  const profile = profileState.data;
  const attendanceRow = attendanceState.data?.rows.find((r) => r.member_id === memberId);
  const rank = rankingState.data?.rows.find((r) => r.member_id === memberId)?.rank ?? null;
  const aliases = aliasesState.data ?? [];

  const error = firstError(profileState, activitiesState, attendanceState, aliasesState, rankingState, snapshotsState);

  if (
    profileState.loading ||
    activitiesState.loading ||
    attendanceState.loading ||
    aliasesState.loading ||
    rankingState.loading ||
    snapshotsState.loading
  ) {
    return <LoadingState />;
  }
  if (error) return <ErrorState message={error} />;
  if (!profile) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Card className="overflow-hidden">
          <EmptyState message="Member not found." />
        </Card>
      </div>
    );
  }

  const { member, totals, perActivity, series } = profile;
  const attendancePct =
    attendanceRow && attendanceRow.total > 0 ? Math.round(attendanceRow.pct * 100) : null;
  const weeklyAvg =
    series.length > 0
      ? Math.round(series.reduce((sum, s) => sum + s.score, 0) / series.length)
      : null;
  const scoredCount = activities.filter((a) => (perActivity[a.key]?.points ?? 0) > 0).length;
  const maxActivityPoints = Math.max(1, ...activities.map((a) => perActivity[a.key]?.points ?? 0));
  const chartData = series.map((s) => ({
    label: weekLabel(s.week),
    ...Object.fromEntries(Object.entries(s.byActivity).map(([key, points]) => [barKey(key), points])),
  }));

  return (
    <div className="flex flex-col gap-4">
      <BackLink />

      {/* Hero */}
      <Card className="flex flex-wrap items-start gap-[18px] p-[22px]">
        <Avatar name={member.governor} size={72} tone="dark" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[22px] font-bold tracking-[-0.01em]">{member.governor}</span>
            <AllianceRankBadge rank={member.alliance_rank} />
            <Badge variant="neutral">CANONICAL</Badge>
            {member.active === 0 && <Badge variant="warn">Inactive</Badge>}
          </div>
          {aliases.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-muted">Known aliases:</span>
              {aliases.map((a) => (
                <span
                  key={a.id}
                  className="rounded-[6px] bg-foreground px-1.5 py-0.5 font-mono text-[11px] text-accent-foreground"
                >
                  {a.alias}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
            Score Rank
          </div>
          <div className="num text-[34px] font-bold leading-none tracking-[-0.02em]">
            {rank !== null ? `#${rank}` : "—"}
          </div>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Stat
          label="Total Score"
          value={totals.score.toLocaleString()}
          sub={`across ${scoredCount} activit${scoredCount === 1 ? "y" : "ies"}`}
        />
        <Stat
          label="Weekly Avg"
          value={weeklyAvg ?? "—"}
          sub={`last ${series.length} week${series.length === 1 ? "" : "s"}`}
        />
        <Stat
          label="Attendance"
          value={attendancePct !== null ? `${attendancePct}%` : "—"}
          sub={attendanceRow ? `${attendanceRow.attended}/${attendanceRow.total} event-days` : "no data"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* Score composition */}
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-[14px] font-semibold">Score composition</div>
              <div className="text-[12px] text-muted">
                Weekly points by activity, last {series.length} weeks
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {activities.map((a) => (
                <span key={a.id} className="flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="size-2 rounded-full" style={{ background: activityFillVar(a.color) }} />
                  {a.name}
                  {a.active === 0 && <span className="text-faint">· inactive</span>}
                </span>
              ))}
            </div>
          </div>
          {series.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-muted">No composition data yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={230} className="mt-3">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 4" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="var(--color-border)"
                  tickLine={false}
                  tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--color-muted)" }}
                />
                <YAxis
                  stroke="var(--color-border)"
                  tickLine={false}
                  width={40}
                  allowDecimals={false}
                  tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--color-muted)" }}
                />
                <Tooltip content={<CompTooltip />} cursor={{ fill: "var(--color-muted-surface)" }} />
                {activities.map((a, i) => (
                  <Bar
                    key={a.key}
                    dataKey={barKey(a.key)}
                    name={a.name}
                    stackId="s"
                    fill={activityFillVar(a.color)}
                    maxBarSize={34}
                    radius={i === activities.length - 1 ? [3, 3, 0, 0] : undefined}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Score by activity */}
        <Card className="p-5">
          <div className="mb-3.5 text-[14px] font-semibold">Score by activity</div>
          {activities.map((activity) => {
            const stat = perActivity[activity.key] ?? { points: 0, appearances: 0 };
            const barW = Math.round((stat.points / maxActivityPoints) * 100);
            return (
              <div key={activity.id} className="mb-4 last:mb-0">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: activityFillVar(activity.color) }}
                    />
                    {activity.name}
                    {activity.active === 0 && (
                      <span className="text-[11px] font-normal text-faint">inactive</span>
                    )}
                  </span>
                  <span className="num text-[13px] font-semibold">
                    {stat.points} <span className="text-[11px] font-normal text-faint">pts</span>
                  </span>
                </div>
                <Progress
                  value={barW}
                  indicatorClassName={activitySolidClass(activity.color)}
                  className="h-2 rounded-full bg-background"
                />
                <div className="mt-1.5 text-[11px] text-faint">
                  {stat.appearances} appearance{stat.appearances === 1 ? "" : "s"}
                </div>
              </div>
            );
          })}
        </Card>
      </div>

      {snapshotsState.data && <PowerHistoryCard series={snapshotsState.data} />}
    </div>
  );
}

/**
 * Where "back" goes. Eight places link into this profile; only the admin roster tags itself, because
 * it is the only one whose list does not live at /members — sending an admin mid-review back to the
 * public members page drops them out of the admin area entirely. Everything else falls through, and
 * so does a deep link or a page refresh, where there is no origin to honour.
 */
const ORIGINS: Record<string, { to: string; label: string }> = {
  roster: { to: "/admin/roster", label: "Back to roster" },
};

const DEFAULT_ORIGIN = { to: "/members", label: "Back to members" };

function BackLink() {
  const state = useLocation().state as { from?: string } | null;
  const origin = (state?.from && ORIGINS[state.from]) || DEFAULT_ORIGIN;
  return (
    <Link
      to={origin.to}
      className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" />
      {origin.label}
    </Link>
  );
}
