# Backup

Download the entire dataset to a file, restore from one, or force a full re-score — the admin-only escape hatch for the whole tracker.

## What you see

The Backup page (`/admin/backup`) has two cards:

- **Export** — a single **Export database** button that downloads the current dataset as a JSON file.
- **Import** — a **Choose backup file…** button that opens a file picker for a previously exported JSON file.

Picking a file opens a confirmation dialog naming the backup's export date and a per-table row count, with **Cancel** and **Download current & restore** buttons. After a successful import, a result banner reports how many rows were loaded per table; if scores couldn't be recalculated afterward, a separate warning banner appears instead — its message says "run Recompute" (see How it works and Gotchas for what that means in practice).

## How to

**Export a backup**
1. Click **Export database**.
2. A file downloads immediately, named `alliance-backup-<date>.json` (today's date).
3. Keep it somewhere safe — it's your only copy once you move on to something risky.

**Import a backup**
1. Click **Choose backup file…** and pick a `.json` file you previously exported.
2. Read the confirmation dialog carefully: it shows the file's export date and the row counts it will load, and warns that current data is downloaded first, then overwritten.
3. Click **Download current & restore** to proceed, or **Cancel** to back out.
4. The app downloads a safety copy of the *current* database first (named `alliance-backup-before-restore-<date>.json`), then sends the chosen file to replace everything.
5. Watch for the result banner. A green banner means the import succeeded and scores were recalculated. A warning banner means the rows loaded but the automatic recalculation failed — see Gotchas for what to do.

**Recommended routine**
- Export before anything risky: a scoring overhaul, a big roster cleanup, a bulk alias remap, or before handing the admin key to someone else for a session.
- Keep exports somewhere outside the app (local disk, cloud drive) — the app itself doesn't retain past exports anywhere.
- Moving the whole tracker to a new deployment (e.g. standing up a fresh copy elsewhere): export from the old one, then import that same file into the new, empty deployment. Because Import replaces everything, importing into a brand-new instance is just as safe as importing into an existing one — there's simply nothing to lose on the empty side.

**Recompute (automatic, not a button you press directly here)**
- Every write that could change scores — adding, editing, or deleting an event; mapping or removing an alias; renaming or merging a member; editing scoring weights or tiers; and importing a backup — automatically re-resolves every logged name and re-tallies every score afterward. There's no separate manual "Recompute" control on this page or elsewhere in the app today.
- If the recompute step specifically fails after an otherwise-successful import (see the warning banner below), the practical way to retry it is to **import the same file again** — import always ends with the same recompute step, so repeating it is safe and deterministic.

## How it works

- **What Export produces.** A single JSON file containing every table in the app — activity types, scoring tiers, members, aliases, roster snapshots, events, participations, and reward allocations (with their line items). Every row is included as-is, including internal ids, so an export is a complete, exact snapshot of the dataset at that moment. The file carries a format tag and a schema/version marker so the app can tell whether a given file is safe to import.
- **Import replaces ALL data.** This is not a merge and not selective — importing a backup **deletes every row in every table first, then loads the file's rows in their place.** There is no per-table or partial import. Treat Import as "roll the entire tracker back to the moment this file was exported," full stop — any events, roster edits, alias changes, or reward runs made since that export are gone unless they're also in the file.
- **Validation happens before anything is touched.** Before deleting a single row, the app checks: the file's format and version tags are recognized; the file's schema version is one the app can still read (a handful of older schema versions are automatically upgraded in memory to the current shape; anything older or mismatched is rejected outright); only the expected tables and columns are present (nothing unrecognized, nothing missing); every row's internal cross-references resolve within the file itself (e.g. every alias points to a member that's actually in the file, every participation points to a real event); and no duplicate rows exist where the app requires uniqueness (e.g. two members with the same governor name). **If any check fails, the import is rejected and nothing in the database changes** — the failure message says what was wrong.
- **Size limit.** An import file larger than 10 MB is rejected outright before it's even parsed.
- **What happens on a mid-import failure.** Once validation passes, the wipe (clearing all tables) happens as one indivisible step — it either fully happens or, if the app rejects the file first, doesn't happen at all. Loading the new rows back in happens afterward in batches. In the rare case that step fails partway through, the database is left with every table cleared but only some rows reloaded — the app surfaces this loudly, and the fix is to simply run Import again with the exact same file, which is safe to repeat.
- **Recompute after import.** A successful import automatically re-scores everything using the freshly loaded data. If that step alone fails (rows loaded, but the score recalculation errored), the banner says so; the imported data itself is intact either way, and re-importing the same file finishes the job.
- **The safety-copy download is a browser action the app can't verify.** When you confirm an import, the app triggers a download of the current database before sending the replacement — but whether that file actually saved to your disk is between you and your browser. If you don't already have a recent export on hand, cancel and use Export first rather than trusting the automatic safety copy alone.
- **What recompute does, conceptually.** It re-resolves every logged participant name against the current roster and alias list, then re-scores every participation from the current scoring tiers and weights. It doesn't add, remove, or move any events, members, or aliases — it only recalculates derived numbers (who each row maps to, and how many points it's worth). Running it again with nothing else changed does nothing new the second time — it's a safe, idempotent step, not something that can make things worse if repeated.

## Gotchas

- **Import is destructive and effectively irreversible** unless you have a backup file of the state you're overwriting. There's no undo button — only "import another file to get back to some other known state."
- **A file exported from a much older or newer version of the app may be rejected** rather than partially applied. A handful of older exports are auto-upgraded and still work; anything the app doesn't recognize is refused before touching data.
- **The size cap (10 MB) exists** — a very large history plus reward run data could approach it; if an export won't re-import, this is worth checking first.
- **Recompute doesn't fix missing data** — if scores look wrong because a name is unmapped or an alias is missing, fix that in [Aliases](aliases.md) or [Roster](roster.md) first; recomputing only reapplies the *current* rules, it can't invent a mapping that doesn't exist.
- **Export and Import require the admin key specifically** — a manager key can view most of the app and even add events, but Export, Import, and deleting events are admin-only. The underlying recompute step, though, doesn't require the admin key — a manager key can trigger it too (it just currently only happens as a side effect of another action, not from a dedicated button). A viewer key can't use this page at all.
- **The API key lives in the top bar**, not on this page — click **Set API key** (or **API key set**, once one is stored) to open the dialog and paste in a viewer, manager, or admin key. It's saved in your browser only; there's no server-side sign-out, just clearing or replacing the key.

See also [Scoring](scoring.md) for what a recompute actually recalculates, and [Events](events.md) for how individual event edits already trigger the same recalculation automatically.
