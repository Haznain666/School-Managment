import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { academicYears } from './academic-years';
import { grades } from './grades';
import { schools } from './schools';
import { sections } from './sections';
import { studentEnrollments } from './student-enrollments';
import { studentProfiles } from './student-profiles';

export const PROMOTION_RUN_STATUSES = ['draft', 'applied'] as const;
export type PromotionRunStatus = (typeof PROMOTION_RUN_STATUSES)[number];

export const PROMOTION_DECISIONS = ['promote', 'retain', 'graduate'] as const;
export type PromotionDecision = (typeof PROMOTION_DECISIONS)[number];

export const PROMOTION_DECISION_LABELS: Record<PromotionDecision, string> = {
  promote: 'Promote',
  retain: 'Retain',
  graduate: 'Graduate',
};

/**
 * promotion_runs — one grade rolled from one academic year into the next.
 *
 * ── One grade at a time, not the whole school ────────────────────────────
 * The same reasoning as Sprint 9's "an exam belongs to one section": the
 * decision being made is per class, by somebody who knows that class. A
 * whole-school button would be one click from moving eight hundred children,
 * and the only person who could review the preview is nobody in particular.
 * A school with nine grades does this nine times, which is also nine records
 * of who decided what.
 *
 * ── Draft, then applied ─────────────────────────────────────────────────
 * A run is built as a draft — every student in the grade, each with a default
 * decision — and reviewed before it writes anything. `applied_at` is the point
 * of no return, and a run that has it cannot be edited or re-applied.
 *
 * **Promotion never mutates history.** Applying writes *new*
 * `student_enrollments` rows for the next year and leaves last year's alone,
 * closing them as `graduated` or leaving them `active` per decision. "Which
 * section was she in two years ago" has to stay answerable — that is what the
 * enrollment table is for.
 */
export const promotionRuns = pgTable(
  'promotion_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The tenant key — see STATE.md §1. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** The grade being rolled over, as it stands in `from_academic_year_id`. */
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id),
    fromAcademicYearId: uuid('from_academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    toAcademicYearId: uuid('to_academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    status: text('status').notNull().default('draft').$type<PromotionRunStatus>(),
    promotedCount: integer('promoted_count').notNull().default(0),
    retainedCount: integer('retained_count').notNull().default(0),
    graduatedCount: integer('graduated_count').notNull().default(0),
    /** Supabase auth id of whoever applied it. */
    appliedByUid: text('applied_by_uid'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('promotion_runs_location_id_idx').on(table.locationId),
    index('promotion_runs_location_status_idx').on(table.locationId, table.status),
    check(
      'promotion_runs_status_check',
      sql`${table.status} IN ('draft', 'applied')`,
    ),
    // Rolling the same grade between the same two years twice is a mistake,
    // not a workflow. A second attempt has to reopen the first.
    uniqueIndex('promotion_runs_grade_years_idx').on(
      table.gradeId,
      table.fromAcademicYearId,
      table.toAcademicYearId,
    ),
  ],
);

/**
 * promotion_decisions — what was decided for one student, and what it did.
 *
 * `to_section_id` is null for a retain (they stay where they are) and for a
 * graduate (there is nowhere to go). `created_enrollment_id` is the row this
 * decision produced, which is what makes the run auditable after the fact
 * rather than merely counted.
 */
export const promotionDecisions = pgTable(
  'promotion_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => promotionRuns.id, { onDelete: 'cascade' }),
    studentProfileId: uuid('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id, { onDelete: 'cascade' }),
    /** The enrollment being rolled over — last year's row. */
    fromEnrollmentId: uuid('from_enrollment_id')
      .notNull()
      .references(() => studentEnrollments.id),
    decision: text('decision').notNull().default('promote').$type<PromotionDecision>(),
    /** Where a promoted student lands. Null for retain and graduate. */
    toSectionId: uuid('to_section_id').references(() => sections.id),
    /** The enrollment this decision created, once applied. */
    createdEnrollmentId: uuid('created_enrollment_id').references(
      () => studentEnrollments.id,
      { onDelete: 'set null' },
    ),
    /** Why a child was held back. Shown to whoever reviews the run. */
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('promotion_decisions_location_id_idx').on(table.locationId),
    index('promotion_decisions_run_id_idx').on(table.runId),
    uniqueIndex('promotion_decisions_run_student_idx').on(
      table.runId,
      table.studentProfileId,
    ),
    check(
      'promotion_decisions_decision_check',
      sql`${table.decision} IN ('promote', 'retain', 'graduate')`,
    ),
  ],
);

export type PromotionRun = typeof promotionRuns.$inferSelect;
export type PromotionDecisionRow = typeof promotionDecisions.$inferSelect;
