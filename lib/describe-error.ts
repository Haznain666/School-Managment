/**
 * The whole error, including the part that actually says what went wrong.
 *
 * ── Why a plain `error.message` is not enough here ───────────────────────
 * Drizzle wraps every failed statement in an error whose message is the SQL and
 * the parameters, and hangs the driver's real error off `cause`. So a
 * background sweep that logs `caught.message` produces this, once a minute,
 * forever:
 *
 *     [announcements] sweep failed: Failed query: select "location_id", "id"
 *     from "announcements" where ...
 *     params: scheduled,Tue Aug 18 2026 20:47:53 GMT+0000,50
 *
 * Which is the query that failed — never the reason. "Relation does not exist",
 * "password authentication failed", "connection terminated" and "column does
 * not exist" are four completely different problems with four different fixes,
 * and all four look exactly like the block above. The live deployment has been
 * printing it every sixty seconds from two processes at once, and it has told
 * nobody anything.
 *
 * `cause` is where the answer was the whole time. This walks the chain and
 * appends what it finds.
 *
 * ── Bounded on purpose ───────────────────────────────────────────────────
 * A cause chain can be circular — a driver that re-wraps its own error is not
 * exotic — and this runs inside a `catch` in a loop that must never itself
 * throw. So it walks a fixed depth, tracks what it has already seen, and
 * degrades to a plain string for anything that is not an `Error`.
 */

/** How far down a `cause` chain to walk. Three is deeper than any observed. */
const MAX_DEPTH = 3;

export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const parts: string[] = [];
  const seen = new Set<unknown>();

  let current: unknown = error;

  for (let depth = 0; depth < MAX_DEPTH && current !== undefined && current !== null; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);

    if (current instanceof Error) {
      // Postgres error codes are the single most useful field the driver
      // carries and they are not part of `message`. `23505` (unique violation)
      // and `42P01` (undefined table) name the fix on their own.
      const code = (current as { code?: unknown }).code;
      const suffix = typeof code === 'string' && code !== '' ? ` [${code}]` : '';

      parts.push(`${current.message}${suffix}`);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }

  // "caused by" rather than a bare join, because the order matters to whoever
  // reads it at 3am: the first part is the wrapper, the last is the truth.
  return parts.join(' — caused by: ');
}
