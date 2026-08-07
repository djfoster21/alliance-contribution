import type { AllocationLine, AllocationStrategy, TierBand } from "../../shared/types";

/** One member's metric total in the selected weeks, as StatsRepo returns it (unranked). */
export type MetricTotal = { member_id: number; governor: string; value: number };

export type AllocationResult = { lines: AllocationLine[]; warnings: string[] };

/** Strategy-specific config: tiers for `tiered`, topCount for `proportional_top`. */
export type AllocationOpts = { tiers?: TierBand[]; topCount?: number };

// Structural + semantic validation of tiered bands (spec: rejected with 400). Returns every
// violation; [] = valid. Bands may leave gaps; they may not overlap, and their nominal total
// Σ (toRank - fromRank + 1) × amountEach may not exceed quantity. A nominal total UNDER quantity
// is fine — the 100% rule redistributes the difference from rank 1 at compute time.
export function validateTiers(tiers: TierBand[], quantity: number): string[] {
  const errors: string[] = [];
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return ["tiered strategy needs at least one band"];
  }

  for (const [i, band] of tiers.entries()) {
    const label = `band ${i + 1}`;
    if (!Number.isInteger(band?.fromRank) || !Number.isInteger(band?.toRank) || band.fromRank < 1 || band.toRank < band.fromRank) {
      errors.push(`${label}: needs integer ranks with 1 <= fromRank <= toRank`);
    }
    if (!Number.isInteger(band?.amountEach) || band.amountEach <= 0) {
      errors.push(`${label}: amountEach must be an integer > 0`);
    }
  }
  if (errors.length > 0) return errors; // rank/amount junk makes the checks below meaningless

  const sorted = [...tiers].sort((a, b) => a.fromRank - b.fromRank);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].fromRank <= sorted[i - 1].toRank) {
      errors.push(`bands ${sorted[i - 1].fromRank}-${sorted[i - 1].toRank} and ${sorted[i].fromRank}-${sorted[i].toRank} overlap`);
    }
  }

  const nominal = tiers.reduce((sum, b) => sum + (b.toRank - b.fromRank + 1) * b.amountEach, 0);
  if (nominal > quantity) {
    errors.push(`bands hand out ${nominal} nominally, more than the quantity ${quantity}`);
  }
  return errors;
}

// Pure split computation. Eligibility: metric value > 0, ranked value desc with the boards'
// deterministic tie-break (governor codepoint asc), rank 1-based. Assumes tiers already passed
// validateTiers and topCount is a positive integer. Warnings never block a preview; the service
// rejects only the zero-line save.
//
// 100% rule: whenever at least one member receives, the lines sum EXACTLY to quantity — any
// shortfall a strategy leaves (top_n with fewer eligible members than items, tiered bands under
// quantity or truncated) is redistributed +1 at a time from rank 1 among the members already
// receiving. Only a computation with zero recipients leaves items unallocated (and the service
// blocks saving that).
export function computeAllocation(
  totals: MetricTotal[],
  quantity: number,
  strategy: AllocationStrategy,
  opts: AllocationOpts = {},
): AllocationResult {
  const ranked = totals
    .filter((t) => t.value > 0)
    .sort((a, b) => b.value - a.value || (a.governor < b.governor ? -1 : a.governor > b.governor ? 1 : 0))
    .map((t, i) => ({ member_id: t.member_id, governor: t.governor, rank: i + 1, metric_value: t.value }));

  if (ranked.length === 0) {
    return { lines: [], warnings: ["No eligible members (metric value > 0) in the selected weeks."] };
  }

  const warnings: string[] = [];
  let amounts: number[]; // per ranked index; 0 = no line

  if (strategy === "top_n") {
    amounts = ranked.map((_, i) => (i < quantity ? 1 : 0));
    if (quantity > ranked.length) {
      warnings.push(`Only ${ranked.length} eligible member(s) for ${quantity} items.`);
    }
  } else if (strategy === "proportional") {
    amounts = largestRemainder(ranked.map((r) => r.metric_value), quantity);
  } else if (strategy === "proportional_top") {
    const topCount = opts.topCount ?? 0;
    const n = Math.min(topCount, ranked.length);
    if (topCount > ranked.length) {
      warnings.push(`Top ${topCount} truncated at ${ranked.length} eligible member(s).`);
    }
    const split = largestRemainder(ranked.slice(0, n).map((r) => r.metric_value), quantity);
    amounts = ranked.map((_, i) => (i < n ? split[i] : 0));
    if (n > 0 && n < ranked.length && ranked[n].metric_value === ranked[n - 1].metric_value) {
      warnings.push(
        `Tie at the top-${topCount} cutoff: ${ranked[n - 1].governor} (rank ${n}) and ${ranked[n].governor} ` +
          `(rank ${n + 1}) both have ${ranked[n].metric_value}, but only rank ${n} is inside the top ${topCount}.`,
      );
    }
  } else {
    amounts = ranked.map(() => 0);
    for (const band of opts.tiers ?? []) {
      if (band.fromRank > ranked.length) {
        warnings.push(`Band ${band.fromRank}-${band.toRank} is beyond the ${ranked.length} eligible member(s) — nobody in it.`);
        continue;
      }
      if (band.toRank > ranked.length) {
        warnings.push(`Band ${band.fromRank}-${band.toRank} truncated at ${ranked.length} eligible member(s).`);
      }
      for (let rank = band.fromRank; rank <= Math.min(band.toRank, ranked.length); rank++) {
        amounts[rank - 1] = band.amountEach;
      }
    }
  }

  // Tie across a cutoff (top_n rank-N boundary, tiered band edge): adjacent equal metric values
  // receiving different amounts. Not run for the proportional strategies — equal values differing
  // by one unit is largest-remainder's normal, deterministic outcome, not a boundary artifact
  // (proportional_top's cutoff gets its own explicit check above).
  if (strategy === "top_n" || strategy === "tiered") {
    for (let i = 1; i < ranked.length; i++) {
      if (ranked[i].metric_value === ranked[i - 1].metric_value && amounts[i] !== amounts[i - 1]) {
        warnings.push(
          `Tie at a cutoff: ${ranked[i - 1].governor} (rank ${ranked[i - 1].rank}) and ${ranked[i].governor} ` +
            `(rank ${ranked[i].rank}) both have ${ranked[i].metric_value} but get ${amounts[i - 1]} vs ${amounts[i]}.`,
        );
      }
    }
  }

  // The 100% top-up. The proportional strategies are already exact; this catches top_n and tiered.
  let leftover = quantity - amounts.reduce((sum, a) => sum + a, 0);
  if (leftover > 0) {
    const recipients = amounts.flatMap((a, i) => (a > 0 ? [i] : []));
    if (recipients.length === 0) {
      warnings.push(`${leftover} item(s) could not be handed out — nobody receives anything.`);
    } else {
      warnings.push(`${leftover} leftover item(s) redistributed from rank 1.`);
      for (let k = 0; leftover > 0; k = (k + 1) % recipients.length, leftover--) {
        amounts[recipients[k]] += 1;
      }
    }
  }

  return {
    lines: ranked.map((r, i) => ({ ...r, amount: amounts[i] })).filter((l) => l.amount > 0),
    warnings,
  };
}

// Largest-remainder split of `quantity` across `values` (Σ result = quantity, always). Equal
// remainders — the NORMAL case with attendance counts — fall to the earlier (higher-ranked) index.
function largestRemainder(values: number[], quantity: number): number[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  const shares = values.map((v) => (quantity * v) / total);
  const amounts = shares.map(Math.floor);
  let leftover = quantity - amounts.reduce((sum, a) => sum + a, 0);
  const order = values
    .map((_, i) => i)
    .sort((a, b) => shares[b] - amounts[b] - (shares[a] - amounts[a]) || a - b);
  for (const i of order) {
    if (leftover === 0) break;
    amounts[i] += 1;
    leftover -= 1;
  }
  return amounts;
}
