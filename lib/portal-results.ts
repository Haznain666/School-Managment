import 'server-only';

import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import { academicYears, examTerms, exams, studentEnrollments } from '@/db/schema';

import { db } from './drizzle';
import {
  getSectionReportCards,
  listStudentTermHistory,
  type ReportCard,
  type StudentTermHistoryRow,
} from './exam-queries';

/**
 * `lib/portal-results.ts` — a student's own results, for the two portals that
 * show them to the person they belong to.
 *
 * The admin side reaches results by section: a coordinator prints a class at a
 * time, and `getSectionReportCards()` computes the class in one pass because
 * position is a property of the class. A parent and a student reach them by
 * *child*, and the section is something to be looked up rather than chosen.
 * This module is that inversion, and it exists once so the parent portal and
 * the student portal cannot answer the same question differently.
 *
 * ── Only published terms, and that is the whole authorisation rule ───────
 * A term that is not published has no report card as far as a family is
 * concerned. Sprint 9 made publishing a deliberate, separately-permissioned act
 * precisely so that draft marks are not a thing a parent can see, and this
 * module never renders an unpublished term — where the admin print page
 * deliberately does, marked as a preview, for the person checking before they
 * publish.
 *
 * ── The section comes from the enrolment, per term ───────────────────────
 * A child who changed section mid-year has two enrolment rows, and their
 * Term 1 card belongs to the class they were in for Term 1. The lookup is
 * therefore against the term's academic year and not against "where are they
 * now" — the same reasoning that makes Sprint 11's delivery log the thing the
 * notice board reads.
 */

/** A term this student has a published card for, newest first. */
export interface StudentTermRow {
  termId: string;
  termName: string;
  academicYearId: string;
  academicYearName: string;
  /**
   * The term's own window, which is optional from Sprint 14 on — the
   * authoritative dates live on the schedules, and a term that never had a
   * school-typed envelope carries null here. Both portals show the term's name
   * and its year, so neither has to invent a date to render a chip.
   */
  startDate: string | null;
  endDate: string | null;
  sequenceOrder: number;
}

/**
 * Terms with a published report card for this student.
 *
 * "Has a card" means the student was enrolled in a section that sat at least
 * one exam in that term. A term the child was not at the school for is absent
 * rather than listed and empty — an empty card reads as a lost record.
 */
export async function listPublishedTermsForStudent(
  locationId: string,
  studentProfileId: string,
): Promise<StudentTermRow[]> {
  const enrolments = await db
    .select({
      sectionId: studentEnrollments.sectionId,
      academicYearId: studentEnrollments.academicYearId,
    })
    .from(studentEnrollments)
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.studentProfileId, studentProfileId),
      ),
    );

  if (enrolments.length === 0) return [];

  const sectionIds = [...new Set(enrolments.map((row) => row.sectionId))];

  const rows = await db
    .selectDistinct({
      termId: examTerms.id,
      termName: examTerms.name,
      academicYearId: examTerms.academicYearId,
      academicYearName: academicYears.name,
      startDate: examTerms.startDate,
      endDate: examTerms.endDate,
      sequenceOrder: examTerms.sequenceOrder,
    })
    .from(exams)
    .innerJoin(examTerms, eq(examTerms.id, exams.termId))
    .innerJoin(academicYears, eq(academicYears.id, examTerms.academicYearId))
    .where(
      and(
        eq(exams.locationId, locationId),
        eq(examTerms.isPublished, true),
        isNull(examTerms.archivedAt),
        inArray(exams.sectionId, sectionIds),
      ),
    )
    // Not by start date: it is optional from Sprint 14 on, and a list that put
    // every dateless term first would order a family's own history by which
    // fields their school happened to fill in.
    .orderBy(desc(academicYears.startYear), desc(examTerms.sequenceOrder));

  return rows;
}

/**
 * One student's card for one term, or null.
 *
 * Null covers every refusal with the same answer on purpose: the term does not
 * exist, belongs to another school, is not published, or the child was not in
 * it. A portal that distinguished those would be telling a family which terms
 * exist at a school they are not part of.
 */
export async function getStudentReportCard(
  locationId: string,
  termId: string,
  studentProfileId: string,
): Promise<ReportCard | null> {
  const term = await db
    .select({
      academicYearId: examTerms.academicYearId,
      isPublished: examTerms.isPublished,
    })
    .from(examTerms)
    .where(and(eq(examTerms.locationId, locationId), eq(examTerms.id, termId)))
    .limit(1);

  if (term[0] === undefined || !term[0].isPublished) return null;

  // The section they were in *for that year*, not the one they are in now.
  const enrolment = await db
    .select({ sectionId: studentEnrollments.sectionId })
    .from(studentEnrollments)
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.studentProfileId, studentProfileId),
        eq(studentEnrollments.academicYearId, term[0].academicYearId),
      ),
    )
    // A transfer leaves a closed row and an active one in the same year
    // (migration 0019). The active placement is the one whose class sat the
    // exams that count, so it wins.
    .orderBy(desc(studentEnrollments.status), asc(studentEnrollments.createdAt))
    .limit(1);

  if (enrolment[0] === undefined) return null;

  const cards = await getSectionReportCards(locationId, termId, enrolment[0].sectionId);

  return (
    cards.find((card) => card.student.studentProfileId === studentProfileId) ?? null
  );
}

/** One exam on a student's datesheet. */
export interface StudentExamRow {
  examId: string;
  title: string;
  examDate: string;
  termName: string;
  isPublished: boolean;
}

/**
 * The exams a student's own section is sitting, whether or not marks exist.
 *
 * `is_published` here is the *exam*'s publication — Sprint 9's datesheet
 * announcement — not the term's. An unannounced exam is withheld, because a
 * datesheet a school has not released is not a promise it has made.
 */
export async function listStudentExams(
  locationId: string,
  studentProfileId: string,
  academicYearId: string,
): Promise<StudentExamRow[]> {
  const enrolment = await db
    .select({ sectionId: studentEnrollments.sectionId })
    .from(studentEnrollments)
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.studentProfileId, studentProfileId),
        eq(studentEnrollments.academicYearId, academicYearId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .limit(1);

  if (enrolment[0] === undefined) return [];

  return db
    .select({
      examId: exams.id,
      title: exams.title,
      examDate: exams.examDate,
      termName: examTerms.name,
      isPublished: exams.isPublished,
    })
    .from(exams)
    .innerJoin(examTerms, eq(examTerms.id, exams.termId))
    .where(
      and(
        eq(exams.locationId, locationId),
        eq(exams.sectionId, enrolment[0].sectionId),
        eq(exams.isPublished, true),
      ),
    )
    .orderBy(asc(exams.examDate));
}

/**
 * A child's whole record: every term with a judgement, newest first.
 *
 * The history list the parent and student portals show above the current
 * card — the promotion status of each term, the overall row for it, and the
 * reason where somebody changed it.
 *
 * ── Published only, and that is the whole authorisation rule ─────────────
 * Same rule as `listPublishedTermsForStudent` above and for the same reason: a
 * promotion status is the most consequential line on a report card, and a
 * family learning it before the school has published the term would be the
 * school being told by its own software.
 */
export async function listStudentResultHistory(
  locationId: string,
  studentProfileId: string,
): Promise<StudentTermHistoryRow[]> {
  return listStudentTermHistory(locationId, studentProfileId, { publishedOnly: true });
}
