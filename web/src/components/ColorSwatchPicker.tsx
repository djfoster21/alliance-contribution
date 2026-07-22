import { ACTIVITY_COLORS, type ActivityColor } from "@shared/colors";
import { activitySolidClass } from "@/lib/activity";
import { cn } from "@/lib/utils";

export function ColorSwatchPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: ActivityColor) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Activity colour" className="flex flex-wrap gap-2">
      {ACTIVITY_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn(
            "size-9 rounded-[9px] ring-offset-2 ring-offset-surface transition-shadow",
            activitySolidClass(c),
            value === c ? "ring-2 ring-foreground" : "ring-1 ring-border hover:ring-foreground/40",
          )}
        />
      ))}
    </div>
  );
}
