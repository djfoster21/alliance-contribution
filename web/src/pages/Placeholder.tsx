import { Construction } from "lucide-react";

/** Stub page for routes filled in by later tasks. Heading is real; body is a marker. */
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-foreground">{title}</h2>
      <div className="mt-4 flex items-center gap-2 rounded-[6px] border border-dashed border-border bg-surface p-8 text-[13px] text-muted">
        <Construction className="size-4 text-faint" />
        Coming in the next task.
      </div>
    </div>
  );
}
