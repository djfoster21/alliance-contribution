import { api } from "@/lib/api";
import { useApi, firstError } from "@/lib/useApi";
import { useApiKey } from "@/lib/apiKey";
import { LoadingState, ErrorState } from "@/components/States";
import { StatCard } from "@/components/overview/StatCard";
import { LeaderboardPanel } from "@/components/overview/LeaderboardPanel";
import { UnmappedPanel } from "@/components/overview/UnmappedPanel";
import { AtRiskPanel } from "@/components/overview/AtRiskPanel";
import { RecentIngestsPanel } from "@/components/overview/RecentIngestsPanel";
import { activeRows, attendanceSummary, atRiskMembers, recentEvents } from "@/lib/overview-derive";

const LEADERS = 5;
const UNMAPPED_SHOWN = 5;
const AT_RISK_SHOWN = 4;
const INGESTS_SHOWN = 5;

export function Overview() {
  const { role } = useApiKey();
  // Viewers get 403 on /admin/*, so the links that lead there are hidden for them.
  const canManage = role === "admin" || role === "manager";

  const overview = useApi(() => api.overview(), []);
  const attendance = useApi(() => api.attendance(), []);
  const ranking = useApi(() => api.rankings.weekly(), []);
  const unmapped = useApi(() => api.unmapped(), []);
  const events = useApi(() => api.events.list(), []);
  const activities = useApi(() => api.activityTypes.list(), []);

  const states = [overview, attendance, ranking, unmapped, events, activities];
  // Error before loading, deliberately: firstError surfaces a failed call even while a slower
  // sibling is still in flight, so a dead endpoint reports instead of hanging on the spinner.
  const error = firstError(...states);

  if (error) return <ErrorState message={error} />;
  if (states.some((s) => s.loading)) return <LoadingState />;
  if (
    !overview.data ||
    !attendance.data ||
    !ranking.data ||
    !unmapped.data ||
    !events.data ||
    !activities.data
  ) {
    // Reachable: api.ts resolves an empty 200/204 body to undefined, so a proxy hiccup lands here.
    // Anything visible beats a blank page the user cannot describe.
    return (
      <ErrorState message="The dashboard loaded without data. Reload the page; if it keeps happening, check that /api is reachable." />
    );
  }

  // Soft-deleted members stay in /api/attendance at whatever attendance they had when they left, and
  // they are structurally the worst attenders — filter once, before deriving anything from them.
  const active = activeRows(attendance.data.rows);
  // Before any event is ingested every member reads 0%, which would announce "86 at risk" on a fresh
  // install. The roster is populated, so attendanceSummary's empty guard does not catch it.
  const hasEvents = attendance.data.total_event_days > 0;

  const summary = attendanceSummary(active);
  const atRisk = hasEvents ? atRiskMembers(active, AT_RISK_SHOWN) : [];
  const leaders = ranking.data.rows.slice(0, LEADERS);
  const unmappedNames = unmapped.data.slice(0, UNMAPPED_SHOWN).map((row) => row.raw_name);
  const ingests = recentEvents(events.data, INGESTS_SHOWN);

  return (
    <div className="flex flex-col gap-4">
      {overview.data.latestWeek && (
        <div className="flex justify-end">
          <span className="num text-[12px] text-muted">Latest week {overview.data.latestWeek}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active members"
          value={overview.data.activeMembers.toLocaleString()}
          sub={
            <>
              of <span className="num">{overview.data.members.toLocaleString()}</span> tracked
            </>
          }
        />
        {/* "(active)" is load-bearing: Attendance.tsx shows the same figure roster-wide, so the two
            pages would otherwise display different numbers under identical labels. */}
        <StatCard
          label="Avg attendance (active)"
          value={hasEvents ? `${Math.round(summary.avgPct * 100)}%` : "—"}
          sub={
            hasEvents ? (
              <>
                <span className="num">{summary.perfect}</span> perfect ·{" "}
                <span className="num">{summary.atRisk}</span> at risk
              </>
            ) : (
              "no events recorded yet"
            )
          }
        />
        <StatCard
          label="Events logged"
          value={overview.data.events.toLocaleString()}
          sub={
            <>
              across <span className="num">{overview.data.eventDays.toLocaleString()}</span>{" "}
              event-days
            </>
          }
        />
        <StatCard
          label="Unmapped queue"
          value={overview.data.unmappedNames.toLocaleString()}
          sub="names need a decision"
          tone={overview.data.unmappedNames > 0 ? "warn" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <LeaderboardPanel
          rows={leaders}
          possible={ranking.data.possible}
          rankedCount={ranking.data.rows.length}
          hasEvents={ranking.data.hasEvents}
        />
        <div className="flex flex-col gap-4">
          {/* Both props come off the same /api/unmapped response so the slice can never outrun the
              total — mixing in overview.data.unmappedNames would let a concurrent ingest render
              "0 names need mapping" over a populated list. */}
          <UnmappedPanel names={unmappedNames} total={unmapped.data.length} canManage={canManage} />
          <AtRiskPanel rows={atRisk} total={hasEvents ? summary.atRisk : 0} />
        </div>
      </div>

      <RecentIngestsPanel events={ingests} activities={activities.data} canManage={canManage} />
    </div>
  );
}
