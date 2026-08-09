import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { academicYears } from './academic-years';
import { schools } from './schools';
import { sections } from './sections';
import { studentProfiles } from './student-profiles';

export const IMPORT_STATUSES = [
  /** Uploaded and parsed; columns not yet mapped. */
  'uploaded',
  /** Mapped and validated. The dry-run report is readable. */
  'validated',
  /** Committed. Every row has an outcome. */
  'committed',
  /** Abandoned by the operator. Kept for the audit trail. */
  'cancelled',
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  uploaded: 'Awaiting column mapping',
  validated: 'Checked — not yet imported',
  committed: 'Imported',
  cancelled: 'Cancelled',
};

export const IMPORT_ROW_OUTCOMES = [
  /** Not yet committed. */
  'pending',
  /** Would fail, or did. `errors` says why. */
  'invalid',
  /** Created a student. */
  'created',
  /**
   * Matched a student who already existed and was left alone.
   *
   * This is what makes a re-run safe. See the docblock below.
   */
  'skipped',
  /** Committed rows that failed at the database despite validating. */
  'failed',
] as const;
export type ImportRowOutcome = (typeof IMPORT_ROW_OUTCOMES)[number];

/**
 * student_import_batches — one uploaded spreadsheet.
 *
 * ── Why the file becomes rows in a table rather than a request ───────────
 * The import is four steps with the operator's judgement in the middle:
 * upload, map the columns, read the dry-run report, commit. Between the second
 * and fourth there is a person deciding whether 380 students and 20 complaints
 * is a good result or a broken mapping. Holding that in a request, a session or
 * a temp file means a closed laptop loses the work and a re-upload starts over.
 *
 * It also makes the dry run *real*: the report is not a prediction produced by
 * one code path and then acted on by another, it is the stored outcome of the
 * same validation the commit re-runs. A dry run that can disagree with the
 * commit is worse than no dry run, because it is believed.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────
 * A batch commits once (`status` moves to `committed` and the route refuses a
 * second attempt), and within a batch each row is matched on the admission
 * number before it is written. So the two ways an import gets run twice — the
 * operator clicks commit twice, and the operator re-uploads the same file next
 * week — are both absorbed: the first by the batch status, the second by rows
 * coming back `skipped` rather than creating a second Ayesha Khan.
 *
 * `column_map` is jsonb because the shape is the school's, not ours: it maps
 * our field names to whatever their spreadsheet calls them, and no two schools
 * export the same headers.
 */
export const studentImportBatches = pgTable(
  'student_import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The tenant key — see STATE.md §1. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** What the operator uploaded, for recognising the batch later. */
    fileName: text('file_name').notNull(),
    status: text('status').notNull().default('uploaded').$type<ImportStatus>(),
    /** Header row as uploaded, in order. Drives the mapping UI. */
    sourceColumns: jsonb('source_columns').notNull().$type<string[]>(),
    /** `{ fullName: "Student Name", ... }` — our field to their header. */
    columnMap: jsonb('column_map').$type<Record<string, string>>(),
    /**
     * Where the students land. Chosen once for the batch rather than per row:
     * a spreadsheet is how a school loads one class, and letting each row
     * name its own section would make a typo in row 300 create a section.
     */
    academicYearId: uuid('academic_year_id').references(() => academicYears.id),
    sectionId: uuid('section_id').references(() => sections.id),
    totalRows: integer('total_rows').notNull().default(0),
    validRows: integer('valid_rows').notNull().default(0),
    invalidRows: integer('invalid_rows').notNull().default(0),
    createdRows: integer('created_rows').notNull().default(0),
    skippedRows: integer('skipped_rows').notNull().default(0),
    failedRows: integer('failed_rows').notNull().default(0),
    /** Supabase auth id of whoever uploaded it. */
    uploadedByUid: text('uploaded_by_uid'),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('student_import_batches_location_id_idx').on(table.locationId),
    index('student_import_batches_location_status_idx').on(
      table.locationId,
      table.status,
    ),
    check(
      'student_import_batches_status_check',
      sql`${table.status} IN ('uploaded', 'validated', 'committed', 'cancelled')`,
    ),
  ],
);

/**
 * student_import_rows — one line of the spreadsheet, with what became of it.
 *
 * `raw` keeps the line exactly as uploaded. That is what lets the report say
 * "row 47: date of birth '31/02/2015' is not a date" instead of "row 47:
 * invalid", and it is what an operator needs to go and fix their file.
 *
 * `errors` is an array rather than a single message because a bad row is
 * usually bad in several ways at once, and reporting them one per re-upload is
 * how a 400-row import takes an afternoon.
 *
 * **A failure here never aborts the batch.** Postgres would happily roll the
 * whole thing back on one bad row; the commit deliberately does not ask it to,
 * because the point of importing 400 students is not to discover that one of
 * them has a duplicate admission number.
 */
export const studentImportRows = pgTable(
  'student_import_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => studentImportBatches.id, { onDelete: 'cascade' }),
    /** 1-based, counting the header as row 1, so it matches what they see. */
    rowNumber: integer('row_number').notNull(),
    raw: jsonb('raw').notNull().$type<Record<string, string>>(),
    outcome: text('outcome').notNull().default('pending').$type<ImportRowOutcome>(),
    errors: jsonb('errors').notNull().default(sql`'[]'::jsonb`).$type<string[]>(),
    /** Set once the row created or matched a student. */
    studentProfileId: uuid('student_profile_id').references(
      () => studentProfiles.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('student_import_rows_location_id_idx').on(table.locationId),
    index('student_import_rows_batch_id_idx').on(table.batchId),
    // The report is read batch-at-a-time filtered by outcome.
    index('student_import_rows_batch_outcome_idx').on(table.batchId, table.outcome),
    uniqueIndex('student_import_rows_batch_row_idx').on(table.batchId, table.rowNumber),
    check(
      'student_import_rows_outcome_check',
      sql`${table.outcome} IN ('pending', 'invalid', 'created', 'skipped', 'failed')`,
    ),
  ],
);

export type StudentImportBatch = typeof studentImportBatches.$inferSelect;
export type StudentImportRow = typeof studentImportRows.$inferSelect;
