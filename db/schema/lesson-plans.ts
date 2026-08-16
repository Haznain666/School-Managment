import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { schoolUsers } from './school-users';
import { schools } from './schools';
import { sections } from './sections';
import { subjects } from './subjects';

/**
 * lesson_plans — what a teacher intends to cover, week by week.
 *
 * A working document, not a record of what happened. Pakistani schools ask
 * teachers for a weekly plan per subject per section and a coordinator reviews
 * it; that is the whole feature, and the shape follows it exactly.
 *
 * ── One row per (teacher, section, subject, week) ─────────────────────────
 * The unique index is what makes "this week's plan for 5-A Maths" a thing that
 * can be opened and edited rather than a list that accumulates near-duplicates.
 * A teacher who writes the same week twice is correcting, not adding.
 *
 * ── Why the week is a Monday date and not a week number ───────────────────
 * ISO week numbers are correct and unreadable: nobody in a staffroom knows
 * whether the exam is in week 34. `week_starting` is the Monday, so the value
 * is a date a teacher recognises and every ordering is a plain date sort. The
 * CHECK enforces that it *is* a Monday, because a plan filed against a Thursday
 * would sit between two weeks in every list that shows it.
 *
 * ── Draft and shared, not draft and published ─────────────────────────────
 * `shared` deliberately does not mean "sent". Nothing is delivered when a plan
 * is shared; it becomes visible to the school's coordinators and heads. Calling
 * it "published" would borrow a word this codebase already uses for exam
 * results, where publishing is irreversible and puts a number in front of a
 * parent. A shared plan can go back to draft, and it must be able to.
 *
 * ── Ownership is the gate, not a permission key ───────────────────────────
 * There is no `lessonplans.*` permission. A teacher writes their own and can
 * read no one else's; a coordinator, head or administrator reads every shared
 * plan in the school through `academics.read`, which they already hold and
 * which is exactly the sentence "see subjects, the timetable and the register".
 * A new key here would be a toggle no school has a reason to move.
 */

export const LESSON_PLAN_STATUSES = ['draft', 'shared'] as const;
export type LessonPlanStatus = (typeof LESSON_PLAN_STATUSES)[number];

export const LESSON_PLAN_STATUS_LABELS: Record<LessonPlanStatus, string> = {
  draft: 'Draft',
  shared: 'Shared with school',
};

export function isLessonPlanStatus(value: unknown): value is LessonPlanStatus {
  return (
    typeof value === 'string' &&
    (LESSON_PLAN_STATUSES as readonly string[]).includes(value)
  );
}

/** Caps the API enforces too, so a plan cannot be grown past what a page shows. */
export const MAX_LESSON_PLAN_TITLE = 160;
export const MAX_LESSON_PLAN_BODY = 8000;

export const lessonPlans = pgTable(
  'lesson_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /**
     * Whose plan it is, as a portal account rather than a staff record.
     *
     * `school_users` is what a session resolves to, so ownership can be checked
     * without a second hop through `staff` — and a teacher who has a portal
     * account but no HR record (which happens, staff records are entered later)
     * can still file a plan.
     */
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    /** The Monday of the week this plan covers. */
    weekStarting: date('week_starting').notNull(),
    title: text('title').notNull(),
    /**
     * The plan itself, as plain text.
     *
     * Not rich text and not markdown: it is rendered with `whitespace-pre-wrap`
     * and nothing interprets it, so a teacher pasting from Word cannot inject
     * markup into a coordinator's screen. `SPRINTS.md` §0.1 pins the dependency
     * list and an editor would be the first thing to breach it.
     */
    body: text('body').notNull().default(''),
    /** What a teacher plans to hand out or ask for. Optional, one line. */
    homework: text('homework'),
    status: text('status').notNull().default('draft').$type<LessonPlanStatus>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('lesson_plans_location_id_idx').on(table.locationId),
    // The teacher's own list: this school, me, newest week first.
    index('lesson_plans_location_teacher_week_idx').on(
      table.locationId,
      table.teacherId,
      table.weekStarting,
    ),
    // The coordinator's list: this school, this section, this week.
    index('lesson_plans_location_section_week_idx').on(
      table.locationId,
      table.sectionId,
      table.weekStarting,
    ),
    uniqueIndex('lesson_plans_unique_idx').on(
      table.teacherId,
      table.sectionId,
      table.subjectId,
      table.weekStarting,
    ),
    check(
      'lesson_plans_status_check',
      sql`${table.status} IN ('draft', 'shared')`,
    ),
    // Monday, so a plan cannot be filed between two weeks. Postgres `isodow`
    // makes Monday 1, matching `timetable_entries.day_of_week` being 0-based
    // Monday everywhere else in this schema.
    check(
      'lesson_plans_week_starting_check',
      sql`extract(isodow from ${table.weekStarting}) = 1`,
    ),
    check(
      'lesson_plans_title_check',
      sql`length(${table.title}) BETWEEN 1 AND 160`,
    ),
  ],
);

export type LessonPlan = typeof lessonPlans.$inferSelect;
export type NewLessonPlan = typeof lessonPlans.$inferInsert;
