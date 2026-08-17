import type { ActivityType, Event, EventListRow, NewParticipation } from "../../shared/types";
import {
  findTwoTrapOverlaps,
  findWithinEventDuplicates,
  type ResolvedRow,
} from "../domain/ingest-validation";
import { normalizeName } from "../domain/resolve";
import { isoWeek } from "../domain/week";
import type { ActivityRepo } from "../repositories/activity-repo";
import type { EventRepo } from "../repositories/event-repo";
import type { ParticipationRepo } from "../repositories/participation-repo";
import type { RecomputeService } from "./recompute-service";
import type { ResolveService } from "./resolve-service";

export type IngestRow = { raw_name: string; value: number; notes?: string | null };
const MAX_INGEST_ROWS = 500;

export type IngestDto = { activity: string; date: string; instance?: number; rows: IngestRow[] };

// A participation joined to its resolved member's governor (NULL when unmapped).
export type EventParticipationRow = {
  id: number;
  raw_name: string;
  member_id: number | null;
  governor: string | null;
  value: number;
  points: number;
  notes: string | null;
};

export type IngestResult = {
  event: Event;
  rows: EventParticipationRow[]; // post-recompute
  skipped: { raw_name: string; value: number }[]; // value <= activity.min_value
  unmapped: string[]; // distinct raw_names with member_id NULL post-recompute
};

export class EventService {
  constructor(
    private readonly eventRepo: EventRepo,
    private readonly participationRepo: ParticipationRepo,
    private readonly activityRepo: ActivityRepo,
    private readonly resolveService: ResolveService,
    private readonly recomputeService: RecomputeService,
  ) {}

  async list(filter?: {
    activity?: string;
    week?: string;
    from?: string;
    to?: string;
  }): Promise<EventListRow[]> {
    let activity_type_id: number | undefined;
    if (filter?.activity !== undefined) {
      const activity = await this.activityRepo.getByKey(filter.activity);
      if (!activity) throw new Error("activity type not found");
      activity_type_id = activity.id;
    }
    return this.eventRepo.list({
      activity_type_id,
      week: filter?.week,
      from: filter?.from,
      to: filter?.to,
    });
  }

  async get(id: number): Promise<{ event: Event; participations: EventParticipationRow[] } | null> {
    const event = await this.eventRepo.getById(id);
    if (!event) return null;
    const participations = await this.participationRepo.listByEventWithMember(id);
    return { event, participations };
  }

  async create(dto: IngestDto): Promise<IngestResult> {
    const { activity, instance, week } = await this.resolveActivityAndInstance(dto);
    const existing = await this.eventRepo.getByKey(activity.id, dto.date, instance);

    return this.ingest(
      activity,
      dto.date,
      instance,
      dto.rows,
      existing?.id ?? null,
      () =>
        existing
          ? Promise.resolve(existing)
          : this.eventRepo.insert({
              activity_type_id: activity.id,
              date: dto.date,
              week,
              instance,
            }),
    );
  }

  async update(id: number, dto: IngestDto): Promise<IngestResult> {
    const event = await this.eventRepo.getById(id);
    if (!event) throw new Error("event not found");

    const { activity, instance, week } = await this.resolveActivityAndInstance(dto);

    const keyChanged =
      activity.id !== event.activity_type_id ||
      dto.date !== event.date ||
      instance !== event.instance;
    if (keyChanged) {
      const collision = await this.eventRepo.getByKey(activity.id, dto.date, instance);
      if (collision && collision.id !== id) {
        throw new Error("conflict: another event already exists with that activity, date, and instance");
      }
    }

    return this.ingest(activity, dto.date, instance, dto.rows, id, () =>
      this.eventRepo.updateKey(id, {
        activity_type_id: activity.id,
        date: dto.date,
        week,
        instance,
      }),
    );
  }

  async delete(id: number): Promise<void> {
    await this.eventRepo.delete(id);
    await this.recomputeService.run();
  }

  // The unmapped queue: distinct raw names still resolving to NULL, each with where they appeared.
  async listUnmapped(): ReturnType<ParticipationRepo["listUnmapped"]> {
    return this.participationRepo.listUnmapped();
  }

  private async resolveActivityAndInstance(
    dto: IngestDto,
  ): Promise<{ activity: ActivityType; instance: number; week: string }> {
    const activity = await this.activityRepo.getByKey(dto.activity);
    if (!activity) throw new Error("activity type not found");

    const instance = dto.instance ?? 1;
    if (!Number.isInteger(instance) || instance < 1 || instance > activity.max_instance) {
      throw new Error(`invalid instance: must be an integer between 1 and ${activity.max_instance}`);
    }

    const week = isoWeek(dto.date);
    return { activity, instance, week };
  }

  // Shared ingest core for create + update: resolve + validate on identity FIRST, then (only if valid)
  // materialize the event, replace its raw rows, and recompute. A rejected correction never touches the
  // stored event. `materializeEvent` inserts (create-new) or updates the key (update), run post-validation.
  private async ingest(
    activity: ActivityType,
    date: string,
    instance: number,
    rows: IngestRow[],
    excludeEventId: number | null,
    materializeEvent: () => Promise<Event>,
  ): Promise<IngestResult> {
    // ponytail: hard cap on paste size; a ranking screen is <100 rows, so anything larger is a mistake or abuse.
    if (rows.length > MAX_INGEST_ROWS) throw new Error(`too many rows: ${rows.length} (max ${MAX_INGEST_ROWS})`);

    const resolver = await this.resolveService.buildResolver();

    const skipped: { raw_name: string; value: number }[] = [];
    const keptResolved: ResolvedRow[] = [];
    const keptRaw: { raw_name: string; value: number; notes: string | null }[] = [];

    for (const row of rows) {
      const name = normalizeName(row.raw_name);
      // Loud rejection, never a silent skip: a non-numeric/missing value slips past the min_value check
      // below (NaN comparisons are always false), lands in the REAL column as text that scores 0 forever,
      // and still counts as an appearance + attendance day. `null` takes the other branch and would be
      // reported as "skipped" — both are bad input, not participation data.
      if (!Number.isFinite(row.value)) {
        throw new Error(
          `invalid value for "${name}": must be a finite number (got ${String(row.value)})`,
        );
      }
      if (row.value <= activity.min_value) {
        skipped.push({ raw_name: name, value: row.value });
        continue;
      }
      keptResolved.push({ raw_name: name, member_id: resolver.resolve(name) });
      keptRaw.push({ raw_name: name, value: row.value, notes: row.notes ?? null });
    }

    // Repeated normalized raw name within the event — even when unmapped. UNIQUE(event_id, raw_name)
    // would otherwise fail mid-INSERT, after the event/key was already committed (not one transaction).
    const seen = new Set<string>();
    const repeatedNames = [
      ...new Set(keptRaw.filter((r) => seen.size === seen.add(r.raw_name).size).map((r) => r.raw_name)),
    ];
    if (repeatedNames.length > 0) {
      throw new Error(`duplicate: repeated raw name within the event: ${repeatedNames.join(", ")}`);
    }

    // Within-event duplicate: two raw names resolving to the same member.
    const duplicates = findWithinEventDuplicates(keptResolved);
    if (duplicates.length > 0) {
      const groups = duplicates
        .map((d) => `member ${d.member_id} (${d.raw_names.join(", ")})`)
        .join("; ");
      throw new Error(`duplicate: rows resolve to the same member within the event: ${groups}`);
    }

    // Bear two-trap: a member (or unresolved raw name) can't appear in both traps on the same date.
    if (activity.max_instance === 2) {
      const siblingInstance = instance === 1 ? 2 : 1;
      const sibling = await this.eventRepo.getByKey(activity.id, date, siblingInstance);
      if (sibling && sibling.id !== excludeEventId) {
        const siblingParticipations = await this.participationRepo.listByEvent(sibling.id);
        const siblingResolved: ResolvedRow[] = siblingParticipations.map((p) => ({
          raw_name: p.raw_name,
          member_id: resolver.resolve(p.raw_name),
        }));
        const overlaps = findTwoTrapOverlaps(keptResolved, siblingResolved);
        if (overlaps.length > 0) {
          const names = overlaps.map((o) => o.raw_name).join(", ");
          throw new Error(
            `two-trap overlap: ${names} already appear in trap ${siblingInstance} on ${date}`,
          );
        }
      }
    }

    // Validation passed — materialize the event, then replace its raw rows and recompute.
    const event = await materializeEvent();
    const rawRows: NewParticipation[] = keptRaw.map((r) => ({
      event_id: event.id,
      raw_name: r.raw_name,
      member_id: null,
      value: r.value,
      points: 0,
      notes: r.notes,
    }));
    await this.participationRepo.replaceForEvent(event.id, rawRows);
    await this.recomputeService.run();

    const fresh = await this.eventRepo.getById(event.id);
    if (!fresh) throw new Error("EventService.ingest: event missing after write");
    const resultRows = await this.participationRepo.listByEventWithMember(event.id);
    const unmapped = [
      ...new Set(resultRows.filter((r) => r.member_id === null).map((r) => r.raw_name)),
    ];

    return { event: fresh, rows: resultRows, skipped, unmapped };
  }
}
