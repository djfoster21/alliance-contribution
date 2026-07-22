import type { MemberSnapshot, NewMemberSnapshot } from "../../shared/types";
import { all, batchChunked, buildMultiRowInsert, first } from "./db";

const COLUMNS = ["member_id", "captured_on", "alliance_rank", "power", "power_position"];

export class SnapshotRepo {
  constructor(private readonly db: D1Database) {}

  // Replaces one capture date wholesale, mirroring ParticipationRepo.replaceForEvent: the DELETE is
  // PREPENDED to the same batch as the inserts so the pair commits atomically. Issuing the DELETE as its
  // own round-trip would let a failure in between leave the date empty — and the operator could not
  // simply resubmit, because MemberService.importRoster applies deactivations before the snapshot write
  // and then rejects `deactivate` for an already-inactive member.
  // The `captured_on` ARGUMENT is authoritative for every row; each row's own captured_on is ignored, so
  // the method can never delete date A while writing date B.
  // ~86 rows x 5 columns = 430 bound params, chunked by buildMultiRowInsert's 90-param cap into 5
  // statements — DELETE + 5 inserts stays well inside one db.batch().
  async replaceForDate(captured_on: string, rows: NewMemberSnapshot[]): Promise<void> {
    const deleteStmt = this.db
      .prepare("DELETE FROM member_snapshots WHERE captured_on = ?")
      .bind(captured_on);
    const values = rows.map((r) => [r.member_id, captured_on, r.alliance_rank, r.power, r.power_position]);
    const insertStmts = buildMultiRowInsert(this.db, "member_snapshots", COLUMNS, values);
    await batchChunked(this.db, [deleteStmt, ...insertStmts]);
  }

  async countForDate(captured_on: string): Promise<number> {
    const row = await first<{ count: number }>(
      this.db,
      "SELECT COUNT(*) AS count FROM member_snapshots WHERE captured_on = ?",
      captured_on,
    );
    return row?.count ?? 0;
  }

  // Each member's most recent observation strictly before `captured_on` — PER MEMBER, not per date.
  // Fetching the previous capture's rows instead would silently drop every member who was absent from
  // that one capture, which is the common case for anyone who missed a paste.
  async latestPerMemberBefore(captured_on: string): Promise<MemberSnapshot[]> {
    return all<MemberSnapshot>(
      this.db,
      `SELECT s.id, s.member_id, s.captured_on, s.alliance_rank, s.power, s.power_position
       FROM member_snapshots s
       WHERE s.captured_on < ?1
         AND s.captured_on = (
           SELECT MAX(s2.captured_on) FROM member_snapshots s2
           WHERE s2.member_id = s.member_id AND s2.captured_on < ?1
         )`,
      captured_on,
    );
  }

  async listForMember(member_id: number): Promise<MemberSnapshot[]> {
    return all<MemberSnapshot>(
      this.db,
      `SELECT id, member_id, captured_on, alliance_rank, power, power_position
       FROM member_snapshots WHERE member_id = ? ORDER BY captured_on`,
      member_id,
    );
  }

  // The two most recent observations per member, newest first (rn = 1 is the latest). The Δ columns in
  // the roster table diff a member against THEIR OWN previous observation — a member absent from one
  // capture has no row for that date, so diffing against "the previous capture date" would attribute a
  // multi-capture move to a single week. Members with one observation come back with rn = 1 only.
  async lastTwoPerMember(): Promise<
    { member_id: number; captured_on: string; power: number | null; power_position: number | null; rn: number }[]
  > {
    return all(
      this.db,
      `SELECT member_id, captured_on, power, power_position, rn FROM (
         SELECT member_id, captured_on, power, power_position,
                ROW_NUMBER() OVER (PARTITION BY member_id ORDER BY captured_on DESC) AS rn
         FROM member_snapshots
       ) WHERE rn <= 2
       ORDER BY member_id, rn`,
    );
  }

  // Every capture date, ascending. The profile chart needs the full date axis to tell "absent from this
  // capture" apart from "no capture happened" — see MemberService.snapshots.
  async distinctCaptureDates(): Promise<string[]> {
    const rows = await all<{ captured_on: string }>(
      this.db,
      "SELECT DISTINCT captured_on FROM member_snapshots ORDER BY captured_on",
    );
    return rows.map((r) => r.captured_on);
  }

  // Members who already have an observation NEWER than `captured_on`. A backdated import must not move
  // these members' current meta backwards — their standing has been observed since.
  async membersWithCaptureAfter(captured_on: string): Promise<number[]> {
    const rows = await all<{ member_id: number }>(
      this.db,
      "SELECT DISTINCT member_id FROM member_snapshots WHERE captured_on > ?",
      captured_on,
    );
    return rows.map((r) => r.member_id);
  }

  // The newest capture date on record, or null when no roster has ever been imported.
  async latestCaptureDate(): Promise<string | null> {
    const row = await first<{ captured_on: string }>(
      this.db,
      "SELECT captured_on FROM member_snapshots ORDER BY captured_on DESC LIMIT 1",
    );
    return row?.captured_on ?? null;
  }
}
