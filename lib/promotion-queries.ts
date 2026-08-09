import 'server-only';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import {
  academicYears,
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

/**
 * Rolling a school over to the next academic year.
 *
 * ── The rule the whole module exists to keep ─────────────────────────────
 * **Promotion never edits an enrolment.** Applying a run writes *new*
 * `student_enrollments` rows for the receiving year and closes the old ones by
 * status. "Which section was she in two years ago" is a question schools are
 * asked constantly — for a transfer certificate, a character certificate, a
 * board form — and it is answerable only because the old row is still there
 * saying so.
 *
 * ── Draft, review, apply ────────────────────────────────────────────────
 * A run is built as a draft holding one decision per student, defaulted to
 * promote. Nothing is written to the enrolment table until it is applied, and
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
  fromSectionName: string;
}

/**
 * Everyone actively enrolled in a grade in the year being rolled out of.
 *
 * `alreadyRolled` is the guard against a second run for the same students by a
 * different route — a grade split across two runs, or a run rebuilt after
 * being deleted. The database would accept the duplicate enrolment only up to
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
}

/**
 * Carries out an applied run.
 *
 * ── What each decision writes ───────────────────────────────────────────
 *   promote  — old enrolment closed as `transferred`, new `active` row in the
 *              receiving year and chosen section.
 *   retain   — old enrolment closed as `transferred`, new `active` row in the
 *              receiving year, **same section**. A retained child is still in
 *              the new school year; they are just in the same class again, and
 *              leaving them on last year's enrolment would hide them from
 *              every roster the new year draws.
 *   graduate — old enrolment closed as `graduated`. No new row: there is
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

  // Students who already hold an enrolment in the receiving year. Writing a
  // second would violate the unique key; naming them is more use than the
  // constraint's error.
  const existing = await db
    .select({ studentProfileId: studentEnrollments.studentProfileId })
    .from(studentEnrollments)
    .where(
      and(
        eq(studentEnrollments.locationId, run.locationId),
        eq(studentEnrollments.academicYearId, run.toAcademicYearId),
        inArray(
          studentEnrollments.studentProfileId,
          decisions.map((decision) => decision.studentProfileId),
        ),
      ),
    );

  const alreadyRolled = new Set(existing.map((row) => row.studentProfileId));

  const refused: ApplyResult['refused'] = [];
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
    actionable.push(decision);
  }

  if (refused.length > 0) {
    // Nothing is written. A promotion the operator has to reconcile by hand
    // afterwards is worse than one they have to fix and re-run.
    return { promoted: 0, retained: 0, graduated: 0, refused };
  }

  const result: ApplyResult = { promoted: 0, retained: 0, graduated: 0, refused: [] };
  const enrollmentDate = new Date().toISOString().slice(0, 10);

  await db.transaction(async (tx) => {
    for (const decision of actionable) {
      if (decision.decision === 'graduate') {
        await tx
          .update(studentEnrollments)
          .set({ status: 'graduated' })
          .where(eq(studentEnrollments.id, decision.fromEnrollmentId));

        result.graduated += 1;
        continue;
      }

      const sectionId =
        decision.decision === 'retain'
          ? await currentSectionOf(tx, decision.fromEnrollmentId)
          : decision.toSectionId!;

      const inserted = await tx
        .insert(studentEnrollments)
        .values({
          locationId: run.locationId,
          studentProfileId: decision.studentProfileId,
          sectionId,
          academicYearId: run.toAcademicYearId,
          status: 'active',
          enrollmentDate,
        })
        .returning({ id: studentEnrollments.id });

      await tx
        .update(studentEnrollments)
        .set({ status: 'transferred' })
        .where(eq(studentEnrollments.id, decision.fromEnrollmentId));

      await tx
        .update(promotionDecisions)
        .set({ createdEnrollmentId: inserted[0]?.id ?? null, updatedAt: new Date() })
        .where(eq(promotionDecisions.id, decision.id));

      if (decision.decision === 'retain') result.retained += 1;
      else result.promoted += 1;
    }

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

  return result;
}

/**
 * The section a retained student stays in.
 *
 * Read from the enrolment rather than carried on the decision, because a
 * retain has no `to_section_id` by design — there is no choice being made, and
 * storing one would create a second place the answer could be wrong.
 */
async function currentSectionOf(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  enrollmentId: string,
): Promise<string> {
  const rows = await tx
    .select({ sectionId: studentEnrollments.sectionId })
    .from(studentEnrollments)
    .where(eq(studentEnrollments.id, enrollmentId))
    .limit(1);

  const sectionId = rows[0]?.sectionId;
  if (sectionId === undefined) {
    throw new Error(`Enrolment ${enrollmentId} vanished mid-promotion.`);
  }
  return sectionId;
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
