import { useState, type ReactNode } from "react";
import { KeyRound } from "lucide-react";
import { useApiKey } from "@/lib/apiKey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/States";

/**
 * Blocks the whole app until the stored key resolves to a role. Reads need the viewer tier, so an
 * unset or stale key means there is nothing to render behind this.
 */
export function KeyGate({ children }: { children: ReactNode }) {
  const { apiKey, setApiKey, role, checking } = useApiKey();
  const [draft, setDraft] = useState("");

  if (checking) return <LoadingState label="Checking access…" />;
  if (role) return <>{children}</>;

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex w-full max-w-[380px] flex-col gap-4 rounded-[8px] border border-line p-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[15px] font-medium">
            <KeyRound className="size-4" />
            Alliance Tracker
          </div>
          <p className="text-[13px] text-muted">
            {apiKey
              ? "That key was not recognised. Check it with an officer and try again."
              : "Enter the alliance access key to continue. Ask an officer if you do not have it."}
          </p>
        </div>
        <Input
          type="password"
          placeholder="Access key"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setApiKey(draft);
          }}
        />
        <Button size="sm" onClick={() => setApiKey(draft)} disabled={!draft.trim()}>
          Unlock
        </Button>
      </div>
    </div>
  );
}
