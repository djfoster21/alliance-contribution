import type { ActivityType } from "../../shared/types";
import type { ActivityRepo } from "../repositories/activity-repo";
import type { EventRepo } from "../repositories/event-repo";
import { ACTIVITY_COLORS, DEFAULT_ACTIVITY_COLOR, isActivityColor } from "../../shared/colors";
import type { RecomputeService } from "./recompute-service";

export type CreateActivityInput = {
  key: string;
  name: string;
  unit_label?: string | null;
  weight?: number;
  max_instance?: number;
  min_value?: number;
  active?: number;
  sort?: number;
  color?: string;
};

export type UpdateActivityInput = Partial<
  Pick<
    ActivityType,
    "key" | "name" | "unit_label" | "weight" | "max_instance" | "min_value" | "active" | "sort" | "color"
  >
>;

export class ActivityService {
  constructor(
    private readonly activityRepo: ActivityRepo,
    private readonly eventRepo: EventRepo,
    private readonly recompute: RecomputeService,
  ) {}

  async list(opts?: { active?: boolean }): Promise<ActivityType[]> {
    return this.activityRepo.list(opts);
  }

  async get(id: number): Promise<ActivityType | null> {
    return this.activityRepo.getById(id);
  }

  // A duplicate key surfaces as the repo's UNIQUE constraint error — let it propagate.
  async create(dto: CreateActivityInput): Promise<ActivityType> {
    assertNonEmpty("key", dto.key);
    assertNonEmpty("name", dto.name);

    const weight = dto.weight ?? 1;
    const max_instance = dto.max_instance ?? 1;
    const min_value = dto.min_value ?? 0;
    validateNumericFields({ weight, max_instance, min_value });
    const color = dto.color ?? DEFAULT_ACTIVITY_COLOR;
    assertValidColor(color);

    return this.activityRepo.insert({
      key: dto.key,
      name: dto.name,
      unit_label: dto.unit_label ?? null,
      weight,
      max_instance,
      min_value,
      active: dto.active ?? 1,
      sort: dto.sort ?? 0,
      color,
    });
  }

  // `weight` multiplies every scored appearance, so changing it re-scores all history through
  // RecomputeService (the same mechanism ScoringService.replaceScoring uses) — otherwise stored points
  // would be stale against the live weight the possible-points denominators read. Every other field is
  // exempt: key/name/unit_label/sort/active/color are labelling only, and `min_value` just gates which
  // rows ingest keeps — none of them change the points already stored.
  async update(id: number, fields: UpdateActivityInput): Promise<ActivityType | null> {
    if ("key" in fields) assertNonEmpty("key", fields.key);
    if ("name" in fields) assertNonEmpty("name", fields.name);
    validateNumericFields(fields);
    if (fields.color !== undefined) assertValidColor(fields.color);
    if (fields.max_instance !== undefined) {
      await assertInstancesFit(this.eventRepo, id, fields.max_instance);
    }

    const updated = await this.activityRepo.update(id, fields);
    if (updated && fields.weight !== undefined) await this.recompute.run();
    return updated;
  }

  // Deactivate rather than delete — keeps history scorable (spec: never hard-delete a type with events).
  async deactivate(id: number): Promise<void> {
    await this.activityRepo.deactivate(id);
  }
}

function assertNonEmpty(field: "key" | "name", value: unknown): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid activity type: ${field} must be a non-empty string`);
  }
}

function assertValidColor(color: unknown): void {
  if (!isActivityColor(color)) {
    throw new Error(`Invalid activity type: color must be one of ${ACTIVITY_COLORS.join(", ")}`);
  }
}

// Lowering max_instance below an instance already logged would orphan those events and, for Bear, silence
// the two-trap uniqueness scan for good (AliasService.scanConflicts only groups max_instance === 2
// activities) — so reject the decrease instead. No events yet => nothing to protect.
async function assertInstancesFit(
  eventRepo: EventRepo,
  activityTypeId: number,
  max_instance: number,
): Promise<void> {
  const used = await eventRepo.maxInstance(activityTypeId);
  if (max_instance < used) {
    throw new Error(
      `Invalid activity type: max_instance must be >= ${used} — events already exist at instance ${used}`,
    );
  }
}

function validateNumericFields(fields: {
  weight?: number;
  max_instance?: number;
  min_value?: number;
}): void {
  if (fields.weight !== undefined && (!Number.isFinite(fields.weight) || fields.weight < 0)) {
    throw new Error("Invalid activity type: weight must be a finite number >= 0");
  }
  if (fields.min_value !== undefined && (!Number.isFinite(fields.min_value) || fields.min_value < 0)) {
    throw new Error("Invalid activity type: min_value must be a finite number >= 0");
  }
  if (
    fields.max_instance !== undefined &&
    (!Number.isInteger(fields.max_instance) || fields.max_instance < 1)
  ) {
    throw new Error("Invalid activity type: max_instance must be an integer >= 1");
  }
}
