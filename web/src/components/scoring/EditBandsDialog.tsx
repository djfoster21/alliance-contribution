import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, CheckCircle2 } from "lucide-react";
import type { ActivityType } from "@shared/types";
import { api, ApiError } from "@/lib/api";
import type { ScoringConfig, ScoringTierInput } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/utils";
import { activityBadgeClass } from "@/lib/activity";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertContent } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingState, ErrorState } from "@/components/States";

/** Map a thrown error to a clear, actionable message. 401 → API-key hint; 409/400 → server text. */
function writeErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Set your API key (top bar) to edit scoring.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

/** Parse a numeric field: blank/non-numeric → null (invalid), else the finite number. */
function toNumber(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Shared labeled field wrapper. */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-medium text-secondary">
        {label}
        {hint && <span className="ml-1 text-muted">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

/** Dismissible success banner (matches roster/aliases note style). */
function SuccessNote({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <Alert variant="success">
      <CheckCircle2 />
      <AlertContent className="flex-row items-center justify-between gap-3">
        <span>{message}</span>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </AlertContent>
    </Alert>
  );
}

type TierDraft = { min_value: string; points: string };

/** Seed editable drafts from a fetched config. */
function toDrafts(tiers: ScoringTierInput[]): TierDraft[] {
  return tiers.map((t) => ({ min_value: String(t.min_value), points: String(t.points) }));
}

/**
 * Validate the weight + tier drafts. Returns the parsed config (ready to PUT) plus a
 * user-facing reason when invalid. Rules: all finite ≥ 0; tiers strictly ascending by min_value.
 */
function validateScoring(
  weightText: string,
  drafts: TierDraft[],
): { config: ScoringConfig | null; reason: string | null } {
  const weight = toNumber(weightText);
  if (weight === null || weight < 0) {
    return { config: null, reason: "Weight must be a number ≥ 0." };
  }

  const tiers: ScoringTierInput[] = [];
  for (const d of drafts) {
    const min_value = toNumber(d.min_value);
    const points = toNumber(d.points);
    if (min_value === null || min_value < 0 || points === null || points < 0) {
      return { config: null, reason: "Every tier needs a min value and points ≥ 0." };
    }
    tiers.push({ min_value, points });
  }

  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].min_value <= tiers[i - 1].min_value) {
      return { config: null, reason: "Tier min values must strictly increase." };
    }
  }

  return { config: { weight, tiers }, reason: null };
}

/** Per-activity scoring editor — self-contained: fetches, edits, validates, saves (recompute). */
function ScoringEditor({ activityType }: { activityType: ActivityType }) {
  const { data, loading, error } = useApi<ScoringConfig>(
    () => api.activityTypes.getScoring(activityType.id),
    [activityType.id],
  );

  const [weight, setWeight] = useState("");
  const [tiers, setTiers] = useState<TierDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Seed drafts once the config loads.
  useEffect(() => {
    if (!data) return;
    setWeight(String(data.weight));
    setTiers(toDrafts(data.tiers));
    setSaveError(null);
    setSaved(false);
  }, [data]);

  const { config, reason } = useMemo(() => validateScoring(weight, tiers), [weight, tiers]);
  const weightNum = toNumber(weight);

  const updateTier = (index: number, patch: Partial<TierDraft>) => {
    setTiers((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
    setSaved(false);
  };
  const removeTier = (index: number) => {
    setTiers((prev) => prev.filter((_, i) => i !== index));
    setSaved(false);
  };
  const addTier = () => {
    setTiers((prev) => [...prev, { min_value: "", points: "" }]);
    setSaved(false);
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await api.activityTypes.putScoring(activityType.id, config);
      setWeight(String(next.weight));
      setTiers(toDrafts(next.tiers));
      setSaved(true);
    } catch (e) {
      setSaveError(writeErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:max-w-xs">
        <Field label="Weight" hint="(≥ 0)">
          <Input
            className="num text-right"
            type="number"
            min={0}
            step={1}
            value={weight}
            onChange={(e) => {
              setWeight(e.target.value);
              setSaved(false);
            }}
            aria-invalid={weightNum === null || weightNum < 0}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-secondary">Tiers</span>
          <span className="text-[11px] text-muted">
            Effective points = tier points × weight
          </span>
        </div>

        {tiers.length === 0 ? (
          <div className="rounded-[6px] border border-dashed border-border bg-background p-3 text-[12px] text-muted">
            No tiers — this activity scores 0 until you add one.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[6px] border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-right">Min value</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead className="text-right">Effective</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tiers.map((t, i) => {
                  const minV = toNumber(t.min_value);
                  const pts = toNumber(t.points);
                  const effective =
                    pts !== null && weightNum !== null ? pts * weightNum : null;
                  return (
                    <TableRow key={i}>
                      <TableCell>
                        <Input
                          className="num text-right"
                          type="number"
                          min={0}
                          value={t.min_value}
                          onChange={(e) => updateTier(i, { min_value: e.target.value })}
                          aria-invalid={minV === null || minV < 0}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="num text-right"
                          type="number"
                          min={0}
                          value={t.points}
                          onChange={(e) => updateTier(i, { points: e.target.value })}
                          aria-invalid={pts === null || pts < 0}
                        />
                      </TableCell>
                      <TableCell className="num text-right text-secondary">
                        {effective === null ? "—" : effective}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove tier"
                          onClick={() => removeTier(i)}
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <div>
          <Button variant="secondary" size="sm" onClick={addTier}>
            <Plus />
            Add tier
          </Button>
        </div>
      </div>

      <p className="text-[12px] text-muted">
        Saving replaces this activity's scoring and runs a full recompute of all history.
      </p>

      {saveError && <ErrorState message={saveError} />}
      {saved && <SuccessNote message="Saved — history recomputed." onDismiss={() => setSaved(false)} />}

      <div className="flex items-center justify-end gap-3">
        {reason && <span className="text-[12px] text-down">{reason}</span>}
        <Button size="sm" onClick={save} disabled={saving || config === null}>
          {saving ? "Saving…" : "Save scoring"}
        </Button>
      </div>
    </div>
  );
}

/** Modal wrapper around the weight + tier editor. Editing bands triggers a full recompute. */
export function EditBandsDialog({
  activity,
  onClose,
}: {
  activity: ActivityType | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={activity !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit bands</DialogTitle>
          {activity && (
            <DialogDescription>
              Weight and tiers for{" "}
              <Badge className={cn(activityBadgeClass(activity.color), "align-middle")}>
                {activity.name}
              </Badge>
              .
            </DialogDescription>
          )}
        </DialogHeader>

        {activity && <ScoringEditor activityType={activity} />}
      </DialogContent>
    </Dialog>
  );
}
