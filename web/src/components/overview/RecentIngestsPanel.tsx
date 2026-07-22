import { Link } from "react-router-dom";
import type { ActivityType, EventListRow } from "@shared/types";
import { DEFAULT_ACTIVITY_COLOR } from "@shared/colors";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/States";
import { activityBadgeClass } from "@/lib/activity";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * The newest event ingests. `rows` and `unmapped` are aggregated by the events endpoint; the
 * activity name and colour are joined here from the activity-type list rather than denormalised
 * into the event payload.
 */
export function RecentIngestsPanel({
  events,
  activities,
  canManage,
}: {
  events: EventListRow[];
  activities: ActivityType[];
  canManage: boolean;
}) {
  const byId = new Map(activities.map((a) => [a.id, a]));

  return (
    <Card className="p-[18px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">Recent ingests</h2>
          <p className="mt-0.5 text-[12px] text-muted">Latest event uploads</p>
        </div>
        {canManage && (
          <Button asChild variant="secondary" size="sm">
            <Link to="/admin/events">View all events →</Link>
          </Button>
        )}
      </div>

      {events.length === 0 ? (
        <EmptyState message="No events ingested yet." />
      ) : (
        <Table className="mt-4">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Date</TableHead>
              <TableHead>Activity</TableHead>
              <TableHead>Inst.</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead className="text-right">Unmapped</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => {
              const activity = byId.get(event.activity_type_id);
              return (
                <TableRow key={event.id}>
                  <TableCell className="num whitespace-nowrap">{event.date}</TableCell>
                  <TableCell>
                    <Badge
                      className={cn(
                        "whitespace-nowrap",
                        activityBadgeClass(activity?.color ?? DEFAULT_ACTIVITY_COLOR),
                      )}
                    >
                      {activity?.name ?? "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="num">#{event.instance}</TableCell>
                  <TableCell className="num text-right">{event.rows}</TableCell>
                  <TableCell className="num text-right">
                    {event.unmapped > 0 ? (
                      <span className="rounded-[4px] bg-warn/10 px-1.5 py-0.5 font-semibold text-warn">
                        {event.unmapped}
                      </span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
