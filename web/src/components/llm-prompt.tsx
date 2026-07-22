import { useId, useState, type JSX } from "react";
import { ChevronRight, ChevronDown, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Collapsible disclosure holding a read-only LLM prompt with copy-to-clipboard.
 * The operator pastes ranking screenshots into an LLM alongside this prompt to
 * get back the exact TSV the importers expect.
 */
export function LlmPrompt({
  prompt,
  title = "LLM prompt for screenshots",
}: {
  prompt: string;
  title?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const panelId = useId();

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="h-auto gap-1 px-0 py-0 text-[12px] font-normal text-secondary hover:bg-transparent hover:text-foreground focus-visible:text-foreground"
        >
          {open ? (
            <ChevronDown className="size-3.5 text-muted" />
          ) : (
            <ChevronRight className="size-3.5 text-muted" />
          )}
          {title}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={copy}
          className={cn(
            "h-auto gap-1 rounded-[6px] px-2 py-1 text-[12px]",
            copied && "text-up hover:text-up",
          )}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {open && (
        <pre
          id={panelId}
          className="num max-h-56 overflow-auto whitespace-pre-wrap rounded-[6px] border border-border bg-background px-3 py-2 text-[12px] text-secondary"
        >
          {prompt}
        </pre>
      )}
    </div>
  );
}
