# Aliases

Where raw in-game names from uploaded screenshots get mapped to the correct member — and where names the app can't place yet wait for a human decision.

## What you see

Admin → Aliases has two panels side by side.

- **Alias directory** (left) — every member who has at least one alias, grouped under their governor name. Each group shows the governor as a filled tag, followed by every raw name mapped to them as outlined tags. A search box filters the directory by governor or alias text. An **Add alias** button opens the mapping dialog.
- **Unmapped queue** (right, flagged amber) — every raw name currently logged in an event that doesn't resolve to any member, with a badge for each activity/date/instance it was seen in (for example "bear_trap 2026-08-10 #1"). Each row has a **Map to member** button. A count badge shows how many names are waiting. When empty, it says everything resolves.

Hovering an alias tag in the directory reveals a small trash-can button to remove it — visible to admins only.

## How to

**Map an unmapped name to a member**
1. In the Unmapped queue, find the row and click **Map to member**.
2. The Add alias dialog opens with the raw name pre-filled as the alias text (still editable).
3. Under **Member**, either:
   - **Existing** — search and pick the member this name belongs to, or
   - **New member** — type a governor name; this creates a brand-new member and maps the raw name to them in one step.
4. Optionally add a **Note** (why this mapping exists — useful for a future officer to understand a decoy or rename).
5. Click **Add alias** (or **Create & map** for a new member). The dialog reports how many participation records were recomputed.

**Add an alias directly** (not from the queue): click **Add alias** at the top of the directory and fill in the same dialog with a blank alias field.

**Remove an alias** (admin only): hover the alias tag in the directory and click the trash icon, then confirm. Rows that were logged under that raw name re-resolve immediately afterward — if nothing else covers them, they fall back to the member's governor name, or drop into the unmapped queue if nothing covers them at all.

Who can do what: **viewer** can see both panels but cannot add or remove mappings. **Manager** and **admin** can add aliases (from the queue or directly) and create members through the "New member" tab. Only **admin** can remove an existing alias.

## How it works

**What an alias is.** An alias is a one-to-one mapping from a raw name as it appears on a ranking screenshot to exactly one canonical member. Screenshots are logged under whatever text the game displays that day — a governor's display name, with the alliance tag like `[ABC]` in front. The tag is stripped and the name trimmed before anything is compared, so `[ABC]Aurora` and `Aurora` are treated as the same raw text.

**Resolution order**, applied to every logged row:
1. **Alias table** — is this exact (normalized) raw name mapped to a member? If so, use that member.
2. **Governor match** — otherwise, does the normalized raw name exactly match a current member's governor name? If so, use that member.
3. **Unmapped** — otherwise, the row resolves to no member and appears in the unmapped queue.

**Name normalization** is: strip a leading alliance tag (bracketed, 1–6 characters, e.g. `[ABC]`), trim leading/trailing whitespace, and Unicode-normalize the text. Comparison is otherwise exact and case-sensitive — capitalization, spacing, and every character must match.

**Why the app never fuzzy-matches.** The alliance deliberately runs near-identical decoy renames as a defense against impersonation — for example, if "Aurora" is a real member, "NotAurora" and "ClearlyNotAurora" might be two entirely different people, not misspellings of Aurora's name. Guessing "close enough" would silently credit the wrong person's participation to Aurora. So a name either matches something exact (an alias or a governor), or it sits in the unmapped queue until an officer looks at it and decides. There is no automatic matching, ever — only a human mapping counts.

**Conflicts the app rejects when you add an alias:**
- The alias text already equals another member's current governor name — it would never actually resolve to the member you're mapping it to, since governor matches only apply when no alias claims the name first.
- The alias text already equals an existing alias (for any member).
- The alias text is empty, or normalizes to nothing (for example, just an alliance tag with no name) — it could never resolve to anyone.

**What recompute does.** Every add or remove of an alias triggers a full recompute: every logged participation row is re-resolved against the current alias and governor mappings, and re-scored from the current scoring rules. This means:
- Mapping a name pulls every historical row logged under that raw name onto the member — past events retroactively count, not just future ones.
- Removing an alias can send previously-resolved rows back to unmapped, if nothing else (no governor match) covers that raw name.
- The result panel reports the total number of participation records re-checked in that pass, plus any **retroactive conflicts** the change surfaces — for example, two different raw names now resolving to the same member within one event, or the same member now appearing in both traps of the same Bear Trap day. These are shown as warnings for you to review, not blocked; the mapping still goes through.

## Gotchas

- Creating a new member from the "New member" tab happens immediately on submit — if the alias mapping step after it fails (for instance, because the new governor name collides with something), the member still exists. The dialog tells you to finish the mapping from the Existing tab rather than re-creating the member.
- If the new governor name you type is identical (after normalization) to the raw name you're mapping, no alias is created — the raw name already resolves via the governor match, so the app just runs recompute.
- The unmapped queue is alliance-wide: it lists every distinct unresolved raw name across all events, not just from the most recent upload.
- The alias directory and unmapped queue are visible to every access tier, including viewer — treat the raw names and mappings as internal information, since they reveal how the alliance's decoy-naming scheme maps to real members.

See [Roster](roster.md) for creating and renaming members, and [Events](events.md) for how raw names get logged in the first place.
