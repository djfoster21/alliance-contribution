// Tiny query helper wrapping D1Database. No ORM, no query builder — SQL lives in repositories.

// D1 caps bound parameters per statement at ~100; leave headroom.
const MAX_BOUND_PARAMS = 90;
const STATEMENTS_PER_BATCH = 50;

export async function first<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}

export async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const { results } = await db.prepare(sql).bind(...params).all<T>();
  return results;
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

// Splits a statement array into multiple db.batch() calls, so a single batch never grows unbounded.
// Each chunk is its own D1 transaction (db.batch() is atomic per call, not across calls): if a later
// chunk fails, earlier chunks have already committed. Callers that need all-or-nothing semantics must
// either keep their whole write within one chunk, or make the write idempotent/recomputable so a
// partial failure can simply be retried (e.g. re-running RecomputeService from scratch).
export async function batchChunked(
  db: D1Database,
  stmts: D1PreparedStatement[],
  chunkSize = STATEMENTS_PER_BATCH,
): Promise<D1Result[]> {
  const results: D1Result[] = [];
  for (let i = 0; i < stmts.length; i += chunkSize) {
    const chunk = stmts.slice(i, i + chunkSize);
    results.push(...(await db.batch(chunk)));
  }
  return results;
}

// Builds one multi-row INSERT per chunk of rows, keeping each statement's bound parameter count
// under MAX_BOUND_PARAMS (D1's limit is ~100 per statement).
// `table` and `columns` are interpolated directly into the SQL string (unparameterized) — callers must
// only ever pass code constants for them, never request data.
export function buildMultiRowInsert(
  db: D1Database,
  table: string,
  columns: string[],
  rows: unknown[][],
): D1PreparedStatement[] {
  const rowsPerStatement = Math.max(1, Math.floor(MAX_BOUND_PARAMS / columns.length));
  const rowPlaceholder = `(${columns.map(() => "?").join(", ")})`;
  const stmts: D1PreparedStatement[] = [];

  for (let i = 0; i < rows.length; i += rowsPerStatement) {
    const chunk = rows.slice(i, i + rowsPerStatement);
    const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${chunk.map(() => rowPlaceholder).join(", ")}`;
    stmts.push(db.prepare(sql).bind(...chunk.flat()));
  }

  return stmts;
}
