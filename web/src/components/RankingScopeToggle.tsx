import { cn } from "@/lib/utils";

export type RankingScope = "overall" | "weekly";

const SCOPES: { value: RankingScope; label: string }[] = [
  { value: "overall", label: "Overall" },
  { value: "weekly", label: "This week" },
];

export function RankingScopeToggle({
  value,
  onChange,
}: {
  value: RankingScope;
  onChange: (scope: RankingScope) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-[10px] border border-border bg-muted-surface p-1">
      {SCOPES.map((s) => (
        <button
          key={s.value}
          type="button"
          onClick={() => onChange(s.value)}
          className={cn(
            "rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
            value === s.value
              ? "bg-surface font-semibold text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
              : "text-muted hover:text-foreground",
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
