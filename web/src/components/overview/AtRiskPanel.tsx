import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { AttendanceBadge } from "@/components/AttendanceBadge";
import { EmptyState } from "@/components/States";
import type { AttendanceLike } from "@/lib/overview-derive";

/**
 * Members below the 50% attendance line, worst first.
 *
 * Invariant: `total` is the full count below the line and `rows` is a slice of it, so
 * `total >= rows.length`. The empty state branches on `total` so the subtitle and the empty state
 * can never contradict.
 */
export function AtRiskPanel({ rows, total }: { rows: AttendanceLike[]; total: number }) {
  return (
    <Card className="p-[18px]">
      <h2 className="text-[15px] font-semibold">At-risk attendance</h2>
      <p className="mt-0.5 text-[12px] text-muted">
        <span className="num">{total}</span> {total === 1 ? "member" : "members"} below 50%
      </p>

      {total === 0 ? (
        <EmptyState message="Nobody is below 50% attendance." />
      ) : (
        <ul className="mt-3 flex flex-col">
          {rows.map((row) => (
            <li
              key={row.member_id}
              className="flex items-center gap-3 border-t border-border py-2.5 first:border-t-0"
            >
              <Avatar name={row.governor} size={26} />
              <Link
                to={`/members/${row.member_id}`}
                title={row.governor}
                className="min-w-0 flex-1 truncate text-[14px] hover:underline"
              >
                {row.governor}
              </Link>
              {/* AttendanceBadge renders a bare "14%"; without this the row announces the number
                  with nothing saying what it measures. Labelled here, not in the shared badge. */}
              <span className="sr-only">Attendance</span>
              <AttendanceBadge pct={row.pct} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
