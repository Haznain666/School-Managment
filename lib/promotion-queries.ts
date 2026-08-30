import 'server-only';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import {
  academicYears,
  branches,
  grades,
  promotionDecisions,
  promotionRuns,
  schoolUsers,
  sections,
  studentEnrollments,
  studentProfiles,
  type PromotionDecision,
  type PromotionRun,
} from '@/db/schema';

import { db } from './drizzle';
import { reconcileFamilyAfterDeparture } from './sibling-discounts';

/**
 * Rolling a school over to the next academic year.
 *
 * ── The rule the whole module exists to keep ─────────────────────────────
 * **Promotion never edits an enrollment.** Applying a run writes *new*
 * `student_enrollments` rows for the receiving year and closes the old ones by
 * status. "Which section was she in two years ago" is a question schools are
 * asked constantly — for a transfer certificate, a character certificate, a
 * board form — and it is answerable only because the old row is still there
 * saying so.
 *
 * ── Draft, review, apply ────────────────────────────────────────────────
 * A run is built as a draft holding one decision per student, defaulted to
 * promote. Nothing is written to the enrollment table until it is applied, and
 * an applied run is frozen. The middle step is not ceremony: promoting is the
 * one action in this application that touches every child at once, and the
 * person who should check it is the class teacher looking at names.
 */

/**
 * The decision vocabulary, re-exported so routes validating a request body do
 * not import the schema barrel for one array.
 */
export const PROMOTION_DECISION_VALUES = ['promote', 'retain', 'graduate'] as const;

export interface PromotionCandidate {
  studentProfileId: string;
  enrollmentId: string;
  name: string;
  studentId: string;
  sectionId: string;
  sectionName: string;
  /** Already enrolled in the receiving year — cannot be promoted again. */
  alreadyRolled: boolean;
}

export interface DecisionRow {
  id: string;
  studentProfileId: string;
  fromEnrollmentId: string;
  decision: PromotionDecision;
  toSectionId: string | null;
  note: string | null;
  name: string;
  studentId: string;
  /** The section they are leaving — what decides which campus they are at. */
  fromSectionId: string;
  fromSectionName: string;
}

/**
 * Everyone actively enrolled in a grade in the year being rolled out of.
 *
 * `alreadyRolled` is the guard against a second run for the same students by a
 * different route — a grade split across two runs, or a run rebuilt after
 * being deleted. The database would accept the duplicate enrollment only up to
 * its unique key on (student, year); this reports it before the operator gets
 * that far, and by name.
 */
export async function listPromotionCandidates(
  locationId: string,
  gradeId: string,
  fromAcademicYearId: string,
  toAcademicYearId: string,
): Promise<PromotionCandidate[]> {
  const rows = await db
    .select({
      studentProfileId: studentProfiles.id,
      enrollmentId: studentEnrollments.id,
      name: schoolUsers.name,
      studentId: studentProfiles.studentId,
      sectionId: sections.id,
      sectionName: sections.name,
    })
    .from(studentEnrollments)
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentEnrollments.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.academicYearId, fromAcademicYearId),
        eq(studentEnrollments.status, 'active'),
        eq(sections.gradeId, gradeId),
      ),
    )
    .orderBy(asc(sections.name), asc(schoolUsers.name));

  if (rows.length === 0) return [];

  const rolled = await db
    .select({ studentProfileId: studentEnrollments.studentProfileId })
    .from(studentEnrollments)
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.academicYearId, toAcademicYearId),
        // *Actively* enrolled. A student transferred between campuses within
        // the receiving year leaves a closed row there, and counting that as
        // "already promoted" would refuse to roll them over at all.
        eq(studentEnrollments.status, 'active'),
        inArray(
          studentEnrollments.studentProfileId,
          rows.map((row) => row.studentProfileId),
        ),
      ),
    );

  const rolledIds = new Set(rolled.map((row) => row.studentProfileId));

  return rows.map((row) => ({
    ...row,
    alreadyRolled: rolledIds.has(row.studentProfileId),
  }));
}

/**
 * The grade a school would normally promote into.
 *
 * Grades carry a `sort_order` inside a branch, which is the only thing in the
 * schema that knows Grade 5 comes after Grade 4. The next one up is a
 * *suggestion* the operator can override — a school with a split stream, or
 * one whose sort order was entered carelessly, must not have this imposed —
 * and a grade with nothing above it means "this year group graduates", which
 * is why the default decision flips to `graduate` there.
 */
export async function suggestNextGrade(
  locationId: string,
  gradeId: string,
): Promise<{ id: string; name: string } | null> {
  const current = await db
    .select({ branchId: grades.branchId, sortOrder: grades.sortOrder })
    .from(grades)
    .where(and(eq(grades.locationId, locationId), eq(grades.id, gradeId)))
    .limit(1);

  const grade = current[0];
  if (grade === undefined) return null;

  const next = await db
    .select({ id: grades.id, name: grades.name })
    .from(grades)
    .where(
      and(
        eq(grades.locationId, locationId),
        eq(grades.branchId, grade.branchId),
        eq(grades.isActive, true),
        sql`${grades.sortOrder} > ${grade.sortOrder}`,
      ),
    )
    .orderBy(asc(grades.sortOrder))
    .limit(1);

  return next[0] ?? null;
}

export async function getPromotionRun(
  locationId: string,
  runId: string,
): Promise<PromotionRun | null> {
  const rows = await db
    .select()
    .from(promotionRuns)
    .where(and(eq(promotionRuns.locationId, locationId), eq(promotionRuns.id, runId)))
    .limit(1);

  return rows[0] ?? null;
}

export async function listRunDecisions(runId: string): Promise<DecisionRow[]> {
  return db
    .select({
      id: promotionDecisions.id,
      studentProfileId: promotionDecisions.studentProfileId,
      fromEnrollmentId: promotionDecisions.fromEnrollmentId,
      decision: promotionDecisions.decision,
      toSectionId: promotionDecisions.toSectionId,
      note: promotionDecisions.note,
      name: schoolUsers.name,
      studentId: studentProfiles.studentId,
      fromSectionId: sections.id,
      fromSectionName: sections.name,
    })
    .from(promotionDecisions)
    .innerJoin(studentProfiles, eq(studentProfiles.id, promotionDecisions.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .innerJoin(
      studentEnrollments,
      eq(studentEnrollments.id, promotionDecisions.fromEnrollmentId),
    )
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .where(eq(promotionDecisions.runId, runId))
    .orderBy(asc(sections.name), asc(schoolUsers.name));
}

export interface ApplyResult {
  promoted: number;
  retained: number;
  graduated: number;
  /** Decisions that could not be carried out, with the reason. */
  refused: Array<{ name: string; reason: string }>;
  /**
   * Promotions whose destination is at another campus — Sprint 19b, item 15c.
   *
   * Kept apart from `refused` because it is a different answer with a different
   * status code: `refused` means "fix these rows and re-run", and this means
   * "you are trying to do something that is not a promotion". A cross-campus
   * move is a **transfer**, which has its own screen, its own fee split and its
   * own record in `student_transfers`. Carrying it out here would move a child
   * between campuses leaving no transfer row, and every question a school later
   * asks about that move — when, why, who authorised it, what happened to the
   * fees — would have no answer anywhere.
   */
  crossCampus: Array<{ name: string; from: string; to: string }>;
}

/**
 * The campus each of these sections belongs to, by section id.
 *
 * Sections reach a campus through their grade, which is the only row in the
 * schema that carries one. Read for the whole run in a single statement: a
 * class of 128 resolved one at a time is 128 round trips to Supabase before a
 * single row is written, which is the shape of defect the set-based rewrite of
 * `applyPromotionRun` below exists to avoid.
 */
async function campusBySection(
  locationId: string,
  sectionIds: readonly string[],
): Promise<Map<string, { branchId: string; branchName: string | null }>> {
  if (sectionIds.length === 0) return new Map();

  const rows = await db
    .select({
      sectionId: sections.id,
      branchId: grades.branchId,
      branchName: branches.name,
    })
    .from(sections)
    .innerJoin(
      grades,
      and(eq(grades.id, sections.gradeId), eq(grades.locationId, locationId)),
    )
    .leftJoin(branches, eq(branches.id, grades.branchId))
    .where(
      and(eq(sections.locationId, locationId), inArray(sections.id, [...sectionIds])),
    );

  return new Map(
    rows.map((row) => [
      row.sectionId,
      { branchId: row.branchId, branchName: row.branchName },
    ]),
  );
}

/**
 * Carries out an applied run.
 *
 * ── What each decision writes ───────────────────────────────────────────
 *   promote  — old enrollment closed as `transferred`, new `active` row in the
 *              receiving year and chosen section.
 *   retain   — old enrollment closed as `transferred`, new `active` row in the
 *              receiving year, **same section**. A retained child is still in
 *              the new school year; they are just in the same class again, and
 *              leaving them on last year's enrollment would hide them from
 *              every roster the new year draws.
 *   graduate — old enrollment closed as `graduated`. No new row: there is
 *              nowhere to go, and inventing one would put a leaver on a
 *              register.
 *
 * ── One transaction for the whole run ───────────────────────────────────
 * Unlike the import, this *is* all-or-nothing, and the difference is worth
 * stating. An import's rows are independent students from a file the operator
 * can fix and re-run. A promotion is one decision about one class, and a half
 * promoted grade is a school where some children are in next year and some are
 * not, with no screen that shows you which. The refusals below are therefore
 * checked *before* the transaction opens, not caught inside it.
 */
export async function applyPromotionRun(
  run: PromotionRun,
  actorUid: string,
): Promise<ApplyResult> {
  const decisions = await listRunDecisions(run.id);

  // Students who already hold an enrollment in the receiving year. Writing a
  // second would violate the unique key; naming them is more use than the
  // constraint's error.
  const existing = await db
    .select({ studentProfileId: studentEnrollments.studentProfileId })
    .from(studentEnrollments)
    .where(
      and(
        eq(studentEnrollments.locationId, run.locationId),
        eq(studentEnrollments.academicYearId, run.toAcademicYearId),
        // See `listPromotionCandidates` — a closed row in the receiving year
        // is history, not a promotion that already happened.
        eq(studentEnrollments.status, 'active'),
        inArray(
          studentEnrollments.studentProfileId,
          decisions.map((decision) => decision.studentProfileId),
        ),
      ),
    );

  const alreadyRolled = new Set(existing.map((row) => row.studentProfileId));

  /*
   * The campus on both ends of every promotion in this run — item 15c.
   *
   * Read here rather than trusted from the browser. The picker already narrows
   * the destination list to the sending grade's campus, and that is a
   * courtesy: a stale tab left open across a grade reassignment, a request
   * built by hand, and a run whose decisions were saved before the campus moved
   * all arrive looking exactly like a valid promotion.
   */
  const campuses = await campusBySection(run.locationId, [
    ...decisions.map((decision) => decision.fromSectionId),
    ...decisions.flatMap((decision) =>
      decision.toSectionId === null ? [] : [decision.toSectionId],
    ),
  ]);

  const refused: ApplyResult['refused'] = [];
  const crossCampus: ApplyResult['crossCampus'] = [];
  const actionable: DecisionRow[] = [];

  for (const decision of decisions) {
    if (decision.decision !== 'graduate' && alreadyRolled.has(decision.studentProfileId)) {
      refused.push({
        name: decision.name,
        reason: 'Already enrolled in the receiving year.',
      });
      continue;
    }
    if (decision.decision === 'promote' && decision.toSectionId === null) {
      refused.push({ name: decision.name, reason: 'No section chosen.' });
      continue;
    }

    if (decision.decision === 'promote' && decision.toSectionId !== null) {
      const from = campuses.get(decision.fromSectionId);
      const to = campuses.get(decision.toSectionId);

      /*
       * A promotion stays inside one campus. Moving between them is a
       * *transfer* — its own screen, its own fee split, its own record — and
       * doing it here would leave a child at another campus with nothing
       * anywhere saying when or why.
       *
       * An unresolvable campus is not treated as a mismatch. A section the
       * lookup could not find is already about to fail on its foreign key, and
       * reporting it as a cross-campus move would name a campus that does not
       * exist.
       */
      if (
        from !== undefined &&
        to !== undefined &&
        from.branchId !== to.branchId
      ) {
        crossCampus.push({
          name: decision.name,
          from: from.branchName ?? 'their campus',
          to: to.branchName ?? 'another campus',
        });
        continue;
      }
    }

    actionable.push(decision);
  }

  if (refused.length > 0 || crossCampus.length > 0) {
    // Nothing is written. A promotion the operator has to reconcile by hand
    // afterwards is worse than one they have to fix and re-run.
    return { promoted: 0, retained: 0, graduated: 0, refused, crossCampus };
  }

  const result: ApplyResult = {
    promoted: actionable.filter((entry) => entry.decision === 'promote').length,
    retained: actionable.filter((entry) => entry.decision === 'retain').length,
    graduated: actionable.filter((entry) => entry.decision === 'graduate').length,
    refused: [],
    crossCampus: [],
  };

  const enrollmentDate = new Date().toISOString().slice(0, 10);

  /*
   * Four statements, whatever the size of the class.
   *
   * The first version of this looped: three statements per student, inside one
   * transaction. A class of 128 is nearly 400 round trips to Supabase — minutes
   * rather than seconds, with a transaction held open throughout — and it was
   * the same defect the importer's dry run had. Measured in the browser, both
   * times.
   *
   * The set-based form also removes the read that used to fetch a retained
   * student's section one row at a time: `COALESCE(to_section_id, e.section_id)`
   * says the same thing in the insert. A retain still carries no
   * `to_section_id` — there is no choice being made, and storing one would
   * create a second place the answer could be wrong.
   */
  await db.transaction(async (tx) => {
    // Promotes and retains gain a row in the receiving year. Graduates do not:
    // there is nowhere to go, and inventing a row would put a leaver on a
    // register.
    await tx.execute(sql`
      INSERT INTO student_enrollments
        (location_id, student_profile_id, section_id, academic_year_id, status, enrollment_date)
      SELECT ${run.locationId}, d.student_profile_id,
             COALESCE(d.to_section_id, e.section_id),
             ${run.toAcademicYearId}, 'active', ${enrollmentDate}
      FROM promotion_decisions d
      JOIN student_enrollments e ON e.id = d.from_enrollment_id
      WHERE d.run_id = ${run.id} AND d.decision <> 'graduate'
    `);

    // Link each decision to the enrollment it produced, so the run can be read
    // back afterwards and believed rather than merely counted.
    await tx.execute(sql`
      UPDATE promotion_decisions AS d
      SET created_enrollment_id = e.id, updated_at = now()
      FROM student_enrollments e
      WHERE e.student_profile_id = d.student_profile_id
        AND e.academic_year_id = ${run.toAcademicYearId}
        AND d.run_id = ${run.id}
        AND d.decision <> 'graduate'
    `);

    // Close last year's rows. Never deleted, never edited beyond their status:
    // "which section was she in two years ago" has to stay answerable.
    await tx.execute(sql`
      UPDATE student_enrollments
      SET status = 'transferred'
      WHERE id IN (
        SELECT from_enrollment_id FROM promotion_decisions
        WHERE run_id = ${run.id} AND decision <> 'graduate'
      )
    `);

    await tx.execute(sql`
      UPDATE student_enrollments
      SET status = 'graduated'
      WHERE id IN (
        SELECT from_enrollment_id FROM promotion_decisions
        WHERE run_id = ${run.id} AND decision = 'graduate'
      )
    `);

    await tx
      .update(promotionRuns)
      .set({
        status: 'applied',
        promotedCount: result.promoted,
        retainedCount: result.retained,
        graduatedCount: result.graduated,
        appliedByUid: actorUid,
        appliedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(promotionRuns.id, run.id));
  });

  /*
   * Sprint 20, item 9b. A graduating child leaves the school, and a family that
   * is down to one child here loses its sibling discount.
   *
   * **After the transaction, never inside it.** The promotion is all-or-nothing
   * by design — see this function's own docblock — and a discount that would
   * not close must not roll a whole class back into last year. The reconcile
   * swallows its own failures and the fifteen-minute sweep is the backstop.
   *
   * Only graduates. A promote or a retain writes a fresh `active` row in the
   * receiving year, so the family is exactly the size it was a moment ago and
   * there is nothing to reconsider.
   */
  const graduates = actionable
    .filter((entry) => entry.decision === 'graduate')
    .map((entry) => entry.studentProfileId);

  for (const studentProfileId of graduates) {
    await reconcileFamilyAfterDeparture({
      locationId: run.locationId,
      studentProfileId,
      actorUid,
    });
  }

  return result;
}

/**
 * Years a school could roll into: everything starting after the one being left.
 *
 * An academic year is stored as a start month and year rather than a date, so
 * "after" is compared on the pair. Ordering by year alone would put a June
 * start ahead of the previous September's in the same calendar year, which is
 * exactly the shape a Pakistani school year has.
 */
export async function listReceivingYears(
  locationId: string,
  fromAcademicYearId: string,
): Promise<Array<{ id: string; name: string }>> {
  const from = await db
    .select({ startYear: academicYears.startYear, startMonth: academicYears.startMonth })
    .from(academicYears)
    .where(
      and(eq(academicYears.locationId, locationId), eq(academicYears.id, fromAcademicYearId)),
    )
    .limit(1);

  const start = from[0];
  if (start === undefined) return [];

  return db
    .select({ id: academicYears.id, name: academicYears.name })
    .from(academicYears)
    .where(
      and(
        eq(academicYears.locationId, locationId),
        sql`(${academicYears.startYear}, ${academicYears.startMonth}) > (${start.startYear}, ${start.startMonth})`,
      ),
    )
    .orderBy(asc(academicYears.startYear), asc(academicYears.startMonth));
}
