import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Format local y/m/d as "YYYY-MM-DD" — never via toISOString() (UTC would off-by-one). */
function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Parse "YYYY-MM-DD" into local numbers; null when empty/invalid. */
function parseIso(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

/** Monday-based weekday offset (0 = Mon … 6 = Sun) for the first of a month. */
function firstWeekdayOffset(y: number, m: number): number {
  return (new Date(y, m, 1).getDay() + 6) % 7;
}

type DatePickerProps = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
};

export function DatePicker({ value, onChange, placeholder = "Pick a date", className }: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const parsed = parseIso(value);
  const today = new Date();

  // Visible month — seeded from value (or today), re-seeded whenever the popover opens.
  const [view, setView] = React.useState(() => ({
    y: parsed?.y ?? today.getFullYear(),
    m: parsed?.m ?? today.getMonth(),
  }));

  React.useEffect(() => {
    if (!open) return;
    const seed = parseIso(value);
    setView({
      y: seed?.y ?? new Date().getFullYear(),
      m: seed?.m ?? new Date().getMonth(),
    });
  }, [open, value]);

  // Close on outside click / Escape while open.
  React.useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const prevMonth = () =>
    setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }));
  const nextMonth = () =>
    setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }));

  const select = (d: number) => {
    onChange(toIso(view.y, view.m, d));
    setOpen(false);
  };

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const offset = firstWeekdayOffset(view.y, view.m);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 w-full items-center justify-between gap-2 rounded-[8px] border border-border bg-surface px-3 text-[13px] text-foreground outline-none transition-colors duration-150 hover:bg-background focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
      >
        {value ? (
          <span className="num">{value}</span>
        ) : (
          <span className="text-muted">{placeholder}</span>
        )}
        <CalendarDays className="size-4 text-muted" />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 w-64 rounded-[8px] border border-border bg-surface p-3 shadow-md">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={prevMonth}
              className="inline-flex size-7 items-center justify-center rounded-[6px] text-secondary outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-[13px] font-medium text-secondary">
              {MONTHS[view.m]} {view.y}
            </span>
            <button
              type="button"
              aria-label="Next month"
              onClick={nextMonth}
              className="inline-flex size-7 items-center justify-center rounded-[6px] text-secondary outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((w) => (
              <div key={w} className="num flex h-7 items-center justify-center text-[11px] text-muted">
                {w}
              </div>
            ))}
            {Array.from({ length: offset }).map((_, i) => (
              <div key={`blank-${i}`} className="h-7" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const iso = toIso(view.y, view.m, day);
              const isSelected = value === iso;
              const isToday =
                today.getFullYear() === view.y &&
                today.getMonth() === view.m &&
                today.getDate() === day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => select(day)}
                  className={cn(
                    "num flex h-7 items-center justify-center rounded-[6px] text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/30",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : isToday
                        ? "font-semibold text-accent hover:bg-background"
                        : "text-foreground hover:bg-background",
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
