import 'server-only';

import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';

import {
  grades,
  sections,
  studentImportBatches,
  studentImportRows,
  studentProfiles,
  type ImportRowOutcome,
  type StudentImportBatch,
} from '@/db/schema';

import { db } from './drizzle';
import { enrollStudent, EnrollmentError } from './enrollment';
import { DEFAULT_NATIONALITY } from './student-reference-data';
import { findDuplicateAdmissionNumbers, mappedValue, validateRow } from './student-import';

/**
 * The server half of the student import: validating a mapped batch, and
 * committing one.
 *
 * The rules themselves live in `lib/student-import.ts`, which is
 * dependency-free so the browser applies exactly the same ones. This module
 * owns only what needs the database: whether an admission number is already
 * taken at this school, and the writing.
 */

export interface BatchTarget {
  academicYearId: string;
  sectionId: string;
  gradeId: string;
  branchId: string;
  gradeName: string;
  sectionName: string;
}

/**
 * Resolves the section a batch imports into, proving it belongs to this school.
 *
 * The branch and grade are read *from the section* rather than accepted
 * alongside it. A caller supplying all three could supply a consistent-looking
 * trio that is not actually related, and the foreign keys would not notice —
 * the same reasoning as `resolvePlacement`, which every id in this application
 * goes through.
 */
export async function resolveBatchTarget(
  locationId: string,
  sectionId: string,
): Promise<BatchTarget | null> {
  const rows = await db
    .select({
      sectionId: sections.id,
      sectionName: sections.name,
      academicYearId: sections.academicYearId,
      gradeId: grades.id,
      gradeName: grades.name,
      branchId: grades.branchId,
    })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(and(eq(sections.locationId, locationId), eq(sections.id, sectionId)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  return {
    academicYearId: row.academicYearId,
    sectionId: row.sectionId,
    gradeId: row.gradeId,
    branchId: row.branchId,
    gradeName: row.gradeName,
    sectionName: row.sectionName,
  };
}

/** Admission numbers from the batch that this school has already issued. */
async function existingAdmissionNumbers(
  locationId: string,
  numbers: readonly string[],
): Promise<Map<string, string>> {
  if (numbers.length === 0) return new Map();

  const rows = await db
    .select({ id: studentProfiles.id, studentId: studentProfiles.studentId })
    .from(studentProfiles)
    .where(
      and(
        eq(studentProfiles.locationId, locationId),
        inArray(studentProfiles.studentId, [...new Set(numbers)]),
      ),
    );

  return new Map(rows.map((row) => [row.studentId.toLowerCase(), row.id]));
}

export interface ValidationSummary {
  total: number;
  valid: number;
  invalid: number;
  /** Rows that match a student who already exists and will be left alone. */
  duplicate: number;
}

/**
 * Re-validates every row of a batch against its mapping and writes the outcome.
 *
 * This is the dry run, and it is also what the commit trusts. Running it as a
 * separate pass that *stores* its verdict is what makes the report honest: the
 * operator is not reading a prediction produced by one code path and then
 * acting through another that might disagree.
 *
 * A row matching an existing admission number is marked `skipped`, not
 * `invalid`. That is what makes a re-upload of the same file safe — the second
 * run reports "already here" rather than creating a second Ayesha Khan — and it
 * is why the report distinguishes the two counts instead of calling both
 * "problems".
 */
export async function validateBatch(
  batch: StudentImportBatch,
  columnMap: Record<string, string>,
): Promise<ValidationSummary> {
  const rows = await db
    .select({
      id: studentImportRows.id,
      rowNumber: studentImportRows.rowNumber,
      raw: studentImportRows.raw,
    })
    .from(studentImportRows)
    .where(eq(studentImportRows.batchId, batch.id))
    .orderBy(asc(studentImportRows.rowNumber));

  const validations = rows.map((row) => ({
    ...row,
    ...validateRow(row.raw, columnMap),
  }));

  // Collisions inside the file itself, which no single row can detect.
  //
  // Read off the *raw* row, not off the parsed candidate. `validateRow`
  // returns a null candidate the moment a row has any error at all, so
  // reading the number from there would hide a duplicate behind an unrelated
  // problem: the operator fixes an email address, re-uploads, and only then
  // learns two children share an admission number. Found while testing — a
  // file with both faults reported only the email.
  const admissionNumbers = validations.map((entry) => {
    const raw = mappedValue(entry.raw, columnMap, 'admissionNumber');
    return { rowNumber: entry.rowNumber, admissionNumber: raw === '' ? null : raw };
  });

  const duplicatesInFile = findDuplicateAdmissionNumbers(admissionNumbers);

  const alreadyHere = await existingAdmissionNumbers(
    batch.locationId,
    admissionNumbers
      .map((entry) => entry.admissionNumber)
      .filter((value): value is string => value !== null),
  );

  const summary: ValidationSummary = { total: rows.length, valid: 0, invalid: 0, duplicate: 0 };

  const byRow = new Map(admissionNumbers.map((entry) => [entry.rowNumber, entry]));

  const updates = validations.map((entry) => {
    const errors = [...entry.errors];

    const inFile = duplicatesInFile.get(entry.rowNumber);
    if (inFile !== undefined) errors.push(inFile);

    const admissionNumber = byRow.get(entry.rowNumber)?.admissionNumber ?? null;
    const existingId =
      admissionNumber === null
        ? undefined
        : alreadyHere.get(admissionNumber.toLowerCase());

    let outcome: ImportRowOutcome;
    if (errors.length > 0) {
      outcome = 'invalid';
      summary.invalid += 1;
    } else if (existingId !== undefined) {
      outcome = 'skipped';
      summary.duplicate += 1;
    } else {
      outcome = 'pending';
      summary.valid += 1;
    }

    return { id: entry.id, outcome, errors, studentProfileId: existingId ?? null };
  });

  await writeOutcomes(updates);

  return summary;
}

interface RowOutcomeUpdate {
  id: string;
  outcome: ImportRowOutcome;
  errors: string[];
  studentProfileId: string | null;
}

/**
 * Writes every row's verdict in **one** statement.
 *
 * The first version of this looped, one UPDATE per row inside a transaction.
 * Correct, and unusable: measured against the live database, a seven-row file
 * took 25 seconds, because every row is a round trip to Supabase through the
 * pooler. At the 2000 rows this importer accepts it would have been a request
 * nobody would wait out — and it would have held a transaction open across all
 * of them.
 *
 * `UPDATE ... FROM (VALUES ...)` is one round trip whatever the file's size,
 * and is atomic on its own without an explicit transaction, so the report is
 * still written all-or-nothing: a half-validated batch cannot be read as a
 * finished one.
 */
async function writeOutcomes(updates: readonly RowOutcomeUpdate[]): Promise<void> {
  if (updates.length === 0) return;

  const values = updates.map(
    (update) =>
      sql`(${update.id}::uuid, ${update.outcome}, ${JSON.stringify(update.errors)}::jsonb, ${update.studentProfileId}::uuid)`,
  );

  await db.execute(sql`
    UPDATE ${studentImportRows} AS r
    SET outcome = v.outcome,
        errors = v.errors,
        student_profile_id = v.student_profile_id
    FROM (VALUES ${sql.join(values, sql`, `)})
      AS v(id, outcome, errors, student_profile_id)
    WHERE r.id = v.id
  `);
}

export interface CommitSummary {
  created: number;
  skipped: number;
  failed: number;
}

/**
 * Writes the valid rows of a validated batch.
 *
 * ── Per row, deliberately ────────────────────────────────────────────────
 * Each student goes in through `enrollStudent`, which is the same function the
 * enrolment form calls and which wraps its own four inserts in one transaction.
 * So a single student is all-or-nothing, and the *batch* is not.
 *
 * Wrapping the whole batch would mean one unexpected failure on row 380
 * discarding 379 good students and telling the operator to try again, having
 * given them no way to find the bad row. The point of importing four hundred
 * students is not to discover that one of them has a duplicate admission
 * number. Failures are recorded on their own row and the rest proceed.
 *
 * ── Sequential, not parallel ────────────────────────────────────────────
 * Admission numbers come from a per-school counter, and each `enrollStudent`
 * holds a connection for its transaction. `lib/fee-challans.ts` bounds its
 * concurrency for the second reason; this one has the first as well, so it does
 * not run them at once at all. Four hundred students is a few seconds.
 */
export async function commitBatch(
  batch: StudentImportBatch,
  target: BatchTarget,
  actorUid: string,
): Promise<CommitSummary> {
  const rows = await db
    .select({
      id: studentImportRows.id,
      rowNumber: studentImportRows.rowNumber,
      raw: studentImportRows.raw,
      outcome: studentImportRows.outcome,
    })
    .from(studentImportRows)
    .where(eq(studentImportRows.batchId, batch.id))
    .orderBy(asc(studentImportRows.rowNumber));

  const columnMap = batch.columnMap ?? {};
  const summary: CommitSummary = { created: 0, skipped: 0, failed: 0 };

  for (const row of rows) {
    // `invalid` and `skipped` were decided by the validation pass the operator
    // read before pressing commit. Re-deciding them here is how the report and
    // the result come to disagree.
    if (row.outcome !== 'pending') {
      if (row.outcome === 'skipped') summary.skipped += 1;
      continue;
    }

    const { candidate, errors } = validateRow(row.raw, columnMap);

    if (candidate === null) {
      summary.failed += 1;
      await markRow(row.id, 'failed', errors);
      continue;
    }

    try {
      const result = await enrollStudent(db, {
        locationId: batch.locationId,
        actorUid,
        // The school's own number, when they gave us one. The field's hint
        // promises this — "their existing number, left unmapped the school
        // issues new ones" — and until it was wired through, the import used
        // the supplied number to detect duplicates and then threw it away.
        existingStudentId: candidate.admissionNumber ?? undefined,
        // A migrated roll is not a queue of new admissions. These children are
        // already at the school; the fee gate must not hold their parents'
        // portal accounts behind a challan nobody will raise. See
        // `EnrollStudentParams.feeStatus`.
        feeStatus: 'cleared',
        student: {
          name: candidate.name,
          dateOfBirth: candidate.dateOfBirth,
          gender: candidate.gender as never,
          bFormCnic: candidate.bFormCnic,
          // A spreadsheet column headed "B-Form / CNIC" does not say which was
          // written in it, and the import will not guess on the school's behalf.
          // The number is kept; the document is left to be recorded when the
          // profile is next opened.
          idDocumentType: null,
          bloodGroup: null,
          nationality: DEFAULT_NATIONALITY,
          religion: null,
          previousSchool: null,
          medicalNotes: null,
          photoUrl: null,
        },
        guardians: [
          {
            name: candidate.guardianName,
            relationship: candidate.guardianRelationship as never,
            phone: candidate.guardianPhone,
            email: candidate.guardianEmail,
            cnic: null,
            occupation: null,
            // The only guardian on the row, so they are the contact. A school
            // adding a mother afterwards decides then which of them it is.
            isPrimaryContact: true,
          },
        ],
        placement: {
          branchId: target.branchId,
          gradeId: target.gradeId,
          sectionId: target.sectionId,
          academicYearId: target.academicYearId,
          rollNumber: candidate.rollNumber,
          enrollmentDate: null,
        },
      });

      summary.created += 1;
      await db
        .update(studentImportRows)
        .set({
          outcome: 'created',
          errors: [],
          studentProfileId: result.studentProfileId,
        })
        .where(eq(studentImportRows.id, row.id));
    } catch (error) {
      summary.failed += 1;
      // `EnrollmentError` already carries wording meant for a person; anything
      // else is ours and must not be shown raw to a school administrator.
      const message =
        error instanceof EnrollmentError
          ? error.message
          : 'This row could not be saved. Nothing else in the file was affected.';
      await markRow(row.id, 'failed', [message]);
    }
  }

  return summary;
}

async function markRow(
  rowId: string,
  outcome: ImportRowOutcome,
  errors: readonly string[],
): Promise<void> {
  await db
    .update(studentImportRows)
    .set({ outcome, errors: [...errors] })
    .where(eq(studentImportRows.id, rowId));
}

/** One batch, tenant-checked. */
export async function getImportBatch(
  locationId: string,
  batchId: string,
): Promise<StudentImportBatch | null> {
  const rows = await db
    .select()
    .from(studentImportBatches)
    .where(
      and(
        eq(studentImportBatches.locationId, locationId),
        eq(studentImportBatches.id, batchId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function listImportBatches(
  locationId: string,
  limit = 20,
): Promise<StudentImportBatch[]> {
  return db
    .select()
    .from(studentImportBatches)
    .where(eq(studentImportBatches.locationId, locationId))
    .orderBy(desc(studentImportBatches.createdAt))
    .limit(limit);
}

export interface ImportRowView {
  id: string;
  rowNumber: number;
  raw: Record<string, string>;
  outcome: ImportRowOutcome;
  errors: string[];
}

/**
 * The rows of a batch, optionally one outcome at a time.
 *
 * Paged because a 2000-row file's report is not something to send whole, and
 * because the only part of it anybody reads is the problems.
 */
export async function listImportRows(
  batchId: string,
  filters: { outcome?: ImportRowOutcome | undefined; page?: number; limit?: number } = {},
): Promise<{ rows: ImportRowView[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const page = Math.max(filters.page ?? 1, 1);

  const where =
    filters.outcome === undefined
      ? eq(studentImportRows.batchId, batchId)
      : and(
          eq(studentImportRows.batchId, batchId),
          eq(studentImportRows.outcome, filters.outcome),
        );

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: studentImportRows.id,
        rowNumber: studentImportRows.rowNumber,
        raw: studentImportRows.raw,
        outcome: studentImportRows.outcome,
        errors: studentImportRows.errors,
      })
      .from(studentImportRows)
      .where(where)
      .orderBy(asc(studentImportRows.rowNumber))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ value: count() }).from(studentImportRows).where(where),
  ]);

  return { rows, total: totals[0]?.value ?? 0 };
}

/** Counts by outcome, for the report's headline. */
export async function countRowOutcomes(
  batchId: string,
): Promise<Record<ImportRowOutcome, number>> {
  const rows = await db
    .select({ outcome: studentImportRows.outcome, total: count() })
    .from(studentImportRows)
    .where(eq(studentImportRows.batchId, batchId))
    .groupBy(studentImportRows.outcome);

  const counts: Record<ImportRowOutcome, number> = {
    pending: 0,
    invalid: 0,
    created: 0,
    skipped: 0,
    failed: 0,
  };

  for (const row of rows) counts[row.outcome] = row.total;
  return counts;
}
