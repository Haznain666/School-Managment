import { and, gte, isNull, lte, or, type SQL } from 'drizzle-orm';

import { timetableEntries } from '@/db/schema/timetable-entries';

/**
 * `lib/timetable-history.ts` — the one predicate that says "this lesson is the
 * one in force". Sprint 33c, migration `0049`.
 *
 * ── What changed, and what deliberately did not ──────────────────────────
 * Before `0049` a `timetable_entries` row was the *current* answer and the only
 * answer: changing `teacher_id` rewrote who had taken the class every Tuesday
 * since September. The product owner asked for that to stop. Decision 9 asked
 * for **no history view** — so nothing in the product reads a past week, and
 * the whole of the change on the read side is this predicate, applied
 * everywhere, plus a supersede on the write side.
 *
 * ── Every existing row is live, and that is the migration's promise ──────
 * `effective_from` arrives with `DEFAULT CURRENT_DATE` and `effective_to` null,
 * so on the morning `0049` is applied `liveTimetableEntries()` matches every
 * row that existed the night before. No screen changes, no count changes, and
 * `scripts/check-sprint33c.ts` asserts exactly that against the real schema
 * rather than leaving it as a claim in a comment.
 *
 * ── Operators, never a raw `sql` template ────────────────────────────────
 * `lte` / `gte` / `isNull` / `or`, as CLAUDE.md requires. A raw template is the
 * one place Drizzle has no column to map the value against, and it is what kept
 * every scheduled announcement in the product from ever being released. These
 * are `date` columns, so the value on the wire is a `YYYY-MM-DD` string either
 * way — which is precisely why the mistake would have been invisible here.
 *
 * ── A note on `is_active` ────────────────────────────────────────────────
 * This predicate does **not** include `is_active`. Every caller already filters
 * on it and has since Sprint 7; folding it in here would silently widen some
 * reads (the aggregate counts that pass it explicitly) and make the partial
 * unique index's predicate impossible to read against the query's. The index
 * carries both halves because an index has to; a caller carries both halves
 * because it always did.
 */

/**
 * Today, in `YYYY-MM-DD`, as a school means it.
 *
 * UTC, for the same reason `lib/teacher-calendar.ts` does its date arithmetic
 * there: a timetable is wall-clock, the server is not in Pakistan, and a local
 * `Date` would roll the day over at the *server's* midnight. The database's own
 * `CURRENT_DATE` is what the write side uses, and the two agree to within the
 * five hours that separate a UTC server from Karachi — which is why the
 * boundary is a whole day wide (`effective_to = CURRENT_DATE - 1`) rather than
 * an instant.
 */
export function timetableToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The version of each cell that is in force on `asOf` — today by default.
 *
 * `effective_to` null means "still in force", which is what every row written
 * before `0049` and every row written by an ordinary save carries.
 */
export function liveTimetableEntries(asOf: string = timetableToday()): SQL {
  const predicate = and(
    lte(timetableEntries.effectiveFrom, asOf),
    or(isNull(timetableEntries.effectiveTo), gte(timetableEntries.effectiveTo, asOf)),
  );

  /*
   * `and()` is typed as possibly-undefined because it is variadic and may be
   * handed nothing. Both arguments here are literals, so it never is; the throw
   * is there so a future edit that empties it fails loudly instead of returning
   * a predicate that matches every row in the table.
   */
  if (predicate === undefined) {
    throw new Error('liveTimetableEntries built an empty predicate');
  }

  return predicate;
}

/** The day a superseded version stops being in force, given the day the change lands. */
export function supersededOn(effectiveFrom: string): string {
  const at = new Date(`${effectiveFrom}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
}
