import 'server-only';

import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';

import {
  lessonPlans,
  schoolUsers,
  sections,
  subjects,
  type LessonPlanStatus,
} from '@/db/schema';

import { db } from './drizzle';

/**
 * `lib/lesson-plan-queries.ts` — a teacher's weekly plans.
 *
 * Tenant-scoped like every other query module: `locationId` is the first
 * argument and comes from verified session claims.
 *
 * ── Ownership is enforced here, and it is the whole gate ─────────────────
 * There is no `lessonplans.*` permission. `listOwnPlans` filters on the
 * teacher id derived from the session, and `updatePlan`/`deletePlan` carry the
 * teacher id in their `WHERE` rather than checking it first and acting second —
 * so a plan id belonging to another teacher matches no row instead of being
 * edited in their name. A check-then-act would be the same code with a race in
 * it.
 *
 * The school-wide read (`listSharedPlans`) is deliberately a different function
 * with no teacher filter and only `shared` rows, so a draft cannot leak into it
 * by somebody adding a parameter to the wrong one.
 */

export interface LessonPlanRow {
  id: string;
  teacherId: string;
  teacherName: string;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  weekStarting: string;
  title: string;
  body: string;
  homework: string | null;
  status: LessonPlanStatus;
  updatedAt: Date;
}

const PLAN_COLUMNS = {
  id: lessonPlans.id,
  teacherId: lessonPlans.teacherId,
  teacherName: schoolUsers.name,
  sectionId: lessonPlans.sectionId,
  sectionName: sections.name,
  subjectId: lessonPlans.subjectId,
  subjectName: subjects.name,
  weekStarting: lessonPlans.weekStarting,
  title: lessonPlans.title,
  body: lessonPlans.body,
  homework: lessonPlans.homework,
  status: lessonPlans.status,
  updatedAt: lessonPlans.updatedAt,
} as const;

/** The Monday of the week a date falls in, as `YYYY-MM-DD`. */
export function weekStartingOf(date: string): string {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  const at = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  // getUTCDay() is 0 = Sunday; shift so Monday is 0 and subtract that many days.
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));
  return at.toISOString().slice(0, 10);
}

/** True when a date is a Monday — what the table's CHECK constraint enforces. */
export function isMonday(date: string): boolean {
  return weekStartingOf(date) === date;
}

/** One teacher's own plans, newest week first. Drafts included: they are theirs. */
export async function listOwnPlans(
  locationId: string,
  teacherId: string,
  window: { from: string; to: string },
): Promise<LessonPlanRow[]> {
  return db
    .select(PLAN_COLUMNS)
    .from(lessonPlans)
    .innerJoin(schoolUsers, eq(schoolUsers.id, lessonPlans.teacherId))
    .innerJoin(sections, eq(sections.id, lessonPlans.sectionId))
    .innerJoin(subjects, eq(subjects.id, lessonPlans.subjectId))
    .where(
      and(
        eq(lessonPlans.locationId, locationId),
        eq(lessonPlans.teacherId, teacherId),
        gte(lessonPlans.weekStarting, window.from),
        lte(lessonPlans.weekStarting, window.to),
      ),
    )
    .orderBy(desc(lessonPlans.weekStarting), asc(subjects.name));
}

/**
 * Every *shared* plan at the school, for a coordinator or head.
 *
 * No teacher filter and no draft rows. A separate function rather than a
 * parameter on the one above, so that "show me everyone's" and "include drafts"
 * cannot be turned on together by accident.
 */
export async function listSharedPlans(
  locationId: string,
  window: { from: string; to: string },
  filters: { sectionId?: string | undefined } = {},
): Promise<LessonPlanRow[]> {
  const conditions = [
    eq(lessonPlans.locationId, locationId),
    eq(lessonPlans.status, 'shared' as LessonPlanStatus),
    gte(lessonPlans.weekStarting, window.from),
    lte(lessonPlans.weekStarting, window.to),
  ];

  if (filters.sectionId !== undefined && filters.sectionId !== '') {
    conditions.push(eq(lessonPlans.sectionId, filters.sectionId));
  }

  return db
    .select(PLAN_COLUMNS)
    .from(lessonPlans)
    .innerJoin(schoolUsers, eq(schoolUsers.id, lessonPlans.teacherId))
    .innerJoin(sections, eq(sections.id, lessonPlans.sectionId))
    .innerJoin(subjects, eq(subjects.id, lessonPlans.subjectId))
    .where(and(...conditions))
    .orderBy(desc(lessonPlans.weekStarting), asc(schoolUsers.name));
}

export interface LessonPlanInput {
  sectionId: string;
  subjectId: string;
  weekStarting: string;
  title: string;
  body: string;
  homework: string | null;
  status: LessonPlanStatus;
}

/**
 * Creates or corrects the plan for one (teacher, section, subject, week).
 *
 * An upsert on the unique index, so a teacher who writes the same week twice is
 * correcting rather than accumulating near-duplicates — the same shape the
 * attendance register uses, and for the same reason.
 */
export async function savePlan(
  locationId: string,
  teacherId: string,
  input: LessonPlanInput,
): Promise<string | null> {
  const rows = await db
    .insert(lessonPlans)
    .values({
      locationId,
      teacherId,
      sectionId: input.sectionId,
      subjectId: input.subjectId,
      weekStarting: input.weekStarting,
      title: input.title,
      body: input.body,
      homework: input.homework,
      status: input.status,
    })
    .onConflictDoUpdate({
      target: [
        lessonPlans.teacherId,
        lessonPlans.sectionId,
        lessonPlans.subjectId,
        lessonPlans.weekStarting,
      ],
      set: {
        title: input.title,
        body: input.body,
        homework: input.homework,
        status: input.status,
        updatedAt: new Date(),
      },
    })
    .returning({ id: lessonPlans.id });

  return rows[0]?.id ?? null;
}

/**
 * Deletes one of this teacher's own plans.
 *
 * The teacher id is in the `WHERE`, not checked beforehand: a plan belonging to
 * somebody else matches no row and the function reports that it deleted
 * nothing, which is both the correct outcome and the same one a non-existent id
 * gets. Returns whether anything was removed.
 */
export async function deleteOwnPlan(
  locationId: string,
  teacherId: string,
  planId: string,
): Promise<boolean> {
  const removed = await db
    .delete(lessonPlans)
    .where(
      and(
        eq(lessonPlans.locationId, locationId),
        eq(lessonPlans.teacherId, teacherId),
        eq(lessonPlans.id, planId),
      ),
    )
    .returning({ id: lessonPlans.id });

  return removed.length > 0;
}
