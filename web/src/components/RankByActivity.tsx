import type { ActivityType } from "@shared/types";
import { cn } from "@/lib/utils";
import { activitySolidClass } from "@/lib/activity";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function RankByActivity({
  value,
  onChange,
  activities,
  label = "Rank by",
}: {
  value: string; // "all" | activity.key
  onChange: (value: string) => void;
  activities: ActivityType[];
  label?: string; // Attendance filters rather than ranks — same control, different verb.
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-faint">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            <span className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-full bg-badge-slate-fg" />
              All activities
            </span>
          </SelectItem>
          {activities.map((a) => (
            <SelectItem key={a.key} value={a.key}>
              <span className="flex items-center gap-2">
                <span className={cn("size-2 shrink-0 rounded-full", activitySolidClass(a.color))} />
                {a.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
