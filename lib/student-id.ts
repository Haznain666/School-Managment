import 'server-only';

import { and, eq, like, sql } from 'drizzle-orm';

import { academicYears, schoolIdSequences, studentProfiles } from '@/db/schema';

import { batch, type Database } from './drizzle';
import { formatStudentId, normalizeSchoolCode } from './school-code';

/**
 * Student ID issuing — `GVS-2025-0001` (Sprint 4, Decision 5).
 *
 * ── On atomicity ─────────────────────────────────────────────────────────
 * Two admissions clerks enrolling at the same moment must not be handed the
 * same number, and the unique index on (location_id, student_id) would turn
 * that race into a failed enrollment rather than a duplicate.
 *
 * The increment is therefore a single `INSERT ... ON CONFLICT DO UPDATE ...
 * RETURNING` statement. Postgres runs every statement in its own transaction
 * and takes a row lock on conflict, so the second writer blocks until the first
 * commits and then reads the incremented value — the counter cannot be read and
 * re-written by two sessions at once.
 *
 * That single statement is deliberately the whole of it. A read-then-write
 * across two round trips would be exactly the race the upsert avoids, and a
 * transaction around the pair would not close it — neither statement takes a
 * lock the other would have to wait behind. `batch()` is used where the sequence
 * increment and the year lookup can travel together.
 */

/** Raised when a student ID cannot be issued. Blocks enrollment — it must. */
export class StudentIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudentIdError';
  }
}

/**
 * Issues the next student ID for a school and academic year.
 *
 * Increments the counter and reads the year's start year in one batch, so both
 * statements run inside a single database transaction.
 *
 * @param locationId  Tenant key, always from verified claims.
 * @throws {StudentIdError} when the academic year does not belong to this
 *   school, or the school has no usable code.
 */
export async function generateStudentId(
  db: Database,
  locationId: string,
  academicYearId: string,
  schoolCode: string,
): Promise<string> {
  const code = normalizeSchoolCode(schoolCode);
  if (code === '') {
    throw new StudentIdError(
      'This school has no school code set. Add one in the Super Admin panel before enrolling students.',
    );
  }

  const [sequenceRows, yearRows] = await batch(db, (tx) => [
    tx
      .insert(schoolIdSequences)
      .values({ locationId, academicYearId, lastSequence: 1 })
      .onConflictDoUpdate({
        target: [schoolIdSequences.locationId, schoolIdSequences.academicYearId],
        set: { lastSequence: sql`${schoolIdSequences.lastSequence} + 1` },
      })
      .returning({ lastSequence: schoolIdSequences.lastSequence }),
    tx
      .select({ startYear: academicYears.startYear })
      .from(academicYears)
      .where(
        and(
          eq(academicYears.id, academicYearId),
          eq(academicYears.locationId, locationId),
        ),
      )
      .limit(1),
  ]);

  const year = yearRows[0];
  if (year === undefined) {
    throw new StudentIdError('That academic year does not belong to this school.');
  }

  const sequence = sequenceRows[0]?.lastSequence;
  if (sequence === undefined) {
    throw new StudentIdError('Could not reserve a student ID. Please try again.');
  }

  const candidate = formatStudentId(code, year.startYear, sequence);
  if (!(await isTaken(db, locationId, candidate))) return candidate;

  return reconcileWithRoll(db, locationId, academicYearId, code, year.startYear);
}

/**
 * Recovers when the counter hands out a number the roll already holds.
 *
 * ── How that happens ─────────────────────────────────────────────────────
 * A bulk import keeps the school's own admission numbers and deliberately does
 * **not** advance this counter — see `enrollStudent`, which explains why
 * renumbering a migrated roll is destructive. That is fine as long as the two
 * sequences never meet. They meet whenever the imported numbers are in *our*
 * shape: a school migrating 409 children numbered `RHA-2026-0001`…`0409`
 * leaves the counter at zero, so the next direct enrollment mints
 * `RHA-2026-0001`, hits `student_profiles_location_id_student_id_idx`, and
 * fails with "Could not complete the enrollment. Please check the details" —
 * a message about details, for a problem that has nothing to do with them.
 * Worse, it fails *again* on the next attempt, and the next: each try burns
 * one number, so the school must fail once per imported child before an
 * enrollment can land.
 *
 * ── What this does ───────────────────────────────────────────────────────
 * Reads the highest sequence actually in use for this school and year, and
 * pushes the counter past it in one atomic upsert — `GREATEST`, so a
 * concurrent enrollment that has already advanced it further is never wound
 * back. The scan is `LIKE 'RHA-2026-%'`, so it costs nothing on schools that
 * never imported and runs once on the school that did: after this, the counter
 * is ahead of the roll and the ordinary path takes over.
 *
 * Numbers that are not in our shape are ignored rather than parsed — a school
 * whose own numbering is `2026/V/17` shares no space with ours and cannot
 * collide, which is the case the import was written for in the first place.
 */
async function reconcileWithRoll(
  db: Database,
  locationId: string,
  academicYearId: string,
  code: string,
  startYear: number,
): Promise<string> {
  const prefix = `${code}-${startYear}-`;

  const rows = await db
    .select({ studentId: studentProfiles.studentId })
    .from(studentProfiles)
    .where(
      and(
        eq(studentProfiles.locationId, locationId),
        like(studentProfiles.studentId, `${prefix}%`),
      ),
    );

  let highest = 0;
  for (const row of rows) {
    const suffix = row.studentId.slice(prefix.length);
    // Only the exact printed form counts. `RHA-2026-0007-B` is somebody else's
    // scheme that happens to start the same way, not our seventh child.
    if (!/^\d+$/.test(suffix)) continue;
    const value = Number.parseInt(suffix, 10);
    if (Number.isFinite(value) && value > highest) highest = value;
  }

  const bumped = await db
    .insert(schoolIdSequences)
    .values({ locationId, academicYearId, lastSequence: highest + 1 })
    .onConflictDoUpdate({
      target: [schoolIdSequences.locationId, schoolIdSequences.academicYearId],
      set: {
        lastSequence: sql`GREATEST(${schoolIdSequences.lastSequence} + 1, ${highest + 1})`,
      },
    })
    .returning({ lastSequence: schoolIdSequences.lastSequence });

  const sequence = bumped[0]?.lastSequence;
  if (sequence === undefined) {
    throw new StudentIdError('Could not reserve a student ID. Please try again.');
  }

  const candidate = formatStudentId(code, startYear, sequence);

  // One reconciliation is enough for the migrated-roll case. Anything still
  // taken here is a genuine race with another enrollment, and the unique index
  // is the correct place for that to be settled — not a retry loop that would
  // burn a number per turn.
  if (await isTaken(db, locationId, candidate)) {
    throw new StudentIdError(
      'Another enrollment took that student ID. Please try again.',
    );
  }

  return candidate;
}

/** Whether this school's roll already carries a printed admission number. */
async function isTaken(
  db: Database,
  locationId: string,
  studentId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: studentProfiles.id })
    .from(studentProfiles)
    .where(
      and(
        eq(studentProfiles.locationId, locationId),
        eq(studentProfiles.studentId, studentId),
      ),
    )
    .limit(1);

  return rows[0] !== undefined;
}

/**
 * What the *next* ID would look like, without consuming a number.
 *
 * Used by the enrollment form's review step. It is a preview and nothing more —
 * a concurrent enrollment can take the number between the preview and the
 * submit, so the ID that is actually stored comes from `generateStudentId`.
 */
export async function previewNextStudentId(
  db: Database,
  locationId: string,
  academicYearId: string,
  schoolCode: string,
): Promise<string | null> {
  const code = normalizeSchoolCode(schoolCode);
  if (code === '') return null;

  const [sequenceRows, yearRows] = await batch(db, (tx) => [
    tx
      .select({ lastSequence: schoolIdSequences.lastSequence })
      .from(schoolIdSequences)
      .where(
        and(
          eq(schoolIdSequences.locationId, locationId),
          eq(schoolIdSequences.academicYearId, academicYearId),
        ),
      )
      .limit(1),
    tx
      .select({ startYear: academicYears.startYear })
      .from(academicYears)
      .where(
        and(
          eq(academicYears.id, academicYearId),
          eq(academicYears.locationId, locationId),
        ),
      )
      .limit(1),
  ]);

  const year = yearRows[0];
  if (year === undefined) return null;

  const candidate = formatStudentId(
    code,
    year.startYear,
    (sequenceRows[0]?.lastSequence ?? 0) + 1,
  );

  // A school whose roll was imported in our own numbering has a counter behind
  // that roll, so the naive preview would show a number already on a child's
  // file. The review step is where an admissions clerk reads the number aloud;
  // it must not be one that belongs to somebody else. Consuming nothing, this
  // asks the same question `generateStudentId` will and shows what it would do.
  if (!(await isTaken(db, locationId, candidate))) return candidate;

  const prefix = `${code}-${year.startYear}-`;

  const rows = await db
    .select({ studentId: studentProfiles.studentId })
    .from(studentProfiles)
    .where(
      and(
        eq(studentProfiles.locationId, locationId),
        like(studentProfiles.studentId, `${prefix}%`),
      ),
    );

  let highest = 0;
  for (const row of rows) {
    const suffix = row.studentId.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const value = Number.parseInt(suffix, 10);
    if (Number.isFinite(value) && value > highest) highest = value;
  }

  return formatStudentId(code, year.startYear, highest + 1);
}
