# Events

Log a batch of activity results — Bear Trap, Contribution, Mobilization — from a ranking screenshot into scored, per-member participation.

## What you see

The Events list (`/admin/events`) shows every logged event as a row: **Date**, **Week**, **Activity** (colored badge), **Instance**, **Unmapped** (count of names in that event still unresolved), **Status** (always reads "Ingested" once an event is saved), and row actions (view, edit, delete).

Above the table: an activity filter and a week filter (`YYYY-Www`, e.g. `2026-W33`) narrow the list. An **Add event** button opens the ingest dialog.

Beside the table, a **Needs mapping** panel lists every raw name across *all* events that still has no alias or governor match, with a **Map →** link straight to Aliases. If everything resolves, it says so and stays empty.

## How to

**1. Capture screenshots.** Take ranking screenshots of the activity as shown in-game — enough of them, scrolling through the full list, to cover every participant with a value above the activity's threshold.

**2. Start the event.** Click **Add event**, then set:
- **Activity** — the activity type (only active types are offered for new events; an event on a since-deactivated type keeps that type selectable when you edit it).
- **Date** — the day the activity happened.
- **Instance** — only shown for activities with more than one instance per day (Bear Trap's two daily traps); pick 1 or 2.

**3. Get the paste from an LLM.** Open the **LLM prompt for screenshots** disclosure and click **Copy**. Paste that prompt into a chat with an LLM (Claude or similar) along with your screenshots. The prompt tells the LLM to:
- output one line per participant as `Name<TAB>Value<TAB>Notes` (tab-separated, no header row), wrapped in a single fenced code block, naming the activity's own metric (e.g. Damage, Contribution, Personal Points) for Value;
- strip any leading alliance tag like `[ABC]` from the name;
- skip anyone whose value is `0` or "Unranked";
- output each participant **once**, even though screenshots overlap and repeat a pinned "your own row" panel — the LLM is told to drop repeats after the first;
- add a plain-text "Coverage check" note *after* the fence, cross-checking the on-screen rank numbers for gaps, confirming the highest rank matches the row count, and flagging out-of-order values or duplicate/non-overlapping screenshots.

A row of the expected output looks like:

```
Aurora	120000	
Cinder	95000	sub
Drake	41000	17/18 missions
```

Read the Coverage check before trusting the paste — it is the LLM's own sanity check that nobody was missed or double-counted.

**4. Paste into Participants.** Paste the fenced rows into the Participants box. The dialog shows how many rows parsed, how many duplicate lines it collapsed, and lists any line missing a usable value.

**5. Add event.** Once at least one valid row exists and there are no invalid lines, click **Add event** (or **Save changes** when editing). The result panel shows what was persisted, plus any skipped or unmapped rows (see below). Click **Done** to close.

**6. Edit or re-paste.** Click the pencil icon to reopen an event with its activity, date, instance, and rows prefilled (one line per stored participant, notes included). Change anything — including pasting a corrected full set of rows — and save. This **replaces the event's entire participant list**, not just the changed lines, so paste the complete corrected set, not a diff.

**7. Delete.** Click the trash icon to remove an event entirely, after confirming. **Delete is admin-only** — managers can add and edit events but won't see the delete action.

## How it works

- **Value threshold.** Each activity type has a minimum value; a row at or below it is **skipped** — recorded in the result as skipped, not silently dropped, since it can still matter for attendance. Only rows with value strictly greater than the threshold are logged and scored.
- **Name handling.** Raw names have any leading alliance tag (e.g. `[ABC]`) stripped and are trimmed before resolution. A name is resolved to a member only through an exact match in the alias table, then an exact match against a current governor name — **never a fuzzy or similar-looking match**. Anything that doesn't match either way stays **unmapped** rather than being guessed.
- **Unmapped rows still save.** An unmapped row is stored and shown in the event, but earns no points until its name is mapped in Aliases — see [Aliases](aliases.md). The Unmapped column and the Needs mapping panel both draw from this same standing queue.
- **Week** is derived automatically from the date (ISO 8601 week-of-year) — there's no separate field to set.
- **Recompute.** Every add, edit, or delete re-resolves every raw name to a member using the *current* alias/roster state and re-scores every participation from the *current* scoring config — not just the event you touched. This keeps history always consistent with today's rules; see [Scoring](scoring.md).
- **Access tiers.** Viewing is available to any signed-in tier. Adding and editing events requires manager or admin access. Deleting requires admin access specifically.

## Gotchas

- **Duplicate lines in your paste are silently collapsed**, keeping the first occurrence — this is expected, since scrolling screenshots repeat rows. It's a different check from within-event duplicates below.
- **Duplicate raw name within the event** (the exact same name appearing twice, even after collapsing) is rejected outright with an error — this shouldn't happen after the auto-collapse, but can if the same person appears under two different-looking raw strings.
- **Two names resolving to the same member** within one event (e.g. an alias and the canonical governor name both pasted for the same person) are rejected as a duplicate — fix the paste to include only one.
- **Bear Trap two-trap rule:** the same member can't appear in both trap 1 and trap 2 on the same date. This is checked by resolved identity, so a decoy name in one trap and the real name in the other are still caught. Saving the second trap with an overlapping member is rejected with the offending names listed.
- **Missing or non-numeric value** on any line blocks the whole save — fix or remove that line before submitting; the line number is called out.
- **Too many rows in one paste** (more than the app's per-batch cap) is rejected — split unusually large pastes.
- **Unknown activity** can't happen through the dialog itself (you pick from a list), but re-pasting the same activity/date/instance as an existing event **replaces that event's rows** rather than creating a duplicate — this is how corrections work, not an error.
- **An alias added later doesn't retroactively re-check old events.** If a new alias mapping would have caused a two-trap or duplicate conflict in an already-saved event, that conflict won't block anything or self-repair — watch the Needs mapping panel and event unmapped counts after alias changes.
- Deleting or editing an event recomputes scores immediately across the board — there's no draft/preview state once you click Add event or Save changes.

See also [Aliases](aliases.md) for resolving unmapped names, [Roster](roster.md) for governor identity, and [Scoring](scoring.md) for how value becomes points.
