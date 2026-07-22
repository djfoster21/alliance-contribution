import { useState } from "react";
import { Search } from "lucide-react";
import type { Member } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";

/**
 * Self-contained member search-select: filter the ~86 members by governor substring and pick one.
 * Built on the Command/Popover combobox primitives for keyboard nav and ARIA.
 */
export function MemberSearchSelect({
  members,
  value,
  onChange,
  placeholder = "Search governor…",
}: {
  members: Member[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value === null ? undefined : members.find((m) => m.id === value);
  const sorted = members.slice().sort((a, b) => a.governor.localeCompare(b.governor));

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-[6px] border border-border bg-surface px-3 py-2">
        <span className="text-[13px] font-medium text-foreground">{selected.governor}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange(null);
            setOpen(true);
          }}
        >
          Change
        </Button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center gap-2 rounded-[8px] border border-border bg-surface px-3 text-left text-[13px] text-muted outline-none transition-colors duration-150 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        >
          <Search className="size-4 shrink-0 text-muted" />
          {placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} autoFocus />
          <CommandList>
            <CommandEmpty>No members match.</CommandEmpty>
            <CommandGroup>
              {sorted.map((m) => (
                <CommandItem
                  key={m.id}
                  value={m.governor}
                  onSelect={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                >
                  <span className="flex w-full items-center justify-between">
                    <span>{m.governor}</span>
                    {m.alliance_rank && <span className="text-[11px] text-muted">{m.alliance_rank}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
