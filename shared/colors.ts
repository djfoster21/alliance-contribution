/** The fixed activity-colour palette. Token names map to --color-badge-<token>-* CSS vars. */
export const ACTIVITY_COLORS = [
  "blue", "green", "violet", "sky", "amber", "red", "slate", "pink",
] as const;
export type ActivityColor = (typeof ACTIVITY_COLORS)[number];
export const DEFAULT_ACTIVITY_COLOR: ActivityColor = "slate";
export function isActivityColor(v: unknown): v is ActivityColor {
  return typeof v === "string" && (ACTIVITY_COLORS as readonly string[]).includes(v);
}
