import { useRef, useState } from "react";
import { Download, Upload, CheckCircle2, TriangleAlert } from "lucide-react";
import { api, ApiError, type ImportResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertTitle, AlertContent } from "@/components/ui/alert";
import { ErrorState } from "@/components/States";

type ParsedBackup = {
  exported_at?: string;
  tables?: Record<string, unknown[]>;
};

/** Map a thrown error to a clear, actionable message. 401 → API-key hint; 403 → admin-key hint. */
function writeErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Set your API key (top bar) to export or import.";
    if (e.status === 403) return "This action requires the admin key.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

/**
 * Trigger a browser download of `text` as `filename`. The anchor has to be in the document and the
 * object URL has to outlive the click: Firefox and Safari cancel a download started from a detached
 * anchor or from a URL revoked in the same tick.
 */
function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Post-import result: recompute success banner, or a warning when rows loaded but recompute failed. */
function ImportResultPanel({ result }: { result: ImportResult }) {
  const counts = Object.entries(result.imported)
    .map(([t, n]) => `${t}: ${n}`)
    .join(", ");

  if (result.recomputed) {
    return (
      <Alert variant="success">
        <CheckCircle2 />
        <AlertContent>Imported {counts}. Scores recomputed.</AlertContent>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertContent>
        <AlertTitle>Rows imported ({counts}) but recompute failed.</AlertTitle>
        <span>{result.error ?? "Unknown error"} — run Recompute from the admin to retry.</span>
      </AlertContent>
    </Alert>
  );
}

export function Backup() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, setPending] = useState<ParsedBackup | null>(null);

  async function handleExport() {
    setError(null);
    setBusy(true);
    try {
      const text = await api.admin.export();
      downloadText(`alliance-backup-${new Date().toISOString().slice(0, 10)}.json`, text);
    } catch (e) {
      setError(writeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setResult(null);
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    try {
      const text = await file.text();
      setPending(JSON.parse(text) as ParsedBackup);
    } catch {
      setError("That file is not valid JSON.");
    }
  }

  async function confirmImport() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      // Safety net: download the CURRENT database before overwriting it.
      const current = await api.admin.export();
      downloadText(`alliance-backup-before-restore-${new Date().toISOString().slice(0, 10)}.json`, current);

      const res = await api.admin.import(pending);
      setResult(res);
      setPending(null);
    } catch (e) {
      setError(writeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const counts = pending?.tables
    ? Object.entries(pending.tables)
        .map(([t, rows]) => `${t}: ${Array.isArray(rows) ? rows.length : 0}`)
        .join(", ")
    : "";

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorState message={error} />}
      {result && <ImportResultPanel result={result} />}

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-[13.5px] font-semibold text-foreground">Export</span>
          <span className="text-[12px] text-muted">Download the full database as a JSON file.</span>
        </div>
        <div>
          <Button size="sm" onClick={handleExport} disabled={busy}>
            <Download />
            Export database
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-[13.5px] font-semibold text-foreground">Import</span>
          <span className="text-[12px] text-muted">
            Replace ALL data with a backup file. The current database is downloaded first as a safety copy.
          </span>
        </div>
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleFile}
          />
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Upload />
            Choose backup file…
          </Button>
        </div>
      </Card>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace all data?</DialogTitle>
            <DialogDescription>
              Restoring the backup from {pending?.exported_at ?? "an unknown date"} ({counts}) will overwrite
              the entire database. The current data is downloaded first, then replaced — but that download is
              your browser's business and the app cannot confirm it saved. If you do not already have a
              recent export on disk, cancel and use Export above first.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={confirmImport} disabled={busy}>
              {busy ? "Restoring…" : "Download current & restore"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
