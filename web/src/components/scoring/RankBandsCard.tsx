import { useState } from "react";
import { DEFAULT_RANK_BANDS, type RankBands } from "@shared/types";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useApiKey } from "@/lib/apiKey";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Board band sizes (top N / next M). PUT is admin-gated server-side; non-admins see the values
 * read-only. Pure presentation — saving triggers no recompute.
 */
export function RankBandsCard() {
  const { role } = useApiKey();
  const admin = role === "admin";
  const state = useApi<RankBands>(() => api.settings.rankBands(), []);

  // null = "not edited yet" — the fetched value shows through until the user types.
  const [top, setTop] = useState<string | null>(null);
  const [mid, setMid] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const current = state.data ?? DEFAULT_RANK_BANDS;
  const topVal = top ?? String(current.top);
  const midVal = mid ?? String(current.mid);
  const topNum = Number(topVal);
  const midNum = Number(midVal);
  const valid =
    Number.isInteger(topNum) && topNum >= 0 && Number.isInteger(midNum) && midNum >= 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.settings.saveRankBands({ top: topNum, mid: midNum });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <div className="text-[14px] font-semibold">Ranking bands</div>
        <p className="text-[12.5px] text-muted">
          Board colour bands: top N, next M, remainder. R4/R5 never count. Display-only — no
          recompute.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Top band
          <Input
            className="w-24"
            inputMode="numeric"
            value={topVal}
            onChange={(e) => setTop(e.target.value)}
            disabled={!admin}
            aria-invalid={!valid}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Second band
          <Input
            className="w-24"
            inputMode="numeric"
            value={midVal}
            onChange={(e) => setMid(e.target.value)}
            disabled={!admin}
            aria-invalid={!valid}
          />
        </label>
        {admin && (
          <Button size="sm" onClick={save} disabled={!valid || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
      {!valid && <p className="text-[12px] text-down">Sizes must be whole numbers ≥ 0.</p>}
      {error && <p className="text-[12px] text-down">{error}</p>}
      {saved && <p className="text-[12px] text-up">Saved.</p>}
    </Card>
  );
}
