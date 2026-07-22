import { useMemo, useState, useEffect } from "react";
import { Plus, Pencil, Power, PowerOff, CheckCircle2, TriangleAlert } from "lucide-react";
import type { ActivityType, NewActivityType } from "@shared/types";
import { DEFAULT_ACTIVITY_COLOR } from "@shared/colors";
import { api, ApiError } from "@/lib/api";
import type { ScoringConfig } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/utils";
import { activityBadgeClass } from "@/lib/activity";
import { ColorSwatchPicker } from "@/components/ColorSwatchPicker";
import { EditBandsDialog } from "@/components/scoring/EditBandsDialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertContent } from "@/components/ui/alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingState, ErrorState, EmptyState } from "@/components/States";

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

/** Parse an optional numeric field: blank → null, non-numeric → undefined (invalid). */
function parseOptionalNumber(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
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

// ---- Read-only tier bands preview (card) ------------------------------------

/** Read-only tier bands for an activity card. Fetches the current scoring config for display. */
function TierBandsPreview({ activityType }: { activityType: ActivityType }) {
  const { data, loading, error } = useApi<ScoringConfig>(
    () => api.activityTypes.getScoring(activityType.id),
    [activityType.id],
  );

  if (loading) return <div className="text-[12px] text-muted">Loading bands…</div>;
  if (error) return <div className="text-[12px] text-down">{error}</div>;

  const tiers = data?.tiers ?? [];

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-faint">
        Tier bands
      </span>
      {tiers.length === 0 ? (
        <p className="text-[12px] text-muted">No tiers — scores 0 until bands are added.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {tiers.map((t, i) => {
            let label: string;
            if (tiers.length === 1) {
              label = "Any appearance";
            } else if (i === 0 && t.points === 0) {
              label = `< ${tiers[1].min_value.toLocaleString()}`;
            } else {
              label = `≥ ${t.min_value.toLocaleString()}`;
            }
            return (
              <div key={i} className="flex items-center justify-between text-[12px]">
                <span className="text-secondary">{label}</span>
                <Badge variant="neutral" className="num">
                  {t.points} pt
                </Badge>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Activity meta dialogs --------------------------------------------------

/** Edit dialog — partial PATCH of name/unit_label/max_instance/min_value/sort. Key is immutable. */
function EditActivityDialog({
  activity,
  onCancel,
  onSuccess,
}: {
  activity: ActivityType | null;
  onCancel: () => void;
  onSuccess: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [unitLabel, setUnitLabel] = useState("");
  const [maxInstance, setMaxInstance] = useState("1");
  const [minValue, setMinValue] = useState("0");
  const [sort, setSort] = useState("0");
  const [color, setColor] = useState<string>(DEFAULT_ACTIVITY_COLOR);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activity) return;
    setName(activity.name);
    setUnitLabel(activity.unit_label ?? "");
    setMaxInstance(String(activity.max_instance));
    setMinValue(String(activity.min_value));
    setSort(String(activity.sort));
    setColor(activity.color ?? DEFAULT_ACTIVITY_COLOR);
    setSubmitting(false);
    setError(null);
  }, [activity]);

  const maxInstanceNum = toNumber(maxInstance);
  const minValueNum = toNumber(minValue);
  const sortNum = toNumber(sort);
  const maxInstanceValid =
    maxInstanceNum !== null && Number.isInteger(maxInstanceNum) && maxInstanceNum >= 1;
  const minValueValid = minValueNum !== null && minValueNum >= 0;
  const sortValid = sortNum !== null && Number.isInteger(sortNum);
  const canSubmit =
    !submitting && name.trim() !== "" && maxInstanceValid && minValueValid && sortValid;

  const submit = async () => {
    if (!activity) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.activityTypes.update(activity.id, {
        name: name.trim(),
        unit_label: unitLabel.trim() === "" ? null : unitLabel.trim(),
        max_instance: maxInstanceNum ?? 1,
        min_value: minValueNum ?? 0,
        sort: sortNum ?? 0,
        color,
      });
      onSuccess(name.trim());
    } catch (e) {
      setError(writeErrorMessage(e));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={activity !== null}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit activity</DialogTitle>
          {activity && (
            <DialogDescription>
              Editing{" "}
              <Badge className={cn(activityBadgeClass(activity.color), "align-middle")}>
                {activity.name}
              </Badge>{" "}
              (<span className="num">{activity.key}</span>). Scoring is edited on the card.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {error && <ErrorState message={error} />}

          <Field label="Name">
            <Input placeholder="Activity name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>

          <Field label="Unit label" hint="(optional)">
            <Input
              placeholder="e.g. contribution"
              value={unitLabel}
              onChange={(e) => setUnitLabel(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Max instance" hint="(≥ 1)">
              <Input
                className="num text-right"
                type="number"
                min={1}
                step={1}
                value={maxInstance}
                onChange={(e) => setMaxInstance(e.target.value)}
                aria-invalid={!maxInstanceValid}
              />
            </Field>
            <Field label="Min value" hint="(≥ 0)">
              <Input
                className="num text-right"
                type="number"
                min={0}
                value={minValue}
                onChange={(e) => setMinValue(e.target.value)}
                aria-invalid={!minValueValid}
              />
            </Field>
            <Field label="Sort">
              <Input
                className="num text-right"
                type="number"
                step={1}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-invalid={!sortValid}
              />
            </Field>
          </div>

          <Field label="Activity colour">
            <div className="flex flex-col gap-2">
              <ColorSwatchPicker value={color} onChange={setColor} />
              <p className="text-[12px] text-muted">
                Drives the badge and profile bars for this activity everywhere.
              </p>
            </div>
          </Field>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={!canSubmit}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Confirm dialog for deactivating an activity (no hard delete — history stays scorable). */
function DeactivateActivityDialog({
  activity,
  onCancel,
  onDone,
}: {
  activity: ActivityType | null;
  onCancel: () => void;
  onDone: (name: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activity) {
      setSubmitting(false);
      setError(null);
    }
  }, [activity]);

  const confirm = async () => {
    if (!activity) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.activityTypes.update(activity.id, { active: 0 });
      onDone(activity.name);
    } catch (e) {
      setError(writeErrorMessage(e));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={activity !== null}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate activity</DialogTitle>
          {activity && (
            <DialogDescription>
              Deactivate{" "}
              <Badge className={cn(activityBadgeClass(activity.color), "align-middle")}>
                {activity.name}
              </Badge>
              ? Keeps history scorable — it is never hard-deleted.
            </DialogDescription>
          )}
        </DialogHeader>

        {error && <ErrorState message={error} />}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={confirm} disabled={submitting}>
            {submitting ? "Deactivating…" : "Deactivate"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Add activity dialog ----------------------------------------------------

function AddActivityDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (name: string) => void;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [unitLabel, setUnitLabel] = useState("");
  const [weight, setWeight] = useState("1");
  const [maxInstance, setMaxInstance] = useState("1");
  const [minValue, setMinValue] = useState("0");
  const [sort, setSort] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_ACTIVITY_COLOR);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKey("");
    setName("");
    setUnitLabel("");
    setWeight("1");
    setMaxInstance("1");
    setMinValue("0");
    setSort("");
    setColor(DEFAULT_ACTIVITY_COLOR);
    setSubmitting(false);
    setError(null);
  }, [open]);

  const weightNum = toNumber(weight);
  const maxInstanceNum = toNumber(maxInstance);
  const minValueNum = toNumber(minValue);
  const sortNum = parseOptionalNumber(sort);
  const weightValid = weightNum !== null && weightNum >= 0;
  const maxInstanceValid =
    maxInstanceNum !== null && Number.isInteger(maxInstanceNum) && maxInstanceNum >= 1;
  const minValueValid = minValueNum !== null && minValueNum >= 0;
  const canSubmit =
    !submitting &&
    key.trim() !== "" &&
    name.trim() !== "" &&
    weightValid &&
    maxInstanceValid &&
    minValueValid &&
    sortNum !== undefined;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const dto: NewActivityType = {
        key: key.trim(),
        name: name.trim(),
        unit_label: unitLabel.trim() === "" ? null : unitLabel.trim(),
        weight: weightNum ?? 1,
        max_instance: maxInstanceNum ?? 1,
        min_value: minValueNum ?? 0,
        active: 1,
        sort: sortNum ?? 0,
        color,
      };
      await api.activityTypes.create(dto);
      onSuccess(name.trim());
    } catch (e) {
      setError(writeErrorMessage(e));
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add activity type</DialogTitle>
          <DialogDescription>
            Key must be unique. A new type has no tiers yet — it scores 0 until you add tiers in its
            scoring editor.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {error && <ErrorState message={error} />}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Key" hint="(lowercase_underscore)">
              <Input
                className="num"
                placeholder="castle_battle"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Name">
              <Input placeholder="Castle Battle" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>

          <Field label="Unit label" hint="(optional)">
            <Input
              placeholder="e.g. contribution"
              value={unitLabel}
              onChange={(e) => setUnitLabel(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Weight" hint="(≥ 0)">
              <Input
                className="num text-right"
                type="number"
                min={0}
                step={1}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                aria-invalid={!weightValid}
              />
            </Field>
            <Field label="Max inst." hint="(≥ 1)">
              <Input
                className="num text-right"
                type="number"
                min={1}
                step={1}
                value={maxInstance}
                onChange={(e) => setMaxInstance(e.target.value)}
                aria-invalid={!maxInstanceValid}
              />
            </Field>
            <Field label="Min value" hint="(≥ 0)">
              <Input
                className="num text-right"
                type="number"
                min={0}
                value={minValue}
                onChange={(e) => setMinValue(e.target.value)}
                aria-invalid={!minValueValid}
              />
            </Field>
            <Field label="Sort" hint="(optional)">
              <Input
                className="num text-right"
                type="number"
                step={1}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-invalid={sortNum === undefined}
              />
            </Field>
          </div>

          <Field label="Activity colour">
            <div className="flex flex-col gap-2">
              <ColorSwatchPicker value={color} onChange={setColor} />
              <p className="text-[12px] text-muted">
                Drives the badge and profile bars for this activity everywhere.
              </p>
            </div>
          </Field>

          <div className="flex items-center justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button size="sm" onClick={submit} disabled={!canSubmit}>
              {submitting ? "Adding…" : "Add activity"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Activity card ----------------------------------------------------------

function ActivityCard({
  activity,
  onEdit,
  onEditBands,
  onDeactivate,
  onActivate,
}: {
  activity: ActivityType;
  onEdit: (a: ActivityType) => void;
  onEditBands: (a: ActivityType) => void;
  onDeactivate: (a: ActivityType) => void;
  onActivate: (a: ActivityType) => void;
}) {
  const inactive = activity.active !== 1;
  return (
    <Card className={cn("flex flex-col gap-4 p-4", inactive && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "rounded-[6px] px-2 py-0.5 text-[12px] font-medium",
            activityBadgeClass(activity.color),
          )}
        >
          {activity.name}
        </span>
        {inactive ? (
          <Badge variant="neutral">Disabled</Badge>
        ) : (
          <Badge variant="up">Active</Badge>
        )}
      </div>

      {activity.unit_label && <p className="text-[12px] text-muted">{activity.unit_label}</p>}

      <div className="flex items-center justify-between text-[12px]">
        <span className="text-secondary">Weight multiplier</span>
        <Badge variant="neutral" className="font-mono">
          ×{activity.weight}
        </Badge>
      </div>

      <TierBandsPreview activityType={activity} />

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="flex-1" onClick={() => onEdit(activity)}>
            <Pencil />
            Edit
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={() => onEditBands(activity)}
          >
            Edit bands
          </Button>
        </div>
        {inactive ? (
          <Button variant="ghost" size="sm" onClick={() => onActivate(activity)}>
            <Power />
            Enable activity
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => onDeactivate(activity)}>
            <PowerOff />
            Disable activity
          </Button>
        )}
      </div>
    </Card>
  );
}

// ---- Page -------------------------------------------------------------------

export function Scoring() {
  const [reloadKey, setReloadKey] = useState(0);
  const activitiesState = useApi<ActivityType[]>(() => api.activityTypes.list(), [reloadKey]);

  const activities = useMemo(
    () =>
      (activitiesState.data ?? [])
        .slice()
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
    [activitiesState.data],
  );

  const [addOpen, setAddOpen] = useState(false);
  const [editActivity, setEditActivity] = useState<ActivityType | null>(null);
  const [editBandsActivity, setEditBandsActivity] = useState<ActivityType | null>(null);
  const [deactivateActivity, setDeactivateActivity] = useState<ActivityType | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = () => setReloadKey((k) => k + 1);

  const activate = async (a: ActivityType) => {
    setRowError(null);
    try {
      await api.activityTypes.update(a.id, { active: 1 });
      setNote(`Activated ${a.name}.`);
      refresh();
    } catch (e) {
      setRowError(writeErrorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-foreground">
            Scoring activities
          </h2>
          <p className="text-[13px] text-muted">
            Define what counts, its colour, and how points band up.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus />
          Add activity
        </Button>
      </div>

      <Alert variant="warn">
        <TriangleAlert />
        <AlertContent>
          <span>
            Editing weights or tiers triggers a <strong className="font-semibold">full recompute</strong> of
            all historical scores.
          </span>
        </AlertContent>
      </Alert>

      {note && <SuccessNote message={note} onDismiss={() => setNote(null)} />}
      {rowError && <ErrorState message={rowError} />}

      {activitiesState.error ? (
        <ErrorState message={activitiesState.error} />
      ) : activitiesState.loading ? (
        <Card className="overflow-hidden">
          <LoadingState />
        </Card>
      ) : activities.length === 0 ? (
        <Card className="overflow-hidden">
          <EmptyState message="No activity types yet. Add one to start scoring." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {activities.map((a) => (
            <ActivityCard
              key={a.id}
              activity={a}
              onEdit={setEditActivity}
              onEditBands={setEditBandsActivity}
              onDeactivate={setDeactivateActivity}
              onActivate={activate}
            />
          ))}
        </div>
      )}

      <AddActivityDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSuccess={(name) => {
          setAddOpen(false);
          setNote(`Added ${name}. Add its tiers to start scoring.`);
          refresh();
        }}
      />

      <EditActivityDialog
        activity={editActivity}
        onCancel={() => setEditActivity(null)}
        onSuccess={(name) => {
          setEditActivity(null);
          setNote(`Saved changes to ${name}.`);
          refresh();
        }}
      />

      {/* Refresh on close: saving bands changes weight + tiers, and the cards' tier previews only
          refetch when the grid remounts. */}
      <EditBandsDialog
        activity={editBandsActivity}
        onClose={() => {
          setEditBandsActivity(null);
          refresh();
        }}
      />

      <DeactivateActivityDialog
        activity={deactivateActivity}
        onCancel={() => setDeactivateActivity(null)}
        onDone={(name) => {
          setDeactivateActivity(null);
          setNote(`Deactivated ${name}.`);
          refresh();
        }}
      />
    </div>
  );
}
