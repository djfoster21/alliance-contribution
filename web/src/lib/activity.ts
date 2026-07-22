import type { ActivityColor } from "@shared/colors";
import { DEFAULT_ACTIVITY_COLOR, isActivityColor } from "@shared/colors";

/** token → badge classes (tinted bg + saturated fg text). */
const BADGE: Record<ActivityColor, string> = {
  blue: "bg-badge-blue-bg text-badge-blue-fg",
  green: "bg-badge-green-bg text-badge-green-fg",
  violet: "bg-badge-violet-bg text-badge-violet-fg",
  sky: "bg-badge-sky-bg text-badge-sky-fg",
  amber: "bg-badge-amber-bg text-badge-amber-fg",
  red: "bg-badge-red-bg text-badge-red-fg",
  slate: "bg-badge-slate-bg text-badge-slate-fg",
  pink: "bg-badge-pink-bg text-badge-pink-fg",
};

/** token → solid fill class (bars, swatches). */
const SOLID: Record<ActivityColor, string> = {
  blue: "bg-badge-blue-fg",
  green: "bg-badge-green-fg",
  violet: "bg-badge-violet-fg",
  sky: "bg-badge-sky-fg",
  amber: "bg-badge-amber-fg",
  red: "bg-badge-red-fg",
  slate: "bg-badge-slate-fg",
  pink: "bg-badge-pink-fg",
};

function coerce(color: string): ActivityColor {
  return isActivityColor(color) ? color : DEFAULT_ACTIVITY_COLOR;
}

/** Tinted pill (badge) classes for an activity colour token. */
export function activityBadgeClass(color: string): string {
  return BADGE[coerce(color)];
}

/** Solid fill (bars, swatches) class for an activity colour token. */
export function activitySolidClass(color: string): string {
  return SOLID[coerce(color)];
}

/** CSS `var(...)` for the solid fill — for contexts needing a color value, not a class (e.g. recharts). */
export function activityFillVar(color: string): string {
  return `var(--color-badge-${coerce(color)}-fg)`;
}
