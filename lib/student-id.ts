import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { academicYears, schoolIdSequences } from '@/db/schema';

import { batch, type Database } from './drizzle';
import { formatStudentId, normalizeSchoolCode } from './school-code';

/**
 * Student ID issuing — `GVS-2025-0001` (Sprint 4, Decision 5).
 *
 * ── On atomicity ─────────────────────────────────────────────────────────
 * Two admissions clerks enrolling at the same moment must not be handed the
 * same number, and the unique index on (location_id, student_id) would turn
 * that race into a failed enrolment rather than a duplicate.
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

/** Raised when a student ID cannot be issued. Blocks enrolment — it must. */
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

  return formatStudentId(code, year.startYear, sequence);
}

/**
 * What the *next* ID would look like, without consuming a number.
 *
 * Used by the enrolment form's review step. It is a preview and nothing more —
 * a concurrent enrolment can take the number between the preview and the
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

  return formatStudentId(code, year.startYear, (sequenceRows[0]?.lastSequence ?? 0) + 1);
}
