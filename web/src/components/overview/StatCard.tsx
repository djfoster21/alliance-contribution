import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One dashboard KPI: mono label, big number, and a quiet sub-label carrying the context that used
 * to occupy its own tile ("of 86 tracked", "across 8 event-days").
 *
 * `value` and `sub` are both ReactNode so a caller can colour parts of the number (the roster's
 * "gained / dropped" tile) or wrap numbers inside the sub-label in `.num`. The tile applies `.num`
 * and the type scale to `value` itself, so a plain string still renders exactly as before.
 */
export function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub: ReactNode;
  tone?: "default" | "warn";
}) {
  return (
    <Card className={cn("p-[18px]", tone === "warn" && "border-warn/30 bg-warn/5")}>
      <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.04em] text-faint">
        {label}
      </div>
      <div
        className={cn(
          "num mt-1.5 text-[26px] font-bold tracking-[-0.02em]",
          tone === "warn" ? "text-warn" : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-[12px] text-muted">{sub}</div>
    </Card>
  );
}
