import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { academicYears } from './academic-years';
import { examTerms } from './exam-terms';
import { grades } from './grades';
import { resultSubcategories } from './result-subcategories';
import { schoolUsers } from './school-users';
import { schools } from './schools';
import { sections } from './sections';
import { studentProfiles } from './student-profiles';
import { type PromotionMechanism } from './grade-promotion-criteria';

/** Whether the school is moving this child up. Two answers, no third. */
export const PROMOTION_STATUSES = ['promoted', 'not_promoted'] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

export const PROMOTION_STATUS_LABELS: Record<PromotionStatus, string> = {
  promoted: 'Promoted',
  not_promoted: 'Not promoted',
};

export function isPromotionStatus(value: unknown): value is PromotionStatus {
  return (
    typeof value === 'string' && (PROMOTION_STATUSES as readonly string[]).includes(value)
  );
}

/** An override reason shorter than this is not a reason. */
export const OVERRIDE_REASON_MIN = 10;

/**
 * student_term_results — the academic judgement on one child for one term.
 *
 * ── This is not `promotion_runs` ─────────────────────────────────────────
 * `promotion_runs` / `promotion_decisions` (Sprint 10) is *enrolment plumbing*:
 * which section this child sits in next September. This table is the *academic
 * judgement*: did this child pass. They are different facts, decided by
 * different people at different times, and this sprint deliberately does not
 * merge them. A school can promote a child who failed, and does; the enrolment
 * row is not the place that gets recorded.
 *
 * ── `mechanism` is frozen on the row ─────────────────────────────────────
 * Copied from `grade_promotion_criteria` at compute time and never re-read from
 * it. A school that moves Grade 3 from descriptors to marks next year must not
 * have last year's report cards silently re-render as a marks sheet with every
 * column empty. What was issued stays what was issued.
 *
 * ── computed_status and final_status are both kept ───────────────────────
 * `computed_status` is what the rules said. `final_status` is what the school
 * decided. Storing only the second would leave nobody able to answer "was this
 * an override?" a year later, and storing only the first would make the
 * override screen a lie.
 *
 * ── The override reason is a first-class output, not an audit note ───────
 * The product owner was explicit: a change made by a teacher requires a reason,
 * and *that reason must be visible to all the relevant authorities including
 * parents*. So it prints on the report card and shows on the parent and student
 * portals. The CHECK enforces the pair — a differing status carries a reason of
 * at least ten characters, and a matching status carries none, so half an
 * override cannot be left behind explaining a decision that was reversed.
 */
export const studentTermResults = pgTable(
  'student_term_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => examTerms.id, { onDelete: 'cascade' }),
    studentProfileId: uuid('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id, { onDelete: 'cascade' }),
    /** The class they were in *for this term*, not the one they are in now. */
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id),
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    /** Frozen at compute time. See the docblock. */
    mechanism: text('mechanism').notNull().$type<PromotionMechanism>(),

    /** Marks mode: the arithmetic mean of the subject percentages. */
    overallPercentage: numeric('overall_percentage', { precision: 5, scale: 2 }),
    /** Marks mode: the letter, or `U` when the mean falls under every band. */
    overallGradeLabel: text('overall_grade_label'),
    /** Descriptor mode: the class teacher's overall judgement. */
    overallSubcategoryId: uuid('overall_subcategory_id').references(
      () => resultSubcategories.id,
      { onDelete: 'set null' },
    ),
    /**
     * Which descriptor counted as a fail when this term was computed.
     *
     * Frozen here for the same reason `mechanism` is. The report card counts
     * "subjects needing attention" by comparing each subject's descriptor
     * against the grade's failing one, and reading that from the *current*
     * criteria meant a school changing its failing descriptor changed the count
     * printed on cards it had issued and handed out last year. A parent's copy
     * and the school's copy would then disagree, and only one of them would
     * have changed.
     *
     * Null on a marks-mode row, and on rows computed before this column
     * existed — the card falls back to the live criteria there, which is the
     * behaviour those rows were produced under.
     */
    failingSubcategoryId: uuid('failing_subcategory_id').references(
      () => resultSubcategories.id,
      { onDelete: 'set null' },
    ),

    computedStatus: text('computed_status').notNull().$type<PromotionStatus>(),
    finalStatus: text('final_status').notNull().$type<PromotionStatus>(),
    /** Required, and 10+ characters, whenever the two statuses differ. */
    overrideReason: text('override_reason'),
    overriddenBy: uuid('overridden_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    overriddenAt: timestamp('overridden_at', { withTimezone: true }),

    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The upsert target: recomputing a section corrects the same rows.
    uniqueIndex('student_term_results_term_student_idx').on(
      table.locationId,
      table.termId,
      table.studentProfileId,
    ),
    // The portal's question — every term this child has a judgement for.
    index('student_term_results_location_student_idx').on(
      table.locationId,
      table.studentProfileId,
    ),
    // The class teacher's question — this term, this class.
    index('student_term_results_term_section_idx').on(table.termId, table.sectionId),
    check(
      'student_term_results_status_check',
      sql`${table.computedStatus} IN ('promoted', 'not_promoted') AND ${table.finalStatus} IN ('promoted', 'not_promoted')`,
    ),
    check(
      'student_term_results_override_check',
      sql`(${table.finalStatus} = ${table.computedStatus} AND ${table.overrideReason} IS NULL) OR (${table.finalStatus} <> ${table.computedStatus} AND ${table.overrideReason} IS NOT NULL AND char_length(btrim(${table.overrideReason})) >= 10)`,
    ),
  ],
);

export type StudentTermResult = typeof studentTermResults.$inferSelect;
export type NewStudentTermResult = typeof studentTermResults.$inferInsert;
