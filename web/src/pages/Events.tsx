import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Eye, Pencil, Trash2, CheckCircle2, TriangleAlert } from "lucide-react";
import type { ActivityType, Event } from "@shared/types";
import { DEFAULT_ACTIVITY_COLOR } from "@shared/colors";
import { api, ApiError } from "@/lib/api";
import type {
  EventDetail,
  EventParticipationRow,
  IngestDto,
  IngestResult,
  UnmappedRow,
} from "@/lib/api";
import { useApi, firstError } from "@/lib/useApi";
import { useApiKey } from "@/lib/apiKey";
import { activityBadgeClass, activitySolidClass } from "@/lib/activity";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertTitle, AlertContent } from "@/components/ui/alert";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingState, ErrorState, EmptyState } from "@/components/States";
import { LlmPrompt } from "@/components/llm-prompt";
import { normalizeName } from "@/lib/normalize";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Map a thrown error to a clear, actionable message. 401 → API-key hint; 409/400 → server text. */
function writeErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Set your API key (top bar) to save events.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

type ParsedRow = {
  lineNo: number;
  raw_name: string;
  value: number;
  notes: string | null;
  valid: boolean;
  duplicate: boolean;
};

/**
 * Parse the paste textarea: one participant per non-blank line, tab-separated (TSV)
 * `raw_name<TAB>value<TAB>notes` — pasted straight from the sheet. Values keep
 * thousand-separators/spaces stripped before Number() (values contain commas like `164,497,800`).
 * Raw names are sent verbatim — the server strips the alliance tag and normalizes.
 *
 * Repeats of a name already seen are flagged `duplicate` and dropped on submit: ranking screens
 * overlap when scrolled and pin some rows on every capture, so the same participant landing in the
 * paste twice is the common case, not an edge case. First occurrence wins.
 */
function parseRows(text: string): ParsedRow[] {
  const out: ParsedRow[] = [];
  const seen = new Set<string>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    // Ignore fenced-code-block markers — the LLM is prompted to wrap output in ``` fences.
    if (lines[i].trim().startsWith("```")) continue;
    const parts = lines[i].split("\t").map((p) => p.trim());
    const raw_name = parts[0] ?? "";
    const valueText = parts[1] ?? "";
    const notesText = parts.slice(2).join(" ").trim();
    const value = Number(valueText.replace(/[,\s]/g, ""));
    const valid = raw_name !== "" && valueText !== "" && Number.isFinite(value);
    const key = normalizeName(raw_name);
    const duplicate = key !== "" && seen.has(key);
    if (key !== "") seen.add(key);
    out.push({
      lineNo: i + 1,
      raw_name,
      value,
      notes: notesText === "" ? null : notesText,
      valid,
      duplicate,
    });
  }
  return out;
}

/** Shared participations table — resolved governor or UNMAPPED, mono value/points, optional notes. */
function ParticipationTable({
  rows,
  showNotes = false,
}: {
  rows: EventParticipationRow[];
  showNotes?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Raw name</TableHead>
          <TableHead>Governor</TableHead>
          <TableHead className="text-right">Value</TableHead>
          <TableHead className="text-right">Points</TableHead>
          {showNotes && <TableHead>Notes</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-medium text-foreground">{row.raw_name}</TableCell>
            <TableCell>
              {row.governor ? (
                <span className="flex items-center gap-2">
                  <Avatar name={row.governor} size={24} />
                  <span className="text-secondary">{row.governor}</span>
                </span>
              ) : (
                <Badge variant="warn">UNMAPPED</Badge>
              )}
            </TableCell>
            <TableCell className="num text-right text-secondary">{row.value}</TableCell>
            <TableCell className="num text-right font-semibold text-foreground">
              {row.points}
            </TableCell>
            {showNotes && (
              <TableCell className="text-[12px] text-muted">{row.notes ?? "—"}</TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Post-ingest summary: persisted rows, resolved table, skipped (value ≤ threshold), unmapped names. */
function IngestResultPanel({ result }: { result: IngestResult }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="success">
        <CheckCircle2 />
        <AlertContent>
          <span>
            <span className="num font-semibold">{result.rows.length}</span> row
            {result.rows.length === 1 ? "" : "s"} persisted and scored.
          </span>
        </AlertContent>
      </Alert>

      {result.rows.length > 0 && (
        <Card className="overflow-hidden">
          <ParticipationTable rows={result.rows} />
        </Card>
      )}

      {result.unmapped.length > 0 && (
        <Alert variant="warn">
          <TriangleAlert />
          <AlertContent>
            <div className="font-medium">
              {result.unmapped.length} unmapped name
              {result.unmapped.length === 1 ? "" : "s"} — map in Aliases to count.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {result.unmapped.map((name) => (
                <Badge key={name} variant="warn">
                  {name}
                </Badge>
              ))}
            </div>
          </AlertContent>
        </Alert>
      )}

      {result.skipped.length > 0 && (
        <Alert variant="info">
          <AlertContent>
            <AlertTitle className="text-[12px] uppercase tracking-[0.04em] text-muted">
              Skipped — value ≤ threshold, not counted
            </AlertTitle>
            <ul className="flex flex-col gap-0.5">
              {result.skipped.map((s, i) => (
                <li key={`${s.raw_name}-${i}`} className="text-[13px] text-secondary">
                  {s.raw_name} <span className="num text-muted">({s.value})</span>
                </li>
              ))}
            </ul>
          </AlertContent>
        </Alert>
      )}
    </div>
  );
}

/** Add/edit dialog. `detail === null` → add; otherwise prefill + PATCH the existing event. */
function EventFormDialog({
  open,
  onOpenChange,
  activityTypes,
  detail,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityTypes: ActivityType[];
  detail: EventDetail | null;
  onSuccess: () => void;
}) {
  const isEdit = detail !== null;
  const [activityKey, setActivityKey] = useState("");
  const [date, setDate] = useState("");
  const [instance, setInstance] = useState(1);
  const [rowsText, setRowsText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);

  // Seed the form whenever the dialog opens (fresh for add, prefilled for edit).
  useEffect(() => {
    if (!open) return;
    setError(null);
    setResult(null);
    setSubmitting(false);
    if (detail) {
      const at = activityTypes.find((a) => a.id === detail.event.activity_type_id);
      setActivityKey(at?.key ?? "");
      if (!at) setError("This event's activity type no longer exists — it can't be re-saved.");
      setDate(detail.event.date);
      setInstance(detail.event.instance);
      setRowsText(
        detail.participations
          .map((p) =>
            p.notes ? `${p.raw_name}\t${p.value}\t${p.notes}` : `${p.raw_name}\t${p.value}`,
          )
          .join("\n"),
      );
    } else {
      setActivityKey("");
      setDate("");
      setInstance(1);
      setRowsText("");
    }
  }, [open, detail, activityTypes]);

  const selected = activityTypes.find((a) => a.key === activityKey);
  // New events pick from active types only; the currently selected type always stays in the list so
  // editing an event whose activity was since deactivated keeps it selected instead of blanking it.
  const options = activityTypes.filter((a) => a.active === 1 || a.key === activityKey);
  const maxInstance = selected?.max_instance ?? 1;
  const parsed = useMemo(() => parseRows(rowsText), [rowsText]);
  const eventPrompt = useMemo(() => {
    const activityName = selected?.name ?? "the activity";
    const unitLabel = selected?.unit_label ?? "value shown";
    return `You will be given screenshots of a ${activityName} ranking. For EVERY participant whose value is greater than 0, output one line of tab-separated values with EXACTLY these columns, and NO header row:

Name<TAB>Value<TAB>Notes

Rules:
- Name: the participant's name. Remove any leading alliance tag (e.g. \`[ABC]\`).
- Value: the ${unitLabel} as digits only — strip commas.
- Notes: optional short note (e.g. mission count like "47/48"); leave empty if none.
- Skip anyone whose value is 0 or shown as "Unranked".
- Output each participant exactly ONCE. Screenshots overlap when scrolling, and the screen pins the viewer's own row in a separate panel below the list on every capture — repeating that player's rank badge and value. So the same name appears repeatedly across the images: emit its first occurrence and drop every later repeat of the same Name.
- Separate columns with a literal TAB character, not spaces. One participant per line.
- Put ONLY the tab-separated rows inside a single fenced code block (\`\`\`), with no header and nothing else inside the fence.

After the closing fence — never inside it — add a short "Coverage check:" note in plain prose:
- Use the rank numbers shown beside each row (they are NOT part of the output) to verify coverage: they must run 1, 2, 3 … with no gaps. List every missing rank number. Ignore the pinned viewer panel below the list — its rank number is a repeat, not a position in the sequence.
- State the highest rank number you saw in the list itself and how many unique participants you output. If those two numbers differ, the screenshots are missing people.
- Call out any screenshot that is a duplicate of another, and any point where consecutive screenshots neither overlap nor continue the ranking (a jump means rows were skipped between captures).
- Values should descend down the ranking. Flag anywhere they do not — that means rows are out of order or missing.
- If everything lines up, say "Coverage check: ranks 1-N complete, no gaps."`;
  }, [selected]);
  const invalid = parsed.filter((p) => !p.valid);
  const duplicates = parsed.filter((p) => p.valid && p.duplicate).length;
  const validCount = parsed.length - invalid.length - duplicates;
  const dateValid = DATE_RE.test(date);

  const canSubmit =
    !submitting &&
    activityKey !== "" &&
    dateValid &&
    validCount > 0 &&
    invalid.length === 0;

  const onActivityChange = (key: string) => {
    setActivityKey(key);
    const at = activityTypes.find((a) => a.key === key);
    const max = at?.max_instance ?? 1;
    setInstance((prev) => Math.min(Math.max(1, prev), max));
  };

  const submit = async () => {
    const dto: IngestDto = {
      activity: activityKey,
      date,
      instance: maxInstance > 1 ? instance : 1,
      rows: parsed
        .filter((p) => !p.duplicate)
        .map((p) => ({ raw_name: p.raw_name, value: p.value, notes: p.notes })),
    };
    setSubmitting(true);
    setError(null);
    try {
      const res = isEdit
        ? await api.events.update(detail.event.id, dto)
        : await api.events.create(dto);
      setResult(res);
      onSuccess();
    } catch (e) {
      setError(writeErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit event" : "Add event"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Re-submitting replaces the batch — rows are re-resolved and re-scored."
              : "Log a batch of participants. Names resolve via aliases; scoring is applied from config."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-4">
            <IngestResultPanel result={result} />
            <div className="flex justify-end">
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {error && <ErrorState message={error} />}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-secondary">Activity</label>
                <Select value={activityKey || undefined} onValueChange={onActivityChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select activity" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((a) => (
                      <SelectItem key={a.id} value={a.key}>
                        <span className="flex items-center gap-1.5">
                          <span className={cn("size-2 shrink-0 rounded-full", activitySolidClass(a.color))} />
                          {a.name}
                          {a.active === 0 && <span className="text-muted">· inactive</span>}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-secondary">Date</label>
                <DatePicker value={date} onChange={setDate} placeholder="Pick a date" className="w-full" />
              </div>

              {maxInstance > 1 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-medium text-secondary">
                    Instance
                    <span className="ml-1 text-muted">(1–{maxInstance})</span>
                  </label>
                  <Input
                    className="num"
                    type="number"
                    min={1}
                    max={maxInstance}
                    value={instance}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      setInstance(Math.min(Math.max(1, Math.trunc(n)), maxInstance));
                    }}
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-secondary">Participants</label>
              <p className="text-[12px] text-muted">
                One per line, tab-separated (TSV) — paste straight from the sheet:{" "}
                <span className="num text-secondary">raw_name</span>
                <span className="text-faint"> · </span>
                <span className="num text-secondary">value</span>
                <span className="text-faint"> · </span>
                <span className="num text-secondary">notes</span> (optional). Only value &gt;
                threshold is counted.
              </p>
              <LlmPrompt prompt={eventPrompt} title="LLM prompt for screenshots" />
              <Textarea
                className="min-h-40 resize-y font-mono text-[13px]"
                placeholder={"Aurora\t120000\nBlaze\t95000\tsub"}
                value={rowsText}
                onChange={(e) => setRowsText(e.target.value)}
                spellCheck={false}
              />
              <div className="flex items-center gap-3 text-[12px]">
                <span className="text-muted">
                  <span className="num text-secondary">{validCount}</span> row
                  {validCount === 1 ? "" : "s"} parsed
                </span>
                {duplicates > 0 && (
                  <span className="text-muted">
                    <span className="num text-secondary">{duplicates}</span> duplicate row
                    {duplicates === 1 ? "" : "s"} collapsed
                  </span>
                )}
                {invalid.length > 0 && (
                  <span className="text-down">
                    {invalid.length} line{invalid.length === 1 ? "" : "s"} missing a numeric value (
                    <span className="num">{invalid.map((p) => p.lineNo).join(", ")}</span>)
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button size="sm" onClick={submit} disabled={!canSubmit}>
                {submitting ? "Saving…" : isEdit ? "Save changes" : "Add event"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Detail body — fetches EventDetail fresh on open. */
function ViewEventBody({
  eventId,
  activityById,
}: {
  eventId: number;
  activityById: Map<number, ActivityType>;
}) {
  const { data, loading, error } = useApi<EventDetail>(() => api.events.get(eventId), [eventId]);
  const activity = data ? activityById.get(data.event.activity_type_id) : undefined;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Event detail</DialogTitle>
        {data && (
          <DialogDescription className="flex flex-wrap items-center gap-1.5">
            <span className="num">{data.event.date}</span> ·
            <Badge
              className={cn("whitespace-nowrap", activityBadgeClass(activity?.color ?? DEFAULT_ACTIVITY_COLOR))}
            >
              {activity?.name ?? "—"}
            </Badge>
            · instance <span className="num">{data.event.instance}</span> ·{" "}
            <span className="num">{data.event.week}</span>
          </DialogDescription>
        )}
      </DialogHeader>

      {error ? (
        <ErrorState message={error} />
      ) : loading ? (
        <LoadingState />
      ) : !data || data.participations.length === 0 ? (
        <EmptyState message="No participations on this event." />
      ) : (
        <Card className="overflow-hidden">
          <ParticipationTable rows={data.participations} showNotes />
        </Card>
      )}
    </>
  );
}

function ViewEventDialog({
  eventId,
  activityById,
  onClose,
}: {
  eventId: number | null;
  activityById: Map<number, ActivityType>;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={eventId !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        {eventId !== null && <ViewEventBody eventId={eventId} activityById={activityById} />}
      </DialogContent>
    </Dialog>
  );
}

function DeleteEventDialog({
  event,
  activityById,
  onCancel,
  onDeleted,
}: {
  event: Event | null;
  activityById: Map<number, ActivityType>;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (event) {
      setSubmitting(false);
      setError(null);
    }
  }, [event]);

  const confirm = async () => {
    if (!event) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.events.delete(event.id);
      onDeleted();
    } catch (e) {
      setError(writeErrorMessage(e));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={event !== null}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete event</DialogTitle>
          <DialogDescription>
            {event && (() => {
              const activity = activityById.get(event.activity_type_id);
              return (
                <>
                  Delete this{" "}
                  <Badge
                    className={cn(
                      "whitespace-nowrap",
                      activityBadgeClass(activity?.color ?? DEFAULT_ACTIVITY_COLOR),
                    )}
                  >
                    {activity?.name ?? "event"}
                  </Badge>{" "}
                  event on <span className="num">{event.date}</span> (instance{" "}
                  <span className="num">{event.instance}</span>)? Scores recompute immediately. This
                  can't be undone.
                </>
              );
            })()}
          </DialogDescription>
        </DialogHeader>

        {error && <ErrorState message={error} />}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={confirm} disabled={submitting}>
            {submitting ? "Deleting…" : "Delete event"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Amber "Needs mapping" side panel — read-only view of the standing unmapped queue, links out to Aliases. */
function NeedsMappingPanel({
  rows,
  loading,
  error,
}: {
  rows: UnmappedRow[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <Card className="overflow-hidden border-flag-border bg-flag-bg">
      <div className="flex items-center gap-2 border-b border-flag-border p-3">
        <TriangleAlert className="size-[17px] text-flag-accent" />
        <div className="flex flex-col">
          <span className="text-[13.5px] font-semibold text-flag-fg">Needs mapping</span>
          <span className="text-[11.5px] text-flag-accent">
            {rows.length} name{rows.length === 1 ? "" : "s"} with no alias match
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2 p-3">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : rows.length === 0 ? (
          <p className="px-1 py-2 text-[12.5px] text-flag-accent">
            Everything resolves — nothing to map.
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={row.raw_name}
              className="flex items-center justify-between gap-3 rounded-[9px] border border-flag-border bg-surface p-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="num text-[13px] font-semibold text-foreground">{row.raw_name}</span>
                <span className="text-[11.5px] text-muted">no alias match</span>
              </div>
              <Link
                to="/admin/aliases"
                className="shrink-0 rounded-[7px] border border-border bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted-surface"
              >
                Map →
              </Link>
            </div>
          ))
        )}
        <p className="px-1 pt-1 text-[11px] leading-snug text-flag-accent">
          Similar ≠ same person — resolve by alias only, never fuzzy-match.
        </p>
      </div>
    </Card>
  );
}

export function Events() {
  const { role } = useApiKey();
  // ALL activity types, not just active ones: deactivated types still own historical events, which
  // must stay labelled in the table and keep their own activity selectable when edited.
  const activitiesState = useApi<ActivityType[]>(() => api.activityTypes.list(), []);

  const [activityFilter, setActivityFilter] = useState("all");
  const [weekFilter, setWeekFilter] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const week = weekFilter.trim();
  const eventsState = useApi<Event[]>(
    () =>
      api.events.list({
        activity: activityFilter === "all" ? undefined : activityFilter,
        week: week === "" ? undefined : week,
      }),
    [activityFilter, week, reloadKey],
  );

  const activities = useMemo(
    () => (activitiesState.data ?? []).slice().sort((a, b) => a.sort - b.sort),
    [activitiesState.data],
  );
  const activityById = useMemo(() => {
    const m = new Map<number, ActivityType>();
    for (const a of activities) m.set(a.id, a);
    return m;
  }, [activities]);

  const events = eventsState.data ?? [];
  const error = firstError(activitiesState, eventsState);

  const unmappedState = useApi<UnmappedRow[]>(() => api.unmapped(), [reloadKey]);
  const unmapped = unmappedState.data ?? [];

  // Per-event unmapped count — cross-reference the standing unmapped queue's appearances against
  // this event's id. Drives both the UNMAPPED cell and the derived STATUS cell below.
  const unmappedCountByEvent = useMemo(() => {
    const m = new Map<number, number>();
    for (const row of unmappedState.data ?? []) {
      for (const app of row.appearances) {
        m.set(app.event_id, (m.get(app.event_id) ?? 0) + 1);
      }
    }
    return m;
  }, [unmappedState.data]);

  // Dialog state.
  const [formOpen, setFormOpen] = useState(false);
  const [formDetail, setFormDetail] = useState<EventDetail | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const [deleteEvent, setDeleteEvent] = useState<Event | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = () => setReloadKey((k) => k + 1);

  const openAdd = () => {
    setFormDetail(null);
    setFormOpen(true);
  };

  const openEdit = async (id: number) => {
    setRowError(null);
    try {
      const detail = await api.events.get(id);
      setFormDetail(detail);
      setFormOpen(true);
    } catch (e) {
      setRowError(writeErrorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={activityFilter} onValueChange={setActivityFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All activities</SelectItem>
              {activities.map((a) => (
                <SelectItem key={a.id} value={a.key}>
                  <span className="flex items-center gap-1.5">
                    <span className={cn("size-2 shrink-0 rounded-full", activitySolidClass(a.color))} />
                    {a.name}
                    {a.active === 0 && <span className="text-muted">· inactive</span>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="num w-40"
            placeholder="YYYY-Www"
            value={weekFilter}
            onChange={(e) => setWeekFilter(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus />
          Add event
        </Button>
      </div>

      {note && (
        <div className="flex items-center justify-between rounded-[6px] border border-up/20 bg-up/5 px-3 py-2 text-[13px] text-up">
          <span>{note}</span>
          <Button variant="ghost" size="sm" onClick={() => setNote(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {rowError && <ErrorState message={rowError} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          {error ? (
            <div className="p-4">
              <ErrorState message={error} />
            </div>
          ) : eventsState.loading || activitiesState.loading ? (
            <LoadingState />
          ) : events.length === 0 ? (
            <EmptyState message="No events match this filter." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Week</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead className="text-right">Instance</TableHead>
                  <TableHead className="text-right">Unmapped</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((ev) => {
                  const unmappedCount = unmappedCountByEvent.get(ev.id) ?? 0;
                  return (
                    <TableRow key={ev.id}>
                      <TableCell className="num text-foreground">{ev.date}</TableCell>
                      <TableCell className="num text-secondary">{ev.week}</TableCell>
                      <TableCell>
                        {(() => {
                          const activity = activityById.get(ev.activity_type_id);
                          const name = activity?.name ?? "—";
                          return (
                            <Badge
                              className={`whitespace-nowrap ${activityBadgeClass(activity?.color ?? DEFAULT_ACTIVITY_COLOR)}`}
                            >
                              {name}
                            </Badge>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="num text-right text-secondary">{ev.instance}</TableCell>
                      <TableCell className="text-right">
                        {unmappedState.loading || unmappedState.error ? (
                          <span className="num text-faint">—</span>
                        ) : unmappedCount > 0 ? (
                          <Badge variant="warn">
                            <span className="num">{unmappedCount}</span>
                          </Badge>
                        ) : (
                          <span className="num text-faint">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {/* No stored `status` field exists yet — every persisted event renders
                            "Ingested". An "In review" state can be added here if/when a real
                            status field is introduced; unmapped>0 is not a valid stand-in for it. */}
                        <span className="text-[12.5px] text-muted">Ingested</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="View"
                            onClick={() => setViewId(ev.id)}
                          >
                            <Eye />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Edit"
                            onClick={() => openEdit(ev.id)}
                          >
                            <Pencil />
                          </Button>
                          {role === "admin" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Delete"
                              onClick={() => setDeleteEvent(ev)}
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>

        <NeedsMappingPanel
          rows={unmapped}
          loading={unmappedState.loading}
          error={unmappedState.error}
        />
      </div>

      <EventFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        activityTypes={activities}
        detail={formDetail}
        onSuccess={refresh}
      />

      <ViewEventDialog
        eventId={viewId}
        activityById={activityById}
        onClose={() => setViewId(null)}
      />

      <DeleteEventDialog
        event={deleteEvent}
        activityById={activityById}
        onCancel={() => setDeleteEvent(null)}
        onDeleted={() => {
          setDeleteEvent(null);
          setNote("Deleted — scores recomputed.");
          refresh();
        }}
      />
    </div>
  );
}
