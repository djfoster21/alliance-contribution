// Pure config-driven scoring. No I/O, no libraries.

export type Tier = { min_value: number; points: number };

// Largest min_value <= value wins. No matching tier (incl. empty array) => 0.
// Does not assume tiers is pre-sorted.
export function tierPoints(tiers: Tier[], value: number): number {
  let best: Tier | undefined;
  for (const tier of tiers) {
    if (tier.min_value <= value && (!best || tier.min_value > best.min_value)) {
      best = tier;
    }
  }
  return best ? best.points : 0;
}

// tierPoints(tiers, value) * weight. weight can be fractional; result is not rounded.
export function scoreAppearance(tiers: Tier[], weight: number, value: number): number {
  return tierPoints(tiers, value) * weight;
}
