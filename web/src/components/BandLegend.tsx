import type { RankBands } from "@shared/types";

/** Colour key for the board bands; positions rendered from the configured sizes. */
export function BandLegend({ bands }: { bands: RankBands }) {
  const items: Array<[string, string]> = [
    ["var(--color-band-lead)", "Leadership"],
    ["var(--color-band-top)", `Top ${bands.top}`],
    ["var(--color-band-mid)", `${bands.top + 1}–${bands.top + bands.mid}`],
    ["var(--color-band-rest)", `${bands.top + bands.mid + 1}+`],
  ];
  return (
    <div className="flex flex-wrap items-center justify-end gap-4 text-[12px] text-muted">
      {items.map(([color, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="size-3.5 rounded" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}
