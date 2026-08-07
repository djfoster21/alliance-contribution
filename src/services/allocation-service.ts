import type {
  Allocation,
  AllocationInput,
  AllocationMetric,
  AllocationPreview,
  AllocationStrategy,
  AllocationWithLines,
  TierBand,
} from "../../shared/types";
import { computeAllocation, validateTiers } from "../domain/allocation";
import type { AllocationRepo } from "../repositories/allocation-repo";
import type { StatsRepo } from "../repositories/stats-repo";

// Input rejections the routes turn into 400 (anything else is a 500).
export class AllocationValidationError extends Error {}

const METRICS = new Set<AllocationMetric>(["points", "attendance"]);
const STRATEGIES = new Set<AllocationStrategy>(["top_n", "proportional", "proportional_top", "tiered"]);

export class AllocationService {
  constructor(
    private readonly allocationRepo: AllocationRepo,
    private readonly statsRepo: StatsRepo,
  ) {}

  // Compute only — nothing stored. Title not needed for a preview. Preview lines additionally
  // carry `attendance` over the selected weeks (display context for the operator, per the
  // 2026-08-07 design handoff); create() computes fresh and never stores it.
  async preview(input: AllocationInput): Promise<AllocationPreview> {
    const { parsed } = await this.validate(input);
    const result = await this.compute(parsed);
    return { ...result, lines: await this.withAttendance(parsed.weeks, result.lines) };
  }

  // Recomputes from CURRENT data rather than trusting client-submitted lines (preview -> save drift
  // is accepted, spec). The blocking edge: zero computed lines — zero eligible members, or valid
  // tiered bands that all start past the eligible count. Either way a hand-out to nobody is never a
  // valid record; the warnings carry the specific reason.
  async create(input: AllocationInput): Promise<AllocationWithLines> {
    const { parsed, title } = await this.validate(input);
    if (!title) throw new AllocationValidationError("title is required");

    const { lines, warnings } = await this.compute(parsed);
    if (lines.length === 0) {
      throw new AllocationValidationError(
        `this allocation would hand out nothing — a hand-out to nobody is never a valid record (${warnings.join("; ")})`,
      );
    }

    const id = await this.allocationRepo.insertWithLines(
      {
        title,
        quantity: parsed.quantity,
        metric: parsed.metric,
        weeks: parsed.weeks,
        strategy: parsed.strategy,
        tiers: parsed.strategy === "tiered" ? parsed.tiers! : null,
        top_count: parsed.strategy === "proportional_top" ? parsed.topCount! : null,
      },
      lines.map(({ governor: _governor, ...line }) => line),
    );
    const saved = await this.get(id);
    if (!saved) throw new Error("AllocationService.create: allocation missing after insert");
    return saved;
  }

  async list(): Promise<Allocation[]> {
    return this.allocationRepo.list();
  }

  async get(id: number): Promise<AllocationWithLines | null> {
    const allocation = await this.allocationRepo.get(id);
    if (!allocation) return null;
    return { ...allocation, lines: await this.allocationRepo.lines(id) };
  }

  // Title only: recomputing an old allocation from current data can't reproduce it, so a typo fix
  // must not require delete + redo. Lines stay frozen. Returns null for an unknown id (route -> 404).
  async updateTitle(id: number, title: unknown): Promise<Allocation | null> {
    if (typeof title !== "string" || title.trim() === "") {
      throw new AllocationValidationError("title must be a non-empty string");
    }
    const updated = await this.allocationRepo.updateTitle(id, title.trim());
    return updated ? this.allocationRepo.get(id) : null;
  }

  async delete(id: number): Promise<boolean> {
    return this.allocationRepo.delete(id);
  }

  // Shape + semantic validation shared by preview and create. Weeks must be explicit picks from the
  // weeks that actually have events; no presets, no calendar math.
  private async validate(input: AllocationInput): Promise<{ parsed: AllocationInput; title: string }> {
    const errors: string[] = [];
    const { quantity, metric, strategy, weeks, tiers, topCount } = input ?? {};

    if (!Number.isInteger(quantity) || quantity <= 0) errors.push("quantity must be an integer > 0");
    if (!METRICS.has(metric)) errors.push(`metric must be one of: ${[...METRICS].join(", ")}`);
    if (!STRATEGIES.has(strategy)) errors.push(`strategy must be one of: ${[...STRATEGIES].join(", ")}`);

    if (!Array.isArray(weeks) || weeks.length === 0 || weeks.some((w) => typeof w !== "string")) {
      errors.push("weeks must be a non-empty array of event-week strings");
    } else {
      const known = new Set(await this.statsRepo.distinctEventWeeks());
      for (const week of new Set(weeks)) {
        if (!known.has(week)) errors.push(`week ${week} has no events`);
      }
    }

    if (strategy === "tiered" && Number.isInteger(quantity) && quantity > 0) {
      errors.push(...validateTiers(tiers ?? [], quantity));
    }
    if (strategy === "proportional_top" && (!Number.isInteger(topCount) || topCount! < 1)) {
      errors.push("topCount must be an integer >= 1 for proportional_top");
    }

    if (errors.length > 0) throw new AllocationValidationError(errors.join("; "));
    const title = typeof input.title === "string" ? input.title.trim() : "";
    return { parsed: input, title };
  }

  private async compute(input: AllocationInput): Promise<AllocationPreview> {
    const filter = await this.weekFilter(input.weeks);
    const totals =
      input.metric === "points"
        ? await this.statsRepo.scoreTotals(filter)
        : await this.statsRepo.eventDayTotals(filter);

    const result = computeAllocation(totals, input.quantity, input.strategy, {
      tiers: input.tiers,
      topCount: input.topCount,
    });

    // Fold the member display context (alliance_rank/power/last alias) the totals already carry
    // onto the computed lines — the domain stays pure amounts. Every line member came from totals.
    const meta = new Map(totals.map((t) => [t.member_id, t]));
    return {
      ...result,
      lines: result.lines.map((l) => {
        const m = meta.get(l.member_id);
        return {
          ...l,
          alliance_rank: m?.alliance_rank ?? null,
          power: m?.power ?? null,
          last_alias: m?.last_alias ?? null,
        };
      }),
    };
  }

  // Dedupe defensively; omit the SQL filter when every event week is selected (spec).
  private async weekFilter(selected: string[]): Promise<string[] | undefined> {
    const weeks = [...new Set(selected)];
    const allWeeks = await this.statsRepo.distinctEventWeeks();
    return weeks.length === allWeeks.length ? undefined : weeks;
  }

  // Attendance over the selected weeks (distinct event-days attended ÷ total in scope) folded
  // onto computed lines — the preview table's ATT. column.
  private async withAttendance(
    selected: string[],
    lines: AllocationPreview["lines"],
  ): Promise<AllocationPreview["lines"]> {
    if (lines.length === 0) return lines;
    const filter = await this.weekFilter(selected);
    const [dayTotals, total] = await Promise.all([
      this.statsRepo.eventDayTotals(filter),
      this.statsRepo.totalEventDaysInWeeks(filter),
    ]);
    const attended = new Map(dayTotals.map((t) => [t.member_id, t.value]));
    return lines.map((l) => ({
      ...l,
      attendance: total ? (attended.get(l.member_id) ?? 0) / total : 0,
    }));
  }
}
