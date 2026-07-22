import { useState } from "react";
import { KeyRound } from "lucide-react";
import { useApiKey } from "@/lib/apiKey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Top-bar control to swap the API key (persisted to localStorage), e.g. viewer -> manager for writes. */
export function ApiKeyDialog() {
  const { apiKey, setApiKey } = useApiKey();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const save = () => {
    setApiKey(draft);
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(apiKey);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <KeyRound />
          {apiKey ? "API key set" : "Set API key"}
          <span
            className={apiKey ? "size-1.5 rounded-full bg-up" : "size-1.5 rounded-full bg-faint"}
            aria-hidden
          />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>API key</DialogTitle>
          <DialogDescription>
            The viewer key opens the read pages. A manager or admin key is needed to change events,
            roster, aliases and scoring. Stored locally in this browser.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Input
            type="password"
            placeholder="X-Api-Key value"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
          />
          <div className="flex items-center justify-between">
            <DialogClose asChild>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button size="sm" onClick={save}>
              Save key
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
