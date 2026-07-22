import { Loader2, TriangleAlert, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-8 text-[13px] text-muted">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

/**
 * A full page reload is the whole recovery story: useApi has no refetch and its effects run once, so
 * a transient 500 or a 429 from the Worker's rate limiter otherwise strands the page until the user
 * thinks to reload. Deliberately not a `retry` prop — there is nothing to re-run.
 */
export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-[6px] border border-down/20 bg-down/5 p-4 text-[13px] text-down">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span className="flex-1">{message}</span>
      <Button
        variant="secondary"
        size="sm"
        className="shrink-0"
        onClick={() => window.location.reload()}
      >
        Reload
      </Button>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 p-12 text-center text-[13px] text-muted">
      <Inbox className="size-6 text-faint" />
      {message}
    </div>
  );
}
