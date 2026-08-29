import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { schools } from './schools';
import { studentProfiles } from './student-profiles';

/**
 * How many documents one child may carry.
 *
 * Not an arbitrary round number: comfortably more than the six a Pakistani
 * school actually asks for at admission, and low enough that the profile card
 * stays a row of chips rather than a second table. Enforced in the route and
 * *stated on the form*, because a limit a person meets without warning reads as
 * a broken upload.
 */
export const MAX_STUDENT_DOCUMENTS = 10;

/** 5 MB. A phone photograph of an A4 certificate is 1–3 MB; this is headroom. */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** The longest title the column will accept. */
export const DOCUMENT_TITLE_MAX = 120;

/**
 * What may be uploaded, keyed by the canonical type to the extension used in
 * the object path.
 *
 * `image/jpg` is not in this map and must never be: it is not a real media
 * type, it is what some Windows browsers send, and the *sniffed* type is what
 * decides here — so a file whose header says `image/jpg` and whose bytes are a
 * JPEG is stored as `image/jpeg` and is correct. See `lib/image-signature.ts`.
 */
export const DOCUMENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

/** What the upload form tells the operator, in one sentence. */
export const DOCUMENT_UPLOAD_HINT =
  'PNG or JPG, up to 5 MB each, ten per student.';

/** What is wrong with a document title, or null. Blank is not a title. */
export function documentTitleProblem(title: string): string | null {
  const trimmed = title.trim();
  if (trimmed === '') return 'Give the document a title, e.g. “B-Form”.';
  if (trimmed.length > DOCUMENT_TITLE_MAX) {
    return `Titles must be ${DOCUMENT_TITLE_MAX} characters or fewer.`;
  }
  return null;
}

/**
 * student_documents — the paperwork a school keeps against a child.
 *
 * A birth certificate, a B-Form, the last school's leaving certificate, a
 * vaccination card. Schools already hold all of it; before this they held it in
 * a filing cabinet, and the product could not answer "have we got her B-Form
 * yet" without somebody walking to the cabinet.
 *
 * ── Images only, and the type is sniffed rather than believed ────────────
 * PNG and JPEG, checked against the file's own first bytes as well as the
 * browser's `Content-Type`. A renamed `.exe` presents as `image/png` to a
 * browser, and the multipart part carries whatever type the browser guessed
 * from the *name* — so the header is a hint, not a fact about the bytes.
 * `sniffImageType` in `lib/image-signature.ts` is what actually decides, and
 * the stored `content_type` is its answer rather than the client's.
 *
 * No PDF, deliberately. Every chip on the profile opens in a new tab and is
 * expected to *be* the document; a PDF renders in a plugin whose behaviour
 * differs per browser, and the school's own scanner app produces JPEGs anyway.
 * Widening this later is one CHECK and one map; narrowing it afterwards is not,
 * because rows would already exist.
 *
 * ── What is stored, and what is not ──────────────────────────────────────
 * `storage_path` is the object; `download_url` is its public URL, kept so the
 * card can link without a round trip to Storage on every render. The bucket is
 * public — the same posture the student photo has carried since Sprint 4 — so
 * this is a URL anybody holding it can fetch. This table does not change that
 * posture; the day it needs changing, `downloadObject` in `lib/storage.ts`
 * already exists for exactly that and the feedback attachments show the shape.
 *
 * `title` is the school's own words rather than an enumeration. Schools name
 * these things differently — "B-Form", "Bay Form", "Child Registration
 * Certificate" — and a fixed list produces a row of documents all filed under
 * "Other".
 *
 * ── ON DELETE CASCADE from the student ──────────────────────────────────
 * Deleting a student record already takes their enrollments, guardians and
 * concessions with it. Leaving orphaned rows here would leave the *objects*
 * orphaned too, with nothing left pointing at them to ever clean them up —
 * a school's children's birth certificates, in a bucket, unreferenced.
 */
export const studentDocuments = pgTable(
  'student_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    studentProfileId: uuid('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id, { onDelete: 'cascade' }),
    /** What the school calls it. Free text — see the docblock. */
    title: text('title').notNull(),
    storagePath: text('storage_path').notNull(),
    downloadUrl: text('download_url').notNull(),
    /** `image/png` or `image/jpeg`, as decided by the bytes. */
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** Who uploaded it. Text, not a FK: the auth uid outlives the membership. */
    uploadedByUid: text('uploaded_by_uid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The card's own question: every document for this child, at this school.
    index('student_documents_location_student_idx').on(
      table.locationId,
      table.studentProfileId,
    ),
    check(
      'student_documents_content_type_check',
      sql`${table.contentType} IN ('image/png', 'image/jpeg')`,
    ),
    // 120 is DOCUMENT_TITLE_MAX above, written out because a CHECK is DDL and
    // cannot read a TypeScript constant. The migration carries the same number.
    check(
      'student_documents_title_check',
      sql`char_length(btrim(${table.title})) BETWEEN 1 AND 120`,
    ),
    // Belt and braces over the route's own ceiling. A size that cannot be true
    // means the row and the object have stopped describing each other, and the
    // row is the one nobody can check. 5242880 is MAX_DOCUMENT_BYTES.
    check(
      'student_documents_size_check',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 5242880`,
    ),
  ],
);

export type StudentDocument = typeof studentDocuments.$inferSelect;
export type NewStudentDocument = typeof studentDocuments.$inferInsert;
