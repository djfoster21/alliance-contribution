import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Pencil, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import type {
  Allocation,
  AllocationInput,
  AllocationMetric,
  AllocationPreview,
  AllocationStrategy,
  AllocationWithLines,
  TierBand,
} from "@shared/types";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/utils";
import { Alert, AlertContent } from "@/components/ui/alert";
import { AttendanceBadge } from "@/components/AttendanceBadge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MEDALS } from "@/components/ranking-parts";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";

/** Map a thrown error to a clear, actionable message. 401 → API-key hint; 403 → admin-key hint. */
function writeErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Set your API key (top bar) to manage rewards.";
    if (e.status === 403) return "This action requires the admin key.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

/** Uppercase mono micro-label above a field (design: fldLbl), hint in sentence case. */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="truncate font-mono text-[10.5px] font-semibold uppercase tracking-[0.04em] text-faint">
        {label}
        {hint && <span className="ml-1 font-sans font-medium normal-case tracking-normal text-muted">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}

const METRIC_LABELS: Record<AllocationMetric, string> = {
  points: "Participation score",
  attendance: "Attendance (event-days)",
};
const STRATEGY_LABELS: Record<AllocationStrategy, string> = {
  top_n: "Top N (1 each)",
  proportional: "Proportional to metric",
  proportional_top: "Proportional to top…",
  tiered: "Tiered by rank",
};

/** History summary label — proportional_top carries its saved cutoff. */
function strategyText(a: Allocation): string {
  return a.strategy === "proportional_top" ? `Proportional to top ${a.top_count}` : STRATEGY_LABELS[a.strategy];
}

// Tier band row as edited (strings so partially-typed numbers don't fight the input).
type TierDraft = { fromRank: string; toRank: string; amountEach: string };
const EMPTY_BAND: TierDraft = { fromRank: "", toRank: "", amountEach: "" };

function parseTiers(drafts: TierDraft[]): TierBand[] {
  return drafts.map((d) => ({
    fromRank: Number(d.fromRank),
    toRank: Number(d.toRank),
    amountEach: Number(d.amountEach),
  }));
}

// Amount badge intensity scale (design handoff): darkest = the biggest hand-out, fading down.
// Fixed hexes on purpose — a data accent like the medal colors, identical in both themes.
const AMOUNT_SCALE: [string, string][] = [
  ["#1e3a8a", "#ffffff"],
  ["#1d4ed8", "#ffffff"],
  ["#3b82f6", "#ffffff"],
  ["#93c5fd", "#1e3a8a"],
  ["#dbeafe", "#1e40af"],
  ["#eff6ff", "#60a5fa"],
];

function amountColors(amount: number, maxAmount: number): [string, string] {
  const i = Math.min(5, Math.floor((1 - amount / maxAmount) * 6));
  return AMOUNT_SCALE[Math.max(0, i)];
}

/** Rank badge — medal colors for the top 3 (same palette as the ranking podium), neutral below. */
function RankBadge({ rank }: { rank: number }) {
  const medal = MEDALS[rank];
  return (
    <span
      className={cn(
        "num inline-flex h-6 min-w-[28px] items-center justify-center rounded-[7px] px-1.5 font-mono text-[12.5px] font-bold",
        !medal && "bg-muted-surface text-muted",
      )}
      style={medal ? { background: medal.bar, color: "#fff" } : undefined}
    >
      {rank}
    </span>
  );
}

const TH = "sticky top-0 z-[2] border-b border-border bg-surface px-3.5 py-2.5 text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.04em] text-muted";
const TD = "border-b border-border/50 px-3.5 py-2";

/** Shared by preview and history: rank badge, avatar, attendance (preview only), metric bar,
 *  amount badge. Fixed layout — the design's tight columns, member takes the slack. */
function LinesTable({ lines, metric }: { lines: AllocationWithLines["lines"]; metric: string }) {
  const maxValue = Math.max(...lines.map((l) => l.metric_value), 1);
  const maxAmount = Math.max(...lines.map((l) => l.amount), 1);
  const showAttendance = lines.some((l) => l.attendance !== undefined);
  return (
    <div className="max-h-[480px] overflow-auto rounded-[10px] border border-border">
      <table className="w-full table-fixed border-collapse text-[13px]">
        <colgroup>
          <col className="w-14" />
          <col />
          {showAttendance && <col className="w-[88px]" />}
          <col className="w-[190px]" />
          <col className="w-20" />
        </colgroup>
        <thead>
          <tr>
            <th className={TH}>Rank</th>
            <th className={TH}>Member</th>
            {showAttendance && <th className={cn(TH, "px-2 text-center")}>Att.</th>}
            <th className={cn(TH, "text-right")}>{metric === "points" ? "Score" : "Event-days"}</th>
            <th className={cn(TH, "pr-4 text-right")}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const medal = MEDALS[l.rank];
            const [amountBg, amountFg] = amountColors(l.amount, maxAmount);
            return (
              <tr key={`${l.member_id}-${i}`} className="transition-colors hover:bg-background">
                <td className={TD}>
                  <RankBadge rank={l.rank} />
                </td>
                <td className={TD}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar
                      name={l.governor}
                      size={28}
                      style={medal ? { background: medal.bar, borderColor: medal.bar, color: "#fff" } : undefined}
                    />
                    <span className="truncate text-[13.5px] font-semibold text-foreground">{l.governor}</span>
                  </div>
                </td>
                {showAttendance && (
                  <td className={cn(TD, "px-2 text-center")}>
                    <AttendanceBadge pct={l.attendance ?? 0} />
                  </td>
                )}
                <td className={TD}>
                  <div className="flex items-center justify-end gap-2.5">
                    <div className="w-[110px] shrink-0">
                      <Progress
                        value={Math.max(2, Math.round((l.metric_value / maxValue) * 100))}
                        className="h-1.5"
                        indicatorClassName="bg-foreground"
                      />
                    </div>
                    <span className="num min-w-[34px] text-right text-[13px] font-semibold">{l.metric_value}</span>
                  </div>
                </td>
                <td className={cn(TD, "pr-4 text-right")}>
                  <span
                    className="num inline-flex h-[26px] min-w-[34px] items-center justify-center rounded-[7px] px-2 font-mono text-[14px] font-bold"
                    style={{ background: amountBg, color: amountFg }}
                  >
                    {l.amount}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One history row: summary line, expandable to its saved lines; inline title rename; delete. */
function HistoryRow({
  allocation,
  onChanged,
}: {
  allocation: Allocation;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<AllocationWithLines | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(allocation.title);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const open = !expanded;
    setExpanded(open);
    if (open && !detail) {
      setError(null);
      try {
        setDetail(await api.allocations.get(allocation.id));
      } catch (e) {
        // Collapse again so re-expanding retries instead of spinning forever under a stale banner.
        setError(writeErrorMessage(e));
        setExpanded(false);
      }
    }
  }

  async function saveTitle() {
    const next = title.trim();
    if (next === "" || next === allocation.title) {
      setEditing(false);
      setTitle(allocation.title);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.allocations.updateTitle(allocation.id, next);
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(writeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.allocations.delete(allocation.id);
      setConfirming(false);
      onChanged();
    } catch (e) {
      setError(writeErrorMessage(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const summary = `${allocation.quantity} × ${METRIC_LABELS[allocation.metric]} · ${strategyText(allocation)} · ${allocation.weeks.length} week${allocation.weeks.length === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col border-b border-border last:border-b-0">
      {error && <ErrorState message={error} />}
      <div className="flex items-center gap-2 py-2.5">
        <button type="button" onClick={toggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {expanded ? (
            <ChevronDown className="size-4 shrink-0 text-muted" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted" />
          )}
          <div className="flex min-w-0 flex-col">
            {editing ? null : (
              <span className="truncate text-[13.5px] font-medium text-foreground">{allocation.title}</span>
            )}
            <span className="truncate text-[12px] text-muted">
              {allocation.created_at.slice(0, 10)} · {summary}
            </span>
          </div>
        </button>
        {editing ? (
          <div className="flex items-center gap-1">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveTitle()}
              className="h-8 w-56"
              autoFocus
            />
            <Button size="sm" onClick={saveTitle} disabled={busy}>
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setTitle(allocation.title);
              }}
            >
              <X />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} title="Rename">
              <Pencil />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} title="Delete">
              <Trash2 />
            </Button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="pb-3 pl-6">
          {detail ? <LinesTable lines={detail.lines} metric={allocation.metric} /> : <LoadingState />}
        </div>
      )}

      <Dialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this allocation?</DialogTitle>
            <DialogDescription>
              “{allocation.title}” and its {allocation.quantity}-item hand-out record will be removed
              permanently. Saved amounts cannot be recomputed later — data changes under old inputs.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={remove} disabled={busy}>
              {busy ? "Deleting…" : "Delete allocation"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function Rewards() {
  const weeksState = useApi(() => api.weeks(), []); // newest first
  const [historyVersion, setHistoryVersion] = useState(0);
  const historyState = useApi(() => api.allocations.list(), [historyVersion]);

  const [title, setTitle] = useState("");
  const [quantity, setQuantity] = useState("");
  const [metric, setMetric] = useState<AllocationMetric>("points");
  const [strategy, setStrategy] = useState<AllocationStrategy>("top_n");
  const [selectedWeeks, setSelectedWeeks] = useState<string[] | null>(null); // null until preselect
  const [tiers, setTiers] = useState<TierDraft[]>([{ ...EMPTY_BAND }]);
  const [topCount, setTopCount] = useState("");

  const [preview, setPreview] = useState<AllocationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const weeks = weeksState.data ?? [];
  // UI preselects the 4 most recent event weeks; "all weeks" is just selecting everything.
  useEffect(() => {
    if (weeksState.data && selectedWeeks === null) setSelectedWeeks(weeksState.data.slice(0, 4));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeksState.data]);

  const picked = selectedWeeks ?? [];

  // Any input change invalidates the current preview; re-previewing is one click.
  function touch<T>(setter: (v: T) => void): (v: T) => void {
    return (v) => {
      setPreview(null);
      setSaved(null);
      setter(v);
    };
  }
  const setMetricT = touch(setMetric);
  const setStrategyT = touch(setStrategy);
  const setQuantityT = touch(setQuantity);
  const setTiersT = touch(setTiers);
  const setSelectedWeeksT = touch(setSelectedWeeks);
  const setTopCountT = touch(setTopCount);

  function buildInput(): AllocationInput {
    return {
      title: title.trim() === "" ? undefined : title.trim(),
      quantity: Number(quantity),
      metric,
      weeks: picked,
      strategy,
      ...(strategy === "tiered" ? { tiers: parseTiers(tiers) } : {}),
      ...(strategy === "proportional_top" ? { topCount: Number(topCount) } : {}),
    };
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      setPreview(await api.allocations.preview(buildInput()));
    } catch (e) {
      setPreview(null);
      setError(writeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const created = await api.allocations.create(buildInput());
      setSaved(`“${created.title}” saved — ${created.lines.length} member(s)`);
      setPreview(null);
      setTitle("");
      setQuantity("");
      setHistoryVersion((v) => v + 1);
    } catch (e) {
      setError(writeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const canPreview =
    !busy && picked.length > 0 && Number(quantity) > 0 && (strategy !== "proportional_top" || Number(topCount) > 0);
  const canSave = !busy && preview !== null && preview.lines.length > 0 && title.trim() !== "";

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorState message={error} />}

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] font-semibold text-foreground">New allocation</span>
          <span className="text-[12.5px] text-muted">
            Split a batch of rewards across the roster by tracked participation. Preview is free —
            compare strategies before saving.
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Title" hint="required to save">
            <Input placeholder="e.g. KvK payout" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Quantity">
            <Input
              type="number"
              min={1}
              step={1}
              placeholder="e.g. 400"
              value={quantity}
              onChange={(e) => setQuantityT(e.target.value)}
            />
          </Field>
          <Field label="Metric">
            <Select value={metric} onValueChange={(v) => setMetricT(v as AllocationMetric)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(METRIC_LABELS) as AllocationMetric[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {METRIC_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Strategy">
            <Select value={strategy} onValueChange={(v) => setStrategyT(v as AllocationStrategy)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STRATEGY_LABELS) as AllocationStrategy[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STRATEGY_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field label="Weeks" hint="newest first — pick the weeks the rewards cover">
          {weeksState.loading ? (
            <LoadingState label="Loading weeks…" />
          ) : weeksState.error ? (
            <ErrorState message={weeksState.error} />
          ) : weeks.length === 0 ? (
            <EmptyState message="No event weeks yet — ingest events first." />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedWeeksT(picked.length === weeks.length ? [] : [...weeks])}
                className="h-[30px] w-[92px] rounded-full border border-dashed border-faint bg-surface text-[12px] font-semibold text-secondary transition-colors hover:bg-background"
              >
                {picked.length === weeks.length ? "Clear all" : "Select all"}
              </button>
              <span className="mr-2 text-[12px] text-muted">
                {picked.length} of {weeks.length} selected
              </span>
              {weeks.map((week) => {
                const checked = picked.includes(week);
                return (
                  <button
                    key={week}
                    type="button"
                    onClick={() =>
                      setSelectedWeeksT(checked ? picked.filter((w) => w !== week) : [...picked, week])
                    }
                    className={cn(
                      "inline-flex h-[30px] items-center rounded-full border px-3 font-mono text-[12px] font-semibold transition-all",
                      checked
                        ? "border-foreground bg-foreground text-accent-foreground"
                        : "border-border bg-surface text-muted hover:border-faint",
                    )}
                  >
                    {week}
                  </button>
                );
              })}
            </div>
          )}
        </Field>

        {strategy === "proportional_top" && (
          <Field label="Top count" hint="quantity is split by metric share among ranks 1..N only">
            <Input
              type="number"
              min={1}
              step={1}
              placeholder="e.g. 20"
              value={topCount}
              onChange={(e) => setTopCountT(e.target.value)}
              className="w-40"
            />
          </Field>
        )}

        {strategy === "tiered" && (
          <Field label="Bands" hint="ranks are 1-based, inclusive; gaps allowed, overlaps not">
            <div className="flex flex-col gap-2">
              {tiers.map((band, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    placeholder="From rank"
                    value={band.fromRank}
                    onChange={(e) => setTiersT(tiers.map((b, j) => (j === i ? { ...b, fromRank: e.target.value } : b)))}
                    className="w-28"
                  />
                  <span className="text-[12px] text-muted">–</span>
                  <Input
                    type="number"
                    min={1}
                    placeholder="To rank"
                    value={band.toRank}
                    onChange={(e) => setTiersT(tiers.map((b, j) => (j === i ? { ...b, toRank: e.target.value } : b)))}
                    className="w-28"
                  />
                  <Input
                    type="number"
                    min={1}
                    placeholder="Each gets"
                    value={band.amountEach}
                    onChange={(e) => setTiersT(tiers.map((b, j) => (j === i ? { ...b, amountEach: e.target.value } : b)))}
                    className="w-28"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTiersT(tiers.filter((_, j) => j !== i))}
                    disabled={tiers.length === 1}
                    title="Remove band"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <div>
                <Button variant="secondary" size="sm" onClick={() => setTiersT([...tiers, { ...EMPTY_BAND }])}>
                  <Plus />
                  Add band
                </Button>
              </div>
            </div>
          </Field>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <Button size="sm" onClick={runPreview} disabled={!canPreview}>
            Preview
          </Button>
          <Button size="sm" variant="secondary" onClick={save} disabled={!canSave}>
            Save allocation
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-up">
              <Check className="size-3.5" strokeWidth={2.4} />
              {saved}
            </span>
          )}
          {preview !== null && title.trim() === "" && (
            <span className="text-[12px] text-muted">Add a title to save.</span>
          )}
        </div>

        {preview && (
          <div className="flex flex-col gap-3">
            {preview.warnings.map((w, i) => (
              <Alert key={i} variant="destructive">
                <TriangleAlert />
                <AlertContent>{w}</AlertContent>
              </Alert>
            ))}
            {preview.lines.length === 0 ? (
              // Zero lines ≠ zero eligible: valid tiered bands can all start past the eligible count.
              // The warnings above carry the specific reason; keep this line cause-neutral.
              <EmptyState message="This allocation would hand out nothing — adjust the quantity, weeks, or bands." />
            ) : (
              <>
                <span className="text-[13px] text-secondary">
                  {preview.lines.length} member(s) receive{" "}
                  <span className="num font-bold text-foreground">
                    {preview.lines.reduce((sum, l) => sum + l.amount, 0)}
                  </span>{" "}
                  of {quantity} item(s).
                </span>
                <LinesTable lines={preview.lines} metric={metric} />
              </>
            )}
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-2 p-5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] font-semibold text-foreground">History</span>
          <span className="text-[12.5px] text-muted">
            Saved hand-outs. Lines are frozen as computed at save time; only the title can change.
          </span>
        </div>
        {historyState.loading ? (
          <LoadingState />
        ) : historyState.error ? (
          <ErrorState message={historyState.error} />
        ) : (historyState.data ?? []).length === 0 ? (
          <EmptyState message="No allocations saved yet." />
        ) : (
          <div className="flex flex-col">
            {(historyState.data ?? []).map((a) => (
              <HistoryRow key={`${a.id}-${a.title}`} allocation={a} onChanged={() => setHistoryVersion((v) => v + 1)} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
