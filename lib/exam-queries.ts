import 'server-only';

import {
  and,
  asc,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';

import {
  academicYears,
  attendanceRecords,
  ATTEMPT_ORIGINAL,
  ATTEMPT_RESIT,
  DEFAULT_EXAM_SETTINGS,
  examResults,
  examScheduleGrades,
  examScheduleSubjects,
  examSchedules,
  examSubjects,
  examTerms,
  exams,
  gradeLabel,
  gradePromotionCriteria,
  gradingBands,
  gradingSchemes,
  grades,
  resultSubcategories,
  schoolExamSettings,
  schoolUsers,
  sections,
  staff,
  studentEnrollments,
  studentProfiles,
  studentTermResults,
  subjects,
  timetableEntries,
  type PromotionMechanism,
  type PromotionStatus,
  type ResitStatus,
  type ResultStatus,
} from '@/db/schema';

import { academicYearBounds } from './academics-queries';
import { db, type Database, type Tx } from './drizzle';
import {
  assignPositions,
  overallPercentage,
  percentageOf,
  resolveBand,
  resolveGrade,
  sortBands,
  toMark,
  type ResolvedBand,
} from './grading';
import {
  computeDescriptorPromotion,
  computeMarksPromotion,
  DEFAULT_CRITERIA,
  type CriteriaRow,
} from './promotion-criteria';

/**
 * Tenant-scoped reads for the Exams module.
 *
 * Same contract as `lib/academics-queries.ts`: `locationId` is the first
 * argument of every function, it comes from verified session claims, and it is
 * a separate parameter rather than part of a filters object so that an id out
 * of a request body can only ever narrow a read, never widen it.
 *
 * ── The policy decisions the aggregates encode ───────────────────────────
 * These are here, in one place, because three artefacts (report card,
 * tabulation sheet, position holders) have to agree about them:
 *
 *   1. An absent paper counts towards the marks *available* and contributes
 *      nothing to the marks *obtained*. A percentage that quietly shrank its
 *      own denominator would let a child skip their weakest paper and improve.
 *   2. A student absent from any paper takes **no position in class**. Schools
 *      award prizes by position and do not rank a child who did not sit
 *      everything against children who did.
 *   3. A published re-sit replaces the original in every aggregate; the
 *      original stays in the table and the sheets mark the cell as a re-sit.
 *      Nothing is capped at the pass mark — a school that wants that rule can
 *      say so later, and guessing it now would silently alter marks a teacher
 *      typed.
 *   4. The tabulation sheet shows unpublished marks, flagged. It is behind
 *      `exams.read`, which no parent or student holds, and its whole purpose
 *      is the review that happens *before* publication.
 *   5. A report card only ever reads published papers.
 */

// -----------------------------------------------------------------------------
// Grading schemes
// -----------------------------------------------------------------------------

export interface GradingBandRow extends ResolvedBand {
  id: string;
}

export interface GradingSchemeRow {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  bands: GradingBandRow[];
}

function toBandRow(row: {
  id: string;
  label: string;
  minPercentage: string;
  maxPercentage: string;
  gpa: string | null;
  remark: string | null;
}): GradingBandRow {
  return {
    id: row.id,
    label: row.label,
    minPercentage: toMark(row.minPercentage) ?? 0,
    maxPercentage: toMark(row.maxPercentage) ?? 0,
    gpa: toMark(row.gpa),
    remark: row.remark,
  };
}

export async function listGradingSchemes(
  locationId: string,
): Promise<GradingSchemeRow[]> {
  const schemes = await db
    .select({
      id: gradingSchemes.id,
      name: gradingSchemes.name,
      isDefault: gradingSchemes.isDefault,
      isActive: gradingSchemes.isActive,
    })
    .from(gradingSchemes)
    .where(eq(gradingSchemes.locationId, locationId))
    .orderBy(asc(gradingSchemes.name));

  if (schemes.length === 0) return [];

  const bands = await db
    .select({
      id: gradingBands.id,
      schemeId: gradingBands.schemeId,
      label: gradingBands.label,
      minPercentage: gradingBands.minPercentage,
      maxPercentage: gradingBands.maxPercentage,
      gpa: gradingBands.gpa,
      remark: gradingBands.remark,
    })
    .from(gradingBands)
    .where(
      and(
        eq(gradingBands.locationId, locationId),
        inArray(
          gradingBands.schemeId,
          schemes.map((scheme) => scheme.id),
        ),
      ),
    );

  return schemes.map((scheme) => ({
    ...scheme,
    bands: sortBands(bands.filter((band) => band.schemeId === scheme.id).map(toBandRow)),
  }));
}

export async function getGradingScheme(
  locationId: string,
  schemeId: string,
): Promise<GradingSchemeRow | null> {
  const schemes = await listGradingSchemes(locationId);
  return schemes.find((scheme) => scheme.id === schemeId) ?? null;
}

/**
 * The bands a term is graded against: its own scheme, else the school default.
 *
 * Returns an empty list when the school has configured nothing, and every
 * caller prints a dash rather than inventing a ladder. See `lib/grading.ts`.
 */
export async function bandsForTerm(
  locationId: string,
  termId: string,
): Promise<GradingBandRow[]> {
  const rows = await db
    .select({
      schemeId: examTerms.gradingSchemeId,
    })
    .from(examTerms)
    .where(and(eq(examTerms.locationId, locationId), eq(examTerms.id, termId)))
    .limit(1);

  const schemes = await listGradingSchemes(locationId);
  const named = rows[0]?.schemeId;

  const scheme =
    (named === null || named === undefined
      ? undefined
      : schemes.find((candidate) => candidate.id === named)) ??
    schemes.find((candidate) => candidate.isDefault && candidate.isActive);

  return scheme?.bands ?? [];
}

// -----------------------------------------------------------------------------
// Terms
// -----------------------------------------------------------------------------

export interface ExamTermRow {
  id: string;
  name: string;
  academicYearId: string;
  academicYearName: string;
  /** The optional envelope the school typed. Null = derived from schedules. */
  startDate: string | null;
  endDate: string | null;
  /**
   * The window everything actually uses: the term's own dates when it has
   * them, otherwise the earliest start and latest end across its schedules,
   * otherwise the academic year. Never null, so no caller has to invent one.
   */
  windowStart: string;
  windowEnd: string;
  sequenceOrder: number;
  gradingSchemeId: string | null;
  isPublished: boolean;
  isArchived: boolean;
  examCount: number;
  scheduleCount: number;
}

const TERM_SELECTION = {
  id: examTerms.id,
  name: examTerms.name,
  academicYearId: examTerms.academicYearId,
  academicYearName: academicYears.name,
  startDate: examTerms.startDate,
  endDate: examTerms.endDate,
  sequenceOrder: examTerms.sequenceOrder,
  gradingSchemeId: examTerms.gradingSchemeId,
  isPublished: examTerms.isPublished,
  archivedAt: examTerms.archivedAt,
  yearStartMonth: academicYears.startMonth,
  yearStartYear: academicYears.startYear,
  yearEndMonth: academicYears.endMonth,
  yearEndYear: academicYears.endYear,
  scheduleStart: sql<string | null>`min(${examSchedules.startDate})`,
  scheduleEnd: sql<string | null>`max(coalesce(${examSchedules.endDate}, ${examSchedules.startDate}))`,
  examCount: countDistinct(exams.id),
  scheduleCount: countDistinct(examSchedules.id),
} as const;

/**
 * A term row, with the window resolved once so nothing downstream has to.
 *
 * Sprint 14 made the term's own dates optional — the authoritative ones moved
 * to the schedules, where they can differ per grade. That leaves three possible
 * answers to "when is this term", and the attendance summary on a report card
 * needs exactly one of them. The order is: what the school typed, then what its
 * schedules say, then the academic year. The last is a floor rather than a
 * guess: a term with neither dates nor schedules has not been set up, and
 * counting a year's attendance for it is the least wrong thing available.
 */
function toTermRow(row: {
  id: string;
  name: string;
  academicYearId: string;
  academicYearName: string;
  startDate: string | null;
  endDate: string | null;
  sequenceOrder: number;
  gradingSchemeId: string | null;
  isPublished: boolean;
  archivedAt: Date | null;
  yearStartMonth: number;
  yearStartYear: number;
  yearEndMonth: number;
  yearEndYear: number;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  examCount: number;
  scheduleCount: number;
}): ExamTermRow {
  const bounds = academicYearBounds({
    startMonth: row.yearStartMonth,
    startYear: row.yearStartYear,
    endMonth: row.yearEndMonth,
    endYear: row.yearEndYear,
  });

  return {
    id: row.id,
    name: row.name,
    academicYearId: row.academicYearId,
    academicYearName: row.academicYearName,
    startDate: row.startDate,
    endDate: row.endDate,
    windowStart: row.startDate ?? row.scheduleStart ?? bounds.start,
    windowEnd: row.endDate ?? row.scheduleEnd ?? bounds.end,
    sequenceOrder: row.sequenceOrder,
    gradingSchemeId: row.gradingSchemeId,
    isPublished: row.isPublished,
    isArchived: row.archivedAt !== null,
    examCount: row.examCount,
    scheduleCount: row.scheduleCount,
  };
}

/**
 * The terms of a year, in the order the school reads them.
 *
 * `sequence_order` and not the start date, because the dates are optional now
 * and a list that reordered itself the moment somebody blanked one would be a
 * list nobody trusts. Archived terms are excluded unless asked for: archiving
 * is what "Delete" does, and a deleted term reappearing in a picker is the
 * whole reason schools distrust soft deletion.
 */
export async function listExamTerms(
  locationId: string,
  filters: {
    academicYearId?: string | undefined;
    includeArchived?: boolean | undefined;
  } = {},
): Promise<ExamTermRow[]> {
  const conditions: SQL[] = [eq(examTerms.locationId, locationId)];
  if (filters.academicYearId !== undefined && filters.academicYearId !== '') {
    conditions.push(eq(examTerms.academicYearId, filters.academicYearId));
  }
  if (filters.includeArchived !== true) {
    conditions.push(isNull(examTerms.archivedAt));
  }

  const rows = await db
    .select(TERM_SELECTION)
    .from(examTerms)
    .innerJoin(academicYears, eq(academicYears.id, examTerms.academicYearId))
    .leftJoin(exams, and(eq(exams.termId, examTerms.id), isNull(exams.archivedAt)))
    .leftJoin(
      examSchedules,
      and(eq(examSchedules.termId, examTerms.id), isNull(examSchedules.archivedAt)),
    )
    .where(and(...conditions))
    .groupBy(examTerms.id, academicYears.id)
    .orderBy(asc(examTerms.sequenceOrder), asc(examTerms.name));

  return rows.map(toTermRow);
}

export async function getExamTerm(
  locationId: string,
  termId: string,
): Promise<ExamTermRow | null> {
  const rows = await db
    .select(TERM_SELECTION)
    .from(examTerms)
    .innerJoin(academicYears, eq(academicYears.id, examTerms.academicYearId))
    .leftJoin(exams, and(eq(exams.termId, examTerms.id), isNull(exams.archivedAt)))
    .leftJoin(
      examSchedules,
      and(eq(examSchedules.termId, examTerms.id), isNull(examSchedules.archivedAt)),
    )
    .where(and(eq(examTerms.locationId, locationId), eq(examTerms.id, termId)))
    .groupBy(examTerms.id, academicYears.id)
    .limit(1);

  const row = rows[0];
  return row === undefined ? null : toTermRow(row);
}

// -----------------------------------------------------------------------------
// Exams and their papers
// -----------------------------------------------------------------------------

/**
 * ── Who honours `archived_at`, and who must not ──────────────────────────
 *
 * Sprint 14 gave `exams` and `exam_subjects` a soft delete, written by three
 * paths: archiving a term, archiving a datesheet, and dropping a class or a
 * subject from one. A soft delete nobody reads is not a delete at all — until
 * 2026-08-22 pressing Delete on a term left every one of its papers live *and
 * writable*, because the results route authorises through `teacherOwnsPaper`
 * and loads through `getExamPaper` and neither looked at the column. A teacher
 * could still save marks against a term the school had deleted.
 *
 * So every reader below that *lists a paper to work on, or authorises a write
 * to one* filters archived rows out: `listExams`, `getExamDetail`,
 * `listExamPapers`, `getExamPaper`, `getTabulation` (through the first two),
 * `listTeacherPapers`, `teacherOwnsPaper`, and `listStudentExams` in
 * `lib/portal-results.ts`.
 *
 * `getSectionReportCards` is the reader that thinks about it differently, and
 * its own docblock says how: an issued card must keep rendering exactly as it
 * was issued, so what it excludes is decided by what archiving *meant*, not by
 * the column being present.
 */
export interface ExamRow {
  id: string;
  termId: string;
  termName: string;
  termIsPublished: boolean;
  academicYearId: string;
  gradeId: string;
  gradeName: string;
  sectionId: string;
  sectionName: string;
  title: string;
  examDate: string;
  isPublished: boolean;
  paperCount: number;
}

const EXAM_COLUMNS = {
  id: exams.id,
  termId: exams.termId,
  termName: examTerms.name,
  termIsPublished: examTerms.isPublished,
  academicYearId: examTerms.academicYearId,
  gradeId: exams.gradeId,
  gradeName: grades.name,
  gradeDisplayName: grades.displayName,
  sectionId: exams.sectionId,
  sectionName: sections.name,
  title: exams.title,
  examDate: exams.examDate,
  isPublished: exams.isPublished,
} as const;

export async function listExams(
  locationId: string,
  filters: {
    termId?: string | undefined;
    sectionId?: string | undefined;
    gradeId?: string | undefined;
  } = {},
): Promise<ExamRow[]> {
  const conditions: SQL[] = [
    eq(exams.locationId, locationId),
    isNull(exams.archivedAt),
  ];
  if (filters.termId !== undefined && filters.termId !== '') {
    conditions.push(eq(exams.termId, filters.termId));
  }
  if (filters.sectionId !== undefined && filters.sectionId !== '') {
    conditions.push(eq(exams.sectionId, filters.sectionId));
  }
  if (filters.gradeId !== undefined && filters.gradeId !== '') {
    conditions.push(eq(exams.gradeId, filters.gradeId));
  }

  const rows = await db
    .select({
      ...EXAM_COLUMNS,
      paperCount: sql<number>`count(${examSubjects.id})`.mapWith(Number),
    })
    .from(exams)
    .innerJoin(examTerms, eq(examTerms.id, exams.termId))
    .innerJoin(grades, eq(grades.id, exams.gradeId))
    .innerJoin(sections, eq(sections.id, exams.sectionId))
    .leftJoin(
      examSubjects,
      and(eq(examSubjects.examId, exams.id), isNull(examSubjects.archivedAt)),
    )
    .where(and(...conditions))
    .groupBy(exams.id, examTerms.id, grades.id, sections.id)
    .orderBy(asc(exams.examDate), asc(exams.title));

  return rows.map(({ gradeDisplayName, ...row }) => ({
    ...row,
    gradeName: gradeLabel({ name: row.gradeName, displayName: gradeDisplayName }),
  }));
}

export interface ExamPaperRow {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  maxMarks: number;
  passingMarks: number;
  examDate: string | null;
  slot: string | null;
  orderIndex: number;
  resultsStatus: ResultStatus;
  resitStatus: ResitStatus;
  /** How many students have a mark for the original sitting. */
  enteredCount: number;
}

export interface ExamDetail extends ExamRow {
  instructions: string | null;
  papers: ExamPaperRow[];
}

export async function getExamDetail(
  locationId: string,
  examId: string,
): Promise<ExamDetail | null> {
  const rows = await db
    .select({ ...EXAM_COLUMNS, instructions: exams.instructions })
    .from(exams)
    .innerJoin(examTerms, eq(examTerms.id, exams.termId))
    .innerJoin(grades, eq(grades.id, exams.gradeId))
    .innerJoin(sections, eq(sections.id, exams.sectionId))
    .where(
      and(
        eq(exams.locationId, locationId),
        eq(exams.id, examId),
        isNull(exams.archivedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  const papers = await listExamPapers(locationId, examId);

  const { gradeDisplayName, ...rest } = row;

  return {
    ...rest,
    gradeName: gradeLabel({ name: row.gradeName, displayName: gradeDisplayName }),
    paperCount: papers.length,
    papers,
  };
}

export async function listExamPapers(
  locationId: string,
  examId: string,
): Promise<ExamPaperRow[]> {
  const rows = await db
    .select({
      id: examSubjects.id,
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectCode: subjects.code,
      maxMarks: examSubjects.maxMarks,
      passingMarks: examSubjects.passingMarks,
      examDate: examSubjects.examDate,
      slot: examSubjects.slot,
      orderIndex: examSubjects.orderIndex,
      resultsStatus: examSubjects.resultsStatus,
      resitStatus: examSubjects.resitStatus,
      enteredCount: sql<number>`count(${examResults.id}) filter (where ${examResults.attempt} = ${ATTEMPT_ORIGINAL})`.mapWith(
        Number,
      ),
    })
    .from(examSubjects)
    .innerJoin(subjects, eq(subjects.id, examSubjects.subjectId))
    .leftJoin(examResults, eq(examResults.examSubjectId, examSubjects.id))
    .where(
      and(
        eq(examSubjects.locationId, locationId),
        eq(examSubjects.examId, examId),
        isNull(examSubjects.archivedAt),
      ),
    )
    .groupBy(examSubjects.id, subjects.id)
    .orderBy(asc(examSubjects.orderIndex), asc(subjects.name));

  return rows.map((row) => ({
    ...row,
    maxMarks: toMark(row.maxMarks) ?? 0,
    passingMarks: toMark(row.passingMarks) ?? 0,
  }));
}

export interface ExamPaperContext extends ExamPaperRow {
  examId: string;
  examTitle: string;
  examDateLabel: string;
  termId: string;
  termName: string;
  sectionId: string;
  sectionLabel: string;
  academicYearId: string;
  /** Which class sits it — the key to the mechanism this paper is marked by. */
  gradeId: string;
}

/** One paper with everything the marks screen has to show above the list. */
export async function getExamPaper(
  locationId: string,
  examSubjectId: string,
): Promise<ExamPaperContext | null> {
  const rows = await db
    .select({
      id: examSubjects.id,
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectCode: subjects.code,
      maxMarks: examSubjects.maxMarks,
      passingMarks: examSubjects.passingMarks,
      examDate: examSubjects.examDate,
      slot: examSubjects.slot,
      orderIndex: examSubjects.orderIndex,
      resultsStatus: examSubjects.resultsStatus,
      resitStatus: examSubjects.resitStatus,
      examId: exams.id,
      examTitle: exams.title,
      examDateLabel: exams.examDate,
      termId: examTerms.id,
      termName: examTerms.name,
      academicYearId: examTerms.academicYearId,
      sectionId: sections.id,
      sectionName: sections.name,
      gradeId: grades.id,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
    })
    .from(examSubjects)
    .innerJoin(subjects, eq(subjects.id, examSubjects.subjectId))
    .innerJoin(exams, eq(exams.id, examSubjects.examId))
    .innerJoin(examTerms, eq(examTerms.id, exams.termId))
    .innerJoin(sections, eq(sections.id, exams.sectionId))
    .innerJoin(grades, eq(grades.id, exams.gradeId))
    .where(
      and(
        eq(examSubjects.locationId, locationId),
        eq(examSubjects.id, examSubjectId),
        // An archived paper is not loadable, and this is the query the marks
        // screen and the results route both go through. Without it, deleting a
        // term left every paper in it writable.
        isNull(examSubjects.archivedAt),
        isNull(exams.archivedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  const { gradeName, gradeDisplayName, sectionName, ...rest } = row;

  return {
    ...rest,
    maxMarks: toMark(row.maxMarks) ?? 0,
    passingMarks: toMark(row.passingMarks) ?? 0,
    enteredCount: 0,
    sectionLabel: `${gradeLabel({ name: gradeName, displayName: gradeDisplayName })} — ${sectionName}`,
  };
}

// -----------------------------------------------------------------------------
// The section roster, shared by marks entry, tabulation and admit cards
// -----------------------------------------------------------------------------

export interface RosterStudent {
  studentProfileId: string;
  enrollmentId: string;
  rollNumber: string | null;
  studentName: string;
  studentId: string;
  photoUrl: string | null;
}

/**
 * Actively enrolled students of one section in one year, in register order.
 *
 * Every exam screen starts here, so a student who joined mid-term appears on
 * the marks sheet the moment they are enrolled rather than when somebody
 * remembers to re-generate something.
 */
export async function listSectionRoster(
  locationId: string,
  sectionId: string,
  academicYearId: string,
): Promise<RosterStudent[]> {
  return db
    .select({
      studentProfileId: studentProfiles.id,
      enrollmentId: studentEnrollments.id,
      rollNumber: studentEnrollments.rollNumber,
      studentName: schoolUsers.name,
      studentId: studentProfiles.studentId,
      photoUrl: studentProfiles.photoUrl,
    })
    .from(studentEnrollments)
    .innerJoin(
      studentProfiles,
      eq(studentProfiles.id, studentEnrollments.studentProfileId),
    )
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.sectionId, sectionId),
        eq(studentEnrollments.academicYearId, academicYearId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .orderBy(asc(studentEnrollments.rollNumber), asc(schoolUsers.name));
}

// -----------------------------------------------------------------------------
// Marks entry
// -----------------------------------------------------------------------------

export interface MarksSheetStudent extends RosterStudent {
  /** The mark for the attempt being entered. Always null in descriptor mode. */
  marksObtained: number | null;
  isAbsent: boolean;
  remarks: string | null;
  /** Descriptor mode: the performance descriptor this child earned. */
  subcategoryId: string | null;
  /** The original sitting, shown for reference while entering a re-sit. */
  originalMarks: number | null;
  originalAbsent: boolean;
}

export interface MarksSheet {
  paper: ExamPaperContext;
  attempt: number;
  /**
   * Which sheet this is, resolved from the *grade's* criteria.
   *
   * The screen and the save route both read it from here rather than deciding
   * for themselves, because the two disagreeing means a teacher typing marks
   * into a class whose report card has no marks column.
   */
  mechanism: PromotionMechanism;
  /** The descriptors on offer. Empty in marks mode, where none are. */
  subcategories: ResultSubcategoryRow[];
  colorCodingEnabled: boolean;
  students: MarksSheetStudent[];
}

export async function getMarksSheet(
  locationId: string,
  examSubjectId: string,
  attempt: number,
): Promise<MarksSheet | null> {
  const paper = await getExamPaper(locationId, examSubjectId);
  if (paper === null) return null;

  const criteria = await resolveGradeCriteria(
    locationId,
    paper.academicYearId,
    paper.gradeId,
  );
  const isDescriptorMode = criteria.mechanism === 'descriptors';

  const [roster, results, subcategories, settings] = await Promise.all([
    listSectionRoster(locationId, paper.sectionId, paper.academicYearId),
    db
      .select({
        studentProfileId: examResults.studentProfileId,
        attempt: examResults.attempt,
        marksObtained: examResults.marksObtained,
        isAbsent: examResults.isAbsent,
        remarks: examResults.remarks,
        subcategoryId: examResults.subcategoryId,
      })
      .from(examResults)
      .where(
        and(
          eq(examResults.locationId, locationId),
          eq(examResults.examSubjectId, examSubjectId),
        ),
      ),
    isDescriptorMode
      ? listResultSubcategories(locationId)
      : Promise.resolve<ResultSubcategoryRow[]>([]),
    getExamSettings(locationId),
  ]);

  const forAttempt = new Map(
    results
      .filter((row) => row.attempt === attempt)
      .map((row) => [row.studentProfileId, row]),
  );
  const original = new Map(
    results
      .filter((row) => row.attempt === ATTEMPT_ORIGINAL)
      .map((row) => [row.studentProfileId, row]),
  );

  return {
    paper,
    attempt,
    mechanism: criteria.mechanism,
    subcategories,
    colorCodingEnabled: settings.colorCodingEnabled,
    students: roster.map((student) => {
      const mine = forAttempt.get(student.studentProfileId);
      const first = original.get(student.studentProfileId);

      return {
        ...student,
        // Not merely hidden on the screen: a grade moved to descriptors after
        // marks were entered would otherwise hand the old marks back to a
        // sheet that has no column for them and no way to clear them.
        marksObtained: isDescriptorMode ? null : toMark(mine?.marksObtained),
        isAbsent: mine?.isAbsent ?? false,
        remarks: mine?.remarks ?? null,
        subcategoryId: isDescriptorMode ? (mine?.subcategoryId ?? null) : null,
        originalMarks: isDescriptorMode ? null : toMark(first?.marksObtained),
        originalAbsent: first?.isAbsent ?? false,
      };
    }),
  };
}

// -----------------------------------------------------------------------------
// Which sitting counts
// -----------------------------------------------------------------------------

/** The columns every aggregate needs off a result row, whatever fetched it. */
export interface CountingResultRow {
  examSubjectId: string;
  studentProfileId: string;
  attempt: number;
}

/** The paper's identity and the only field that decides which sitting counts. */
export interface CountingPaper {
  id: string;
  resitStatus: ResitStatus;
}

/**
 * Given every result row for a set of papers, the row that *counts* for one
 * student on one paper.
 *
 * A published re-sit replaces the original. Anything else — no re-sit, or one
 * still being marked — falls back to the original sitting, so marks a teacher
 * is midway through typing never reach a report card or a chart.
 *
 * One implementation because three readers have to agree: the tabulation sheet,
 * the report card and the exam charts are three views of the same marks, and a
 * chart that counted a different attempt than the document printed beside it
 * would be a defect nobody could explain to a parent. Indexed rather than
 * scanned so the exams overview, which folds several exams at once, stays
 * linear in the number of marks.
 */
export function resultPicker<T extends CountingResultRow>(
  rows: readonly T[],
): (paper: CountingPaper, studentProfileId: string) => T | undefined {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    byKey.set(`${row.examSubjectId}:${row.studentProfileId}:${row.attempt}`, row);
  }

  const at = (paperId: string, studentProfileId: string, attempt: number): T | undefined =>
    byKey.get(`${paperId}:${studentProfileId}:${attempt}`);

  return (paper, studentProfileId) =>
    (paper.resitStatus === 'published'
      ? at(paper.id, studentProfileId, ATTEMPT_RESIT)
      : undefined) ?? at(paper.id, studentProfileId, ATTEMPT_ORIGINAL);
}

// -----------------------------------------------------------------------------
// Tabulation — the class-wide grid
// -----------------------------------------------------------------------------

export interface TabulationCell {
  examSubjectId: string;
  /** Null in descriptor mode. A descriptor paper is not out of anything. */
  marks: number | null;
  isAbsent: boolean;
  isResit: boolean;
  /** False when the paper's marks have not been published yet. */
  isPublished: boolean;
  /**
   * Below the pass mark, or carrying the grade's failing descriptor. The two
   * mechanisms answer the same question — is this subject a problem — which is
   * why it is one field rather than two.
   */
  isFail: boolean;
  /** Descriptor mode: what this subject earned. Null in marks mode. */
  subcategory: ReportCardSubcategory | null;
  /** The subject-wise comment, in both mechanisms. `exam_results.remarks`. */
  comment: string | null;
}

export interface TabulationRow {
  student: RosterStudent;
  cells: TabulationCell[];
  /** All three are zero in descriptor mode and must not be drawn there. */
  obtained: number;
  available: number;
  percentage: number;
  grade: string | null;
  gpa: number | null;
  absentCount: number;
  failedCount: number;
  /** Null when the student missed a paper — see the module docblock. */
  position: number | null;
}

export interface Tabulation {
  exam: ExamDetail;
  papers: ExamPaperRow[];
  rows: TabulationRow[];
  bands: GradingBandRow[];
  /** True when at least one paper is still unpublished. */
  hasUnpublished: boolean;
  /** Which grid to draw. Resolved from the grade's criteria. */
  mechanism: PromotionMechanism;
  /** Whether descriptors are painted. Read at render time, never stored. */
  colorCodingEnabled: boolean;
}

/**
 * The grid a principal reviews after an exam.
 *
 * Unpublished papers are included and flagged, because reviewing them is the
 * point of the sheet. Nothing here is reachable without `exams.read`.
 *
 * ── A descriptor class gets a descriptor grid ────────────────────────────
 * `generate` writes `max_marks = 1` on a descriptor paper because the column is
 * NOT NULL with a `> 0` CHECK, and it says in its own docblock that the value
 * is never to be read. This function read it: until 2026-08-22 a descriptor
 * class tabulated as 0 out of n on every child, which `assignPositions` then
 * turned into a class of joint firsts — a sheet a principal would have acted
 * on. So the mechanism is resolved here, and in descriptor mode there are no
 * marks, no totals, no percentage, no grade and no position on any row. What
 * is left is what a descriptor class actually has: the sub-category and the
 * comment each child earned per subject, side by side across the class.
 */
export async function getTabulation(
  locationId: string,
  examId: string,
): Promise<Tabulation | null> {
  const exam = await getExamDetail(locationId, examId);
  if (exam === null) return null;

  const paperIds = exam.papers.map((paper) => paper.id);

  const [roster, bands, criteria, subcategories, settings, results] = await Promise.all([
    listSectionRoster(locationId, exam.sectionId, exam.academicYearId),
    bandsForTerm(locationId, exam.termId),
    resolveGradeCriteria(locationId, exam.academicYearId, exam.gradeId),
    // Archived descriptors included: this sheet reports what was awarded, and
    // one retired since would otherwise empty the cell it was awarded in.
    listResultSubcategories(locationId, { includeArchived: true }),
    getExamSettings(locationId),
    paperIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            examSubjectId: examResults.examSubjectId,
            studentProfileId: examResults.studentProfileId,
            attempt: examResults.attempt,
            marksObtained: examResults.marksObtained,
            isAbsent: examResults.isAbsent,
            subcategoryId: examResults.subcategoryId,
            remarks: examResults.remarks,
          })
          .from(examResults)
          .where(
            and(
              eq(examResults.locationId, locationId),
              inArray(examResults.examSubjectId, paperIds),
            ),
          ),
  ]);

  const isDescriptors = criteria.mechanism === 'descriptors';
  const subcategoryById = new Map(
    subcategories.map((entry) => [entry.id, entry] as const),
  );

  const pick = resultPicker(results);

  const rows: TabulationRow[] = roster.map((student) => {
    const cells: TabulationCell[] = exam.papers.map((paper) => {
      const candidate = pick(paper, student.studentProfileId);
      const marks = isDescriptors ? null : toMark(candidate?.marksObtained);
      const descriptorId = candidate?.subcategoryId ?? null;

      return {
        examSubjectId: paper.id,
        marks,
        isAbsent: candidate?.isAbsent ?? false,
        isResit:
          !isDescriptors &&
          (candidate?.attempt ?? ATTEMPT_ORIGINAL) === ATTEMPT_RESIT,
        isPublished: paper.resultsStatus === 'published',
        isFail: isDescriptors
          ? descriptorId !== null && descriptorId === criteria.failingSubcategoryId
          : marks !== null && marks < paper.passingMarks,
        subcategory: isDescriptors
          ? descriptorId === null
            ? null
            : (subcategoryById.get(descriptorId) ?? null)
          : null,
        comment: candidate?.remarks ?? null,
      };
    });

    // An absent paper still counts towards what was available: a percentage
    // that shrank its own denominator would reward missing your weakest paper.
    // Both are zero in descriptor mode, where `max_marks` is the placeholder 1
    // that `generate` wrote and that nothing may read.
    const available = isDescriptors
      ? 0
      : exam.papers.reduce((sum, paper) => sum + paper.maxMarks, 0);
    const obtained = isDescriptors
      ? 0
      : cells.reduce((sum, cell) => sum + (cell.marks ?? 0), 0);

    return {
      student,
      cells,
      obtained,
      available,
      percentage: isDescriptors ? 0 : percentageOf(obtained, available),
      grade: null,
      gpa: null,
      absentCount: cells.filter((cell) => cell.isAbsent).length,
      failedCount: cells.filter((cell) => cell.isFail).length,
      position: null,
    };
  });

  if (!isDescriptors) {
    const positions = assignPositions(rows, (row) =>
      row.absentCount > 0 ? null : row.obtained,
    );

    for (const row of rows) {
      row.position = positions.get(row) ?? null;
      const band = resolveBand(row.percentage, bands);
      row.grade = band?.label ?? null;
      row.gpa = band?.gpa ?? null;
    }

    rows.sort((a, b) => b.obtained - a.obtained);
  }
  // A descriptor class keeps the roster's own order — by roll number — and
  // takes no positions at all. Ranking children whose results are words would
  // mean ordering the words, and no school has asked this product to decide
  // that "Exceeding" beats "Satisfactory" by one. Same rule as the report card.

  return {
    exam,
    papers: exam.papers,
    rows,
    bands,
    hasUnpublished: exam.papers.some((paper) => paper.resultsStatus !== 'published'),
    mechanism: criteria.mechanism,
    colorCodingEnabled: settings.colorCodingEnabled,
  };
}

// -----------------------------------------------------------------------------
// Report cards
// -----------------------------------------------------------------------------

/** A descriptor as a report card needs it: the label, and the colour to paint. */
export interface ReportCardSubcategory {
  id: string;
  label: string;
  colorHex: string | null;
}

export interface ReportCardSubject {
  subjectName: string;
  examTitle: string;
  /** Zero in descriptor mode. There is nothing for a descriptor to be out of. */
  maxMarks: number;
  passingMarks: number;
  marks: number | null;
  isAbsent: boolean;
  isResit: boolean;
  isFail: boolean;
  percentage: number | null;
  grade: string | null;
  /** Descriptor mode: the performance descriptor this subject earned. */
  subcategory: ReportCardSubcategory | null;
  /** The subject-wise comment, in both mechanisms. `exam_results.remarks`. */
  comment: string | null;
}

export interface ReportCardAttendance {
  present: number;
  absent: number;
  late: number;
  excused: number;
  holiday: number;
  percentage: number;
}

/**
 * The promotion decision printed on a card, when one has been computed.
 *
 * Null means nobody has run the term's results yet — which is not the same as
 * "not promoted", and the card says nothing rather than guessing. The override
 * reason is on the card deliberately: the product owner asked for the reason a
 * status was changed to be visible to every relevant party *including parents*,
 * and a report card is the document a parent actually keeps.
 */
export interface ReportCardPromotion {
  mechanism: PromotionMechanism;
  computedStatus: PromotionStatus;
  finalStatus: PromotionStatus;
  isOverridden: boolean;
  overrideReason: string | null;
  overriddenAt: string | null;
}

export interface ReportCard {
  student: RosterStudent;
  termName: string;
  termIsPublished: boolean;
  academicYearName: string;
  startDate: string;
  endDate: string;
  gradeName: string;
  sectionName: string;
  /** Which sheet this is. Frozen on the term result when one exists. */
  mechanism: PromotionMechanism;
  /** Whether descriptors are painted. Read at render time, never stored. */
  colorCodingEnabled: boolean;
  subjects: ReportCardSubject[];
  obtained: number;
  available: number;
  percentage: number;
  grade: string | null;
  gpa: number | null;
  remark: string | null;
  /** The mean of the subject percentages — what promotion is judged on. */
  meanPercentage: number | null;
  /** The mean as a letter, `U` on a fail. Null in descriptor mode. */
  overallGradeLabel: string | null;
  /** Descriptor mode: the class teacher's overall judgement. */
  overallSubcategory: ReportCardSubcategory | null;
  promotion: ReportCardPromotion | null;
  position: number | null;
  classSize: number;
  absentCount: number;
  failedCount: number;
  attendance: ReportCardAttendance;
}

/**
 * Every report card for one section in one term.
 *
 * The whole section is computed in one pass because position in class is a
 * property of the class, not of the child: producing one card in isolation
 * would mean either recomputing everyone anyway or printing a position that
 * came from somewhere else.
 *
 * Only published papers appear. An unpublished term is still renderable — the
 * print page marks it a preview — because the person checking a term before
 * publishing it needs to see exactly what a parent will get.
 *
 * ── Archived papers: excluded here, and that is a decision ───────────────
 * Every other reader excludes an archived row because it must not be *worked
 * on*. This one is the document a parent keeps, so the question is different:
 * a card must reprint as it was issued. It still excludes archived papers,
 * because of what the three archiving paths actually mean — a subject dropped
 * from the datesheet, a datesheet withdrawn, a term deleted. All three are the
 * school saying that paper is not part of this term's card. None of them is a
 * tidy-up whose side effect would be to blank a column.
 *
 * What archiving never touches is `student_term_results`: the mechanism, the
 * overall row and the promotion decision are frozen there at compute time, so
 * the judgement on an issued card survives its term being deleted even though
 * the subject rows do not. The two together are why this reader can afford to
 * be strict.
 *
 * ── Two sheets, decided per grade ────────────────────────────────────────
 * `marks_grades` fills the marks columns and leaves every descriptor null;
 * `descriptors` does the exact opposite and reports zero marks available, so
 * no percentage, no letter grade and no position appears anywhere on the card.
 * The mechanism comes from the frozen `student_term_results.mechanism` where
 * the term has been computed, and from the grade's current criteria where it
 * has not — so a card issued under descriptors keeps rendering as one after
 * the school switches the class to marks next year.
 */
export async function getSectionReportCards(
  locationId: string,
  termId: string,
  sectionId: string,
): Promise<ReportCard[]> {
  const term = await getExamTerm(locationId, termId);
  if (term === null) return [];

  const sectionRows = await db
    .select({
      sectionName: sections.name,
      academicYearId: sections.academicYearId,
      gradeId: sections.gradeId,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
    })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(and(eq(sections.locationId, locationId), eq(sections.id, sectionId)))
    .limit(1);

  const section = sectionRows[0];
  if (section === undefined) return [];

  const papers = await db
    .select({
      id: examSubjects.id,
      subjectName: subjects.name,
      examTitle: exams.title,
      maxMarks: examSubjects.maxMarks,
      passingMarks: examSubjects.passingMarks,
      orderIndex: examSubjects.orderIndex,
      resitStatus: examSubjects.resitStatus,
    })
    .from(examSubjects)
    .innerJoin(subjects, eq(subjects.id, examSubjects.subjectId))
    .innerJoin(exams, eq(exams.id, examSubjects.examId))
    .where(
      and(
        eq(examSubjects.locationId, locationId),
        eq(exams.termId, termId),
        eq(exams.sectionId, sectionId),
        isNull(examSubjects.archivedAt),
        // A report card only ever reads published papers.
        eq(examSubjects.resultsStatus, 'published'),
      ),
    )
    .orderBy(asc(exams.examDate), asc(examSubjects.orderIndex), asc(subjects.name));

  const [roster, bands, criteria, subcategories, settings, stored] = await Promise.all([
    listSectionRoster(locationId, sectionId, section.academicYearId),
    bandsForTerm(locationId, termId),
    resolveGradeCriteria(locationId, section.academicYearId, section.gradeId),
    listResultSubcategories(locationId, { includeArchived: true }),
    getExamSettings(locationId),
    listSectionTermResultRows(locationId, termId, sectionId),
  ]);

  const subcategoryById = new Map(
    subcategories.map((entry) => [entry.id, entry] as const),
  );
  const storedByStudent = new Map(
    stored.map((row) => [row.studentProfileId, row] as const),
  );

  const paperIds = papers.map((paper) => paper.id);

  const [results, attendance] = await Promise.all([
    paperIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            examSubjectId: examResults.examSubjectId,
            studentProfileId: examResults.studentProfileId,
            attempt: examResults.attempt,
            marksObtained: examResults.marksObtained,
            isAbsent: examResults.isAbsent,
            subcategoryId: examResults.subcategoryId,
            remarks: examResults.remarks,
          })
          .from(examResults)
          .where(
            and(
              eq(examResults.locationId, locationId),
              inArray(examResults.examSubjectId, paperIds),
            ),
          ),
    // The resolved window, not the term's own columns — those are optional
    // from Sprint 14 on, and a null here would count no attendance at all and
    // print 0% on every card in the class without saying why.
    getTermAttendance(locationId, sectionId, term.windowStart, term.windowEnd),
  ]);

  const pick = resultPicker(results);

  const cards: ReportCard[] = roster.map((student) => {
    const record = storedByStudent.get(student.studentProfileId);
    // Frozen where it exists, current where it does not. See the docblock.
    const mechanism: PromotionMechanism = record?.mechanism ?? criteria.mechanism;
    const isDescriptors = mechanism === 'descriptors';

    const subjectRows: ReportCardSubject[] = papers.map((paper) => {
      const candidate = pick(paper, student.studentProfileId);
      const comment = candidate?.remarks ?? null;
      const descriptorId = candidate?.subcategoryId ?? null;

      if (isDescriptors) {
        return {
          subjectName: paper.subjectName,
          examTitle: paper.examTitle,
          maxMarks: 0,
          passingMarks: 0,
          marks: null,
          isAbsent: candidate?.isAbsent ?? false,
          isResit: false,
          isFail:
            descriptorId !== null && descriptorId === criteria.failingSubcategoryId,
          percentage: null,
          grade: null,
          subcategory:
            descriptorId === null ? null : (subcategoryById.get(descriptorId) ?? null),
          comment,
        };
      }

      const maxMarks = toMark(paper.maxMarks) ?? 0;
      const passingMarks = toMark(paper.passingMarks) ?? 0;
      const marks = toMark(candidate?.marksObtained);
      const percentage = marks === null ? null : percentageOf(marks, maxMarks);

      return {
        subjectName: paper.subjectName,
        examTitle: paper.examTitle,
        maxMarks,
        passingMarks,
        marks,
        isAbsent: candidate?.isAbsent ?? false,
        isResit: (candidate?.attempt ?? ATTEMPT_ORIGINAL) === ATTEMPT_RESIT,
        isFail: marks !== null && marks < passingMarks,
        percentage,
        grade:
          percentage === null ? null : (resolveBand(percentage, bands)?.label ?? null),
        subcategory: null,
        comment,
      };
    });

    const available = subjectRows.reduce((sum, row) => sum + row.maxMarks, 0);
    const obtained = subjectRows.reduce((sum, row) => sum + (row.marks ?? 0), 0);
    const percentage = percentageOf(obtained, available);

    // The arithmetic mean of the subject percentages, which is what promotion
    // is judged on and is deliberately not the same number as `percentage`
    // above — see `overallPercentage` in lib/grading.ts.
    const mean = isDescriptors
      ? null
      : overallPercentage(
          subjectRows.flatMap((row) => (row.percentage === null ? [] : [row.percentage])),
        );

    /*
     * The band — and so the GPA and the printed remark — is resolved from the
     * MEAN, not from the ratio of totals.
     *
     * Both numbers are real and both stay on the card: `obtained / available`
     * is what the child scored, and the mean is what the school judges. But
     * only one of them may be turned into a letter, because a card carrying
     * "48.3% · C" in one box and "65.0% · B" in another is a card a parent
     * brings to the office. Until 2026-08-22 it resolved from `percentage`
     * while the history table and the promotion engine used the mean, and the
     * two diverge whenever papers carry different maxima — which is normal, not
     * exotic: Mathematics out of 100 beside Art out of 20.
     */
    const band = mean === null ? null : resolveBand(mean, bands);

    const overallDescriptorId = record?.overallSubcategoryId ?? null;

    return {
      student,
      termName: term.name,
      termIsPublished: term.isPublished,
      academicYearName: term.academicYearName,
      startDate: term.windowStart,
      endDate: term.windowEnd,
      gradeName: gradeLabel({
        name: section.gradeName,
        displayName: section.gradeDisplayName,
      }),
      sectionName: section.sectionName,
      mechanism,
      colorCodingEnabled: settings.colorCodingEnabled,
      subjects: subjectRows,
      obtained,
      available,
      percentage,
      grade: band?.label ?? null,
      gpa: band?.gpa ?? null,
      remark: band?.remark ?? null,
      meanPercentage: mean,
      overallGradeLabel:
        isDescriptors || mean === null ? null : resolveGrade(mean, bands).label,
      overallSubcategory:
        overallDescriptorId === null
          ? null
          : (subcategoryById.get(overallDescriptorId) ?? null),
      promotion:
        record === undefined
          ? null
          : {
              mechanism: record.mechanism,
              computedStatus: record.computedStatus,
              finalStatus: record.finalStatus,
              isOverridden: record.finalStatus !== record.computedStatus,
              overrideReason: record.overrideReason,
              overriddenAt: record.overriddenAt?.toISOString() ?? null,
            },
      position: null,
      classSize: roster.length,
      absentCount: subjectRows.filter((row) => row.isAbsent).length,
      failedCount: subjectRows.filter((row) => row.isFail).length,
      attendance:
        attendance.get(student.studentProfileId) ??
        { present: 0, absent: 0, late: 0, excused: 0, holiday: 0, percentage: 0 },
    };
  });

  // `available === 0` is every descriptor card, so a descriptor class takes no
  // positions at all. That is the intent, not a side effect: ranking children
  // whose results are words would mean ordering the words, and no school has
  // asked this product to decide that "Exceeding" beats "Satisfactory" by one.
  const positions = assignPositions(cards, (card) =>
    card.absentCount > 0 || card.available === 0 ? null : card.obtained,
  );

  for (const card of cards) {
    card.position = positions.get(card) ?? null;
  }

  return cards;
}

/**
 * Attendance for one section over a term, keyed by student.
 *
 * Aggregated in Postgres for the same reason the monthly report is: a class of
 * forty over a three-month term is several thousand rows, and counting them in
 * Node would make the report card slower every year the school stays.
 */
export async function getTermAttendance(
  locationId: string,
  sectionId: string,
  from: string,
  to: string,
): Promise<Map<string, ReportCardAttendance>> {
  const statusCount = (status: string): SQL<number> =>
    sql<number>`count(*) filter (where ${attendanceRecords.status} = ${status})`.mapWith(
      Number,
    );

  const rows = await db
    .select({
      studentProfileId: studentEnrollments.studentProfileId,
      present: statusCount('present'),
      absent: statusCount('absent'),
      late: statusCount('late'),
      excused: statusCount('excused'),
      holiday: statusCount('holiday'),
    })
    .from(studentEnrollments)
    .leftJoin(
      attendanceRecords,
      and(
        eq(attendanceRecords.locationId, locationId),
        eq(attendanceRecords.studentProfileId, studentEnrollments.studentProfileId),
        gte(attendanceRecords.date, from),
        lte(attendanceRecords.date, to),
      ),
    )
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.sectionId, sectionId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .groupBy(studentEnrollments.studentProfileId);

  const summary = new Map<string, ReportCardAttendance>();

  for (const row of rows) {
    // A holiday is a school closure, not an absence — reported, but kept out of
    // the denominator so it cannot drag a percentage down. Same rule as
    // `lib/academics-queries.ts`, deliberately identical.
    const marked = row.present + row.absent + row.late + row.excused;

    summary.set(row.studentProfileId, {
      present: row.present,
      absent: row.absent,
      late: row.late,
      excused: row.excused,
      holiday: row.holiday,
      percentage:
        marked === 0
          ? 0
          : Math.round(((row.present + row.late) / marked) * 1000) / 10,
    });
  }

  return summary;
}

// -----------------------------------------------------------------------------
// Admit cards
// -----------------------------------------------------------------------------

export interface AdmitCard {
  student: RosterStudent;
  exam: ExamDetail;
  papers: ExamPaperRow[];
}

/** One card per student on the roster, all reading the same datesheet. */
export async function getAdmitCards(
  locationId: string,
  examId: string,
): Promise<{ exam: ExamDetail; cards: AdmitCard[] } | null> {
  const exam = await getExamDetail(locationId, examId);
  if (exam === null) return null;

  const roster = await listSectionRoster(
    locationId,
    exam.sectionId,
    exam.academicYearId,
  );

  return {
    exam,
    cards: roster.map((student) => ({ student, exam, papers: exam.papers })),
  };
}

// -----------------------------------------------------------------------------
// The teacher's own papers
// -----------------------------------------------------------------------------

export interface TeacherPaperRow {
  examSubjectId: string;
  examId: string;
  examTitle: string;
  termName: string;
  subjectName: string;
  sectionLabel: string;
  examDate: string;
  resultsStatus: ResultStatus;
  resitStatus: ResitStatus;
}

/**
 * The papers a teacher may enter marks for.
 *
 * Derived from the timetable, exactly like `listTeacherSections`: a paper is
 * theirs when they are timetabled to teach that subject to that section in
 * that year. This is the authorisation list, not a convenience — the results
 * API repeats the same check on every read and write, so an id typed into a
 * request cannot reach another teacher's paper.
 */
export async function listTeacherPapers(
  locationId: string,
  teacherId: string,
  academicYearId: string,
): Promise<TeacherPaperRow[]> {
  const rows = await db
    .selectDistinct({
      examSubjectId: examSubjects.id,
      examId: exams.id,
      examTitle: exams.title,
      termName: examTerms.name,
      subjectName: subjects.name,
      sectionName: sections.name,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      examDate: exams.examDate,
      resultsStatus: examSubjects.resultsStatus,
      resitStatus: examSubjects.resitStatus,
    })
    .from(examSubjects)
    .innerJoin(exams, eq(exams.id, examSubjects.examId))
    .innerJoin(examTerms, eq(examTerms.id, exams.termId))
    .innerJoin(subjects, eq(subjects.id, examSubjects.subjectId))
    .innerJoin(sections, eq(sections.id, exams.sectionId))
    .innerJoin(grades, eq(grades.id, exams.gradeId))
    .innerJoin(
      timetableEntries,
      and(
        eq(timetableEntries.locationId, examSubjects.locationId),
        eq(timetableEntries.sectionId, exams.sectionId),
        eq(timetableEntries.subjectId, examSubjects.subjectId),
        eq(timetableEntries.teacherId, teacherId),
        eq(timetableEntries.academicYearId, academicYearId),
        eq(timetableEntries.isActive, true),
      ),
    )
    .where(
      and(
        eq(examSubjects.locationId, locationId),
        eq(examTerms.academicYearId, academicYearId),
        isNull(examSubjects.archivedAt),
        isNull(exams.archivedAt),
      ),
    )
    .orderBy(asc(exams.examDate), asc(subjects.name));

  return rows.map(({ gradeName, gradeDisplayName, sectionName, ...row }) => ({
    ...row,
    sectionLabel: `${gradeLabel({ name: gradeName, displayName: gradeDisplayName })} — ${sectionName}`,
  }));
}

/** True when this teacher is timetabled to teach the subject this paper is in. */
export async function teacherOwnsPaper(
  locationId: string,
  teacherId: string,
  examSubjectId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: examSubjects.id })
    .from(examSubjects)
    .innerJoin(exams, eq(exams.id, examSubjects.examId))
    .innerJoin(examTerms, eq(examTerms.id, exams.termId))
    .innerJoin(
      timetableEntries,
      and(
        eq(timetableEntries.locationId, examSubjects.locationId),
        eq(timetableEntries.sectionId, exams.sectionId),
        eq(timetableEntries.subjectId, examSubjects.subjectId),
        eq(timetableEntries.teacherId, teacherId),
        eq(timetableEntries.academicYearId, examTerms.academicYearId),
        eq(timetableEntries.isActive, true),
      ),
    )
    .where(
      and(
        eq(examSubjects.locationId, locationId),
        eq(examSubjects.id, examSubjectId),
        // This is an authorisation answer, so it is false for an archived
        // paper: nobody owns a paper the school has withdrawn.
        isNull(examSubjects.archivedAt),
        isNull(exams.archivedAt),
      ),
    )
    .limit(1);

  return rows[0] !== undefined;
}

// -----------------------------------------------------------------------------
// Sprint 14 — sub-categories, settings, criteria
// -----------------------------------------------------------------------------

export interface ResultSubcategoryRow {
  id: string;
  label: string;
  colorHex: string | null;
  sortOrder: number;
  isArchived: boolean;
}

/**
 * A school's performance descriptors, best first.
 *
 * `includeArchived` exists for exactly one caller shape: anything *rendering a
 * result that has already been issued*. An archived descriptor still has to
 * draw on the report card it was awarded on — hiding it would empty a column on
 * a document a parent is holding. Pickers take the default and offer only what
 * is current.
 */
export async function listResultSubcategories(
  locationId: string,
  options: { includeArchived?: boolean | undefined } = {},
): Promise<ResultSubcategoryRow[]> {
  const conditions: SQL[] = [eq(resultSubcategories.locationId, locationId)];
  if (options.includeArchived !== true) {
    conditions.push(isNull(resultSubcategories.archivedAt));
  }

  const rows = await db
    .select({
      id: resultSubcategories.id,
      label: resultSubcategories.label,
      colorHex: resultSubcategories.colorHex,
      sortOrder: resultSubcategories.sortOrder,
      archivedAt: resultSubcategories.archivedAt,
    })
    .from(resultSubcategories)
    .where(and(...conditions))
    .orderBy(asc(resultSubcategories.sortOrder), asc(resultSubcategories.label));

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    colorHex: row.colorHex,
    sortOrder: row.sortOrder,
    isArchived: row.archivedAt !== null,
  }));
}

/**
 * How many issued results a sub-category appears on.
 *
 * The number that goes in the sentence when a school tries to delete one. A
 * warning that says "this is in use" and nothing else is a warning nobody can
 * act on; "used on 412 subject results and 38 term results" is a decision.
 */
export async function subcategoryUsage(
  locationId: string,
  subcategoryId: string,
): Promise<{ subjectResults: number; termResults: number }> {
  const [subjectRows, termRows] = await Promise.all([
    db
      .select({ value: countDistinct(examResults.id) })
      .from(examResults)
      .where(
        and(
          eq(examResults.locationId, locationId),
          eq(examResults.subcategoryId, subcategoryId),
        ),
      ),
    db
      .select({ value: countDistinct(studentTermResults.id) })
      .from(studentTermResults)
      .where(
        and(
          eq(studentTermResults.locationId, locationId),
          eq(studentTermResults.overallSubcategoryId, subcategoryId),
        ),
      ),
  ]);

  return {
    subjectResults: subjectRows[0]?.value ?? 0,
    termResults: termRows[0]?.value ?? 0,
  };
}

export interface ExamSettings {
  colorCodingEnabled: boolean;
  teachersCanViewLegacyResults: boolean;
}

/**
 * The school's two exam-wide switches, defaulted.
 *
 * A missing row is the ordinary case — nothing creates one at provisioning —
 * so this never joins and never assumes. `DEFAULT_EXAM_SETTINGS` lives beside
 * the column defaults in the schema file so the two cannot drift.
 */
export async function getExamSettings(locationId: string): Promise<ExamSettings> {
  const rows = await db
    .select({
      colorCodingEnabled: schoolExamSettings.colorCodingEnabled,
      teachersCanViewLegacyResults: schoolExamSettings.teachersCanViewLegacyResults,
    })
    .from(schoolExamSettings)
    .where(eq(schoolExamSettings.locationId, locationId))
    .limit(1);

  return rows[0] ?? { ...DEFAULT_EXAM_SETTINGS };
}

/** A criteria row with its grade attached, for the criteria screen. */
export interface GradeCriteriaRow extends CriteriaRow {
  gradeId: string;
  gradeName: string;
  /** False when this grade has no row and is running on `DEFAULT_CRITERIA`. */
  isConfigured: boolean;
}

function toCriteriaRow(row: {
  mechanism: PromotionMechanism;
  gradingSchemeId: string | null;
  minOverallPercentage: string | null;
  maxFailedSubjects: number | null;
  failingSubcategoryId: string | null;
  maxFailingSubjects: number | null;
  minAttendancePercentage: string | null;
}): CriteriaRow {
  return {
    mechanism: row.mechanism,
    gradingSchemeId: row.gradingSchemeId,
    minOverallPercentage: toMark(row.minOverallPercentage),
    maxFailedSubjects: row.maxFailedSubjects,
    failingSubcategoryId: row.failingSubcategoryId,
    maxFailingSubjects: row.maxFailingSubjects,
    minAttendancePercentage: toMark(row.minAttendancePercentage),
  };
}

const CRITERIA_SELECTION = {
  mechanism: gradePromotionCriteria.mechanism,
  gradingSchemeId: gradePromotionCriteria.gradingSchemeId,
  minOverallPercentage: gradePromotionCriteria.minOverallPercentage,
  maxFailedSubjects: gradePromotionCriteria.maxFailedSubjects,
  failingSubcategoryId: gradePromotionCriteria.failingSubcategoryId,
  maxFailingSubjects: gradePromotionCriteria.maxFailingSubjects,
  minAttendancePercentage: gradePromotionCriteria.minAttendancePercentage,
} as const;

/**
 * How one grade is judged this year — its row, or the default.
 *
 * Never null. A grade with no row is not misconfigured: it falls back to
 * `DEFAULT_CRITERIA`, which is marks and grades with no thresholds, which is
 * exactly how the product behaved before this table existed.
 */
export async function resolveGradeCriteria(
  locationId: string,
  academicYearId: string,
  gradeId: string,
): Promise<CriteriaRow> {
  const rows = await db
    .select(CRITERIA_SELECTION)
    .from(gradePromotionCriteria)
    .where(
      and(
        eq(gradePromotionCriteria.locationId, locationId),
        eq(gradePromotionCriteria.academicYearId, academicYearId),
        eq(gradePromotionCriteria.gradeId, gradeId),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row === undefined ? { ...DEFAULT_CRITERIA } : toCriteriaRow(row);
}

/** Every grade of a year with the criteria it is judged by. Drives the screen. */
export async function listGradeCriteria(
  locationId: string,
  academicYearId: string,
): Promise<GradeCriteriaRow[]> {
  const rows = await db
    .select({
      gradeId: grades.id,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sortOrder: grades.sortOrder,
      criteriaId: gradePromotionCriteria.id,
      ...CRITERIA_SELECTION,
    })
    .from(grades)
    .leftJoin(
      gradePromotionCriteria,
      and(
        eq(gradePromotionCriteria.gradeId, grades.id),
        eq(gradePromotionCriteria.locationId, locationId),
        eq(gradePromotionCriteria.academicYearId, academicYearId),
      ),
    )
    .where(and(eq(grades.locationId, locationId), eq(grades.isActive, true)))
    .orderBy(asc(grades.sortOrder), asc(grades.name));

  return rows.map((row) => {
    const configured = row.criteriaId !== null && row.mechanism !== null;

    const criteria = configured
      ? toCriteriaRow({
          mechanism: row.mechanism as PromotionMechanism,
          gradingSchemeId: row.gradingSchemeId,
          minOverallPercentage: row.minOverallPercentage,
          maxFailedSubjects: row.maxFailedSubjects,
          failingSubcategoryId: row.failingSubcategoryId,
          maxFailingSubjects: row.maxFailingSubjects,
          minAttendancePercentage: row.minAttendancePercentage,
        })
      : { ...DEFAULT_CRITERIA };

    return {
      ...criteria,
      gradeId: row.gradeId,
      gradeName: gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
      isConfigured: configured,
    };
  });
}

/**
 * The bands a grade's results are lettered against.
 *
 * The criteria row names a scheme; where it does not, the school's default
 * applies — the same resolution `bandsForTerm` performs for a term, and
 * deliberately so. A grade and its term disagreeing about what 79% is called
 * would put two different letters on one child's paperwork.
 */
export async function bandsForCriteria(
  locationId: string,
  criteria: CriteriaRow,
): Promise<GradingBandRow[]> {
  const schemes = await listGradingSchemes(locationId);

  const scheme =
    (criteria.gradingSchemeId === null
      ? undefined
      : schemes.find((candidate) => candidate.id === criteria.gradingSchemeId)) ??
    schemes.find((candidate) => candidate.isDefault && candidate.isActive);

  return scheme?.bands ?? [];
}

// -----------------------------------------------------------------------------
// Sprint 14 — schedules
// -----------------------------------------------------------------------------

export interface ExamScheduleSubjectRow {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  examDate: string;
  startTime: string | null;
  durationMinutes: number | null;
  maxMarks: number | null;
  passingMarks: number | null;
  orderIndex: number;
}

export interface ExamScheduleRow {
  id: string;
  termId: string;
  name: string;
  startDate: string;
  endDate: string | null;
  gradeIds: string[];
  gradeNames: string[];
  subjects: ExamScheduleSubjectRow[];
  /** Papers already generated from this schedule, across every section. */
  generatedPaperCount: number;
}

/**
 * A term's datesheets, with their grades and their papers.
 *
 * Three queries and a join in Node rather than one query with two left joins:
 * a schedule with four grades and eight subjects would come back as
 * thirty-two rows, and every consumer would have to de-duplicate it. The
 * counts here are small enough that the round trips are cheaper than the
 * cartesian product.
 */
export async function listExamSchedules(
  locationId: string,
  termId: string,
): Promise<ExamScheduleRow[]> {
  const scheduleRows = await db
    .select({
      id: examSchedules.id,
      termId: examSchedules.termId,
      name: examSchedules.name,
      startDate: examSchedules.startDate,
      endDate: examSchedules.endDate,
    })
    .from(examSchedules)
    .where(
      and(
        eq(examSchedules.locationId, locationId),
        eq(examSchedules.termId, termId),
        isNull(examSchedules.archivedAt),
      ),
    )
    .orderBy(asc(examSchedules.startDate), asc(examSchedules.name));

  if (scheduleRows.length === 0) return [];

  const scheduleIds = scheduleRows.map((row) => row.id);

  const [gradeRows, subjectRows, paperRows] = await Promise.all([
    db
      .select({
        scheduleId: examScheduleGrades.scheduleId,
        gradeId: grades.id,
        gradeName: grades.name,
        gradeDisplayName: grades.displayName,
        sortOrder: grades.sortOrder,
      })
      .from(examScheduleGrades)
      .innerJoin(grades, eq(grades.id, examScheduleGrades.gradeId))
      .where(
        and(
          eq(examScheduleGrades.locationId, locationId),
          inArray(examScheduleGrades.scheduleId, scheduleIds),
          isNull(examScheduleGrades.archivedAt),
        ),
      )
      .orderBy(asc(grades.sortOrder)),
    db
      .select({
        id: examScheduleSubjects.id,
        scheduleId: examScheduleSubjects.scheduleId,
        subjectId: subjects.id,
        subjectName: subjects.name,
        subjectCode: subjects.code,
        examDate: examScheduleSubjects.examDate,
        startTime: examScheduleSubjects.startTime,
        durationMinutes: examScheduleSubjects.durationMinutes,
        maxMarks: examScheduleSubjects.maxMarks,
        passingMarks: examScheduleSubjects.passingMarks,
        orderIndex: examScheduleSubjects.orderIndex,
      })
      .from(examScheduleSubjects)
      .innerJoin(subjects, eq(subjects.id, examScheduleSubjects.subjectId))
      .where(
        and(
          eq(examScheduleSubjects.locationId, locationId),
          inArray(examScheduleSubjects.scheduleId, scheduleIds),
          isNull(examScheduleSubjects.archivedAt),
        ),
      )
      .orderBy(
        asc(examScheduleSubjects.examDate),
        asc(examScheduleSubjects.orderIndex),
        asc(subjects.name),
      ),
    db
      .select({
        scheduleId: exams.scheduleId,
        papers: countDistinct(examSubjects.id),
      })
      .from(exams)
      .innerJoin(examSubjects, eq(examSubjects.examId, exams.id))
      .where(
        and(
          eq(exams.locationId, locationId),
          inArray(exams.scheduleId, scheduleIds),
          isNull(examSubjects.archivedAt),
        ),
      )
      .groupBy(exams.scheduleId),
  ]);

  const papersBySchedule = new Map(
    paperRows.flatMap((row) =>
      row.scheduleId === null ? [] : [[row.scheduleId, row.papers] as const],
    ),
  );

  return scheduleRows.map((schedule) => {
    const mine = gradeRows.filter((row) => row.scheduleId === schedule.id);

    return {
      ...schedule,
      gradeIds: mine.map((row) => row.gradeId),
      gradeNames: mine.map((row) =>
        gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
      ),
      subjects: subjectRows
        .filter((row) => row.scheduleId === schedule.id)
        .map((row) => ({
          id: row.id,
          subjectId: row.subjectId,
          subjectName: row.subjectName,
          subjectCode: row.subjectCode,
          examDate: row.examDate,
          startTime: row.startTime,
          durationMinutes: row.durationMinutes,
          maxMarks: toMark(row.maxMarks),
          passingMarks: toMark(row.passingMarks),
          orderIndex: row.orderIndex,
        })),
      generatedPaperCount: papersBySchedule.get(schedule.id) ?? 0,
    };
  });
}

/** One schedule, resolved the same way as the list. Null when archived or foreign. */
export async function getExamSchedule(
  locationId: string,
  scheduleId: string,
): Promise<ExamScheduleRow | null> {
  const rows = await db
    .select({ termId: examSchedules.termId })
    .from(examSchedules)
    .where(
      and(
        eq(examSchedules.locationId, locationId),
        eq(examSchedules.id, scheduleId),
        isNull(examSchedules.archivedAt),
      ),
    )
    .limit(1);

  const term = rows[0];
  if (term === undefined) return null;

  const schedules = await listExamSchedules(locationId, term.termId);
  return schedules.find((schedule) => schedule.id === scheduleId) ?? null;
}

/**
 * Which grades are already spoken for in a term, and by which schedule.
 *
 * The route calls this before saving so the clerk gets "Class 4 already sits
 * the Junior schedule" instead of a unique-constraint violation rendered as a
 * 500. `exceptScheduleId` is the schedule being edited — its own grades are not
 * a conflict with itself.
 */
export async function gradesTakenInTerm(
  locationId: string,
  termId: string,
  exceptScheduleId?: string,
): Promise<Map<string, { scheduleId: string; scheduleName: string }>> {
  const conditions: SQL[] = [
    eq(examScheduleGrades.locationId, locationId),
    eq(examScheduleGrades.termId, termId),
    isNull(examScheduleGrades.archivedAt),
  ];
  if (exceptScheduleId !== undefined) {
    conditions.push(ne(examScheduleGrades.scheduleId, exceptScheduleId));
  }

  const rows = await db
    .select({
      gradeId: examScheduleGrades.gradeId,
      scheduleId: examSchedules.id,
      scheduleName: examSchedules.name,
    })
    .from(examScheduleGrades)
    .innerJoin(examSchedules, eq(examSchedules.id, examScheduleGrades.scheduleId))
    .where(and(...conditions, isNull(examSchedules.archivedAt)));

  return new Map(
    rows.map((row) => [
      row.gradeId,
      { scheduleId: row.scheduleId, scheduleName: row.scheduleName },
    ]),
  );
}

// -----------------------------------------------------------------------------
// Sprint 14 — class teachers
// -----------------------------------------------------------------------------

/** A section this member of staff is the class teacher of. */
export interface ClassTeacherSection {
  sectionId: string;
  sectionName: string;
  gradeId: string;
  gradeName: string;
  academicYearId: string;
  academicYearName: string;
}

/**
 * Whether this member of staff owns that class.
 *
 * The authority behind every promotion override a teacher may make. It is a
 * per-section question and not a role question, which is why
 * `results.promotion` is deliberately not granted to `teacher`: a role key
 * would hand every teacher in the school every class in it.
 */
export async function isClassTeacherOfSection(
  locationId: string,
  staffId: string,
  sectionId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: sections.id })
    .from(sections)
    .where(
      and(
        eq(sections.locationId, locationId),
        eq(sections.id, sectionId),
        eq(sections.classTeacherId, staffId),
      ),
    )
    .limit(1);

  return rows[0] !== undefined;
}

/** Every class this member of staff is the class teacher of, newest year first. */
export async function listClassTeacherSections(
  locationId: string,
  staffId: string,
): Promise<ClassTeacherSection[]> {
  return db
    .select({
      sectionId: sections.id,
      sectionName: sections.name,
      gradeId: grades.id,
      gradeName: sql<string>`coalesce(${grades.displayName}, ${grades.name})`,
      academicYearId: academicYears.id,
      academicYearName: academicYears.name,
    })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(academicYears, eq(academicYears.id, sections.academicYearId))
    .where(
      and(
        eq(sections.locationId, locationId),
        eq(sections.classTeacherId, staffId),
        eq(sections.isActive, true),
      ),
    )
    .orderBy(
      desc(academicYears.startYear),
      asc(grades.sortOrder),
      asc(sections.name),
    );
}

/**
 * Every active class in a year, for whoever holds `results.promotion`.
 *
 * The admin counterpart to `listClassTeacherSections`, and the reason it exists
 * is that promotion authority has two independent sources. A teacher's comes
 * from `sections.class_teacher_id` and reaches exactly their own classes; a
 * head's comes from the permission key and reaches all of them. Until this
 * function existed the *only* screen that could create a `student_term_results`
 * row was the class teacher's, so a school that had not named any class
 * teachers could not produce a promotion status at all — the sprint's headline
 * feature, unreachable for the three roles the key was created for.
 *
 * `branchId` narrows to one campus for a branch admin, and is null for a school
 * admin or a principal who runs the whole school.
 */
export async function listAllSectionsForYear(
  locationId: string,
  academicYearId: string,
  branchId: string | null,
): Promise<ClassTeacherSection[]> {
  const conditions: SQL[] = [
    eq(sections.locationId, locationId),
    eq(sections.academicYearId, academicYearId),
    eq(sections.isActive, true),
  ];
  if (branchId !== null) conditions.push(eq(grades.branchId, branchId));

  return db
    .select({
      sectionId: sections.id,
      sectionName: sections.name,
      gradeId: grades.id,
      gradeName: sql<string>`coalesce(${grades.displayName}, ${grades.name})`,
      academicYearId: academicYears.id,
      academicYearName: academicYears.name,
    })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(academicYears, eq(academicYears.id, sections.academicYearId))
    .where(and(...conditions))
    .orderBy(asc(grades.sortOrder), asc(sections.name));
}

/** Staff who may be offered in a section's class-teacher picker. */
export async function listClassTeacherCandidates(
  locationId: string,
  branchId: string | null,
): Promise<Array<{ id: string; name: string; designation: string | null }>> {
  const conditions: SQL[] = [
    eq(staff.locationId, locationId),
    eq(staff.isClassTeacher, true),
    eq(staff.status, 'active'),
  ];
  if (branchId !== null) conditions.push(eq(staff.branchId, branchId));

  return db
    .select({
      id: staff.id,
      name: sql<string>`${staff.firstName} || ' ' || ${staff.lastName}`,
      designation: staff.designation,
    })
    .from(staff)
    .where(and(...conditions))
    .orderBy(asc(staff.firstName), asc(staff.lastName));
}

// -----------------------------------------------------------------------------
// Sprint 14 — the term result
// -----------------------------------------------------------------------------

interface StoredTermResultRow {
  studentProfileId: string;
  mechanism: PromotionMechanism;
  overallPercentage: string | null;
  overallGradeLabel: string | null;
  overallSubcategoryId: string | null;
  computedStatus: PromotionStatus;
  finalStatus: PromotionStatus;
  overrideReason: string | null;
  overriddenAt: Date | null;
}

/** The stored judgements for one class in one term. Used by the card and the sheet. */
export async function listSectionTermResultRows(
  locationId: string,
  termId: string,
  sectionId: string,
): Promise<StoredTermResultRow[]> {
  return db
    .select({
      studentProfileId: studentTermResults.studentProfileId,
      mechanism: studentTermResults.mechanism,
      overallPercentage: studentTermResults.overallPercentage,
      overallGradeLabel: studentTermResults.overallGradeLabel,
      overallSubcategoryId: studentTermResults.overallSubcategoryId,
      computedStatus: studentTermResults.computedStatus,
      finalStatus: studentTermResults.finalStatus,
      overrideReason: studentTermResults.overrideReason,
      overriddenAt: studentTermResults.overriddenAt,
    })
    .from(studentTermResults)
    .where(
      and(
        eq(studentTermResults.locationId, locationId),
        eq(studentTermResults.termId, termId),
        eq(studentTermResults.sectionId, sectionId),
      ),
    );
}

/** One student's line on the class teacher's promotion screen. */
export interface SectionTermStudent {
  student: RosterStudent;
  subjects: ReportCardSubject[];
  meanPercentage: number | null;
  overallGradeLabel: string | null;
  overallSubcategoryId: string | null;
  attendancePercentage: number | null;
  failedSubjectCount: number;
  /** The rules' answer, recomputed on every read so it is never stale. */
  computedStatus: PromotionStatus;
  /**
   * The answer as it stands on the row — what the override endpoint judges against.
   *
   * Normally identical to `computedStatus`. They part company when marks or
   * criteria change after the last recompute, and that gap was a trap: the
   * sheet compared the teacher's draft against the *live* value and hid the
   * reason box when they matched, while the route compared against the *stored*
   * one and returned 422. The teacher was told no reason was needed and then
   * refused for not giving one, with no field on screen to type it into.
   *
   * So the form gates the reason box on this, and shows `computedStatus` and
   * its `reasons` as the current guidance. Null before the first recompute.
   */
  storedComputedStatus: PromotionStatus | null;
  reasons: string[];
  /** The school's answer. Equal to `computedStatus` until somebody overrides. */
  finalStatus: PromotionStatus;
  overrideReason: string | null;
  overriddenAt: string | null;
  isOverridden: boolean;
  /** False until the term has been computed for this child at least once. */
  hasRecord: boolean;
}

export interface SectionTermResults {
  term: ExamTermRow;
  sectionId: string;
  sectionName: string;
  gradeId: string;
  gradeName: string;
  academicYearId: string;
  classTeacherId: string | null;
  mechanism: PromotionMechanism;
  criteria: CriteriaRow;
  /** Active descriptors, for the overall picker. Best first. */
  subcategories: ResultSubcategoryRow[];
  colorCodingEnabled: boolean;
  students: SectionTermStudent[];
}

/**
 * Attendance as a promotion input, which is not the same as attendance as a
 * statistic.
 *
 * A child whose class never had its register taken has no attendance
 * percentage, and `getTermAttendance` reports that as 0% because zero present
 * out of zero days is what the arithmetic says. Failing a promotion on it would
 * be failing a child for the school's own omission, so an empty register
 * becomes null and the rule is simply not applied.
 */
function attendanceForPromotion(attendance: ReportCardAttendance): number | null {
  const marked =
    attendance.present + attendance.absent + attendance.late + attendance.excused;
  return marked === 0 ? null : attendance.percentage;
}

/**
 * One class's term, judged.
 *
 * Built on top of `getSectionReportCards` on purpose: the promotion screen and
 * the report card must not be able to disagree about how many subjects a child
 * failed. There is one computation of a term's results in this codebase and
 * this is the layer that decides what it *means*.
 *
 * `computedStatus` is recomputed here on every read rather than being taken
 * from the stored row. A school that lowers the pass bar in March must see the
 * effect of it before pressing recompute, not after — and the stored row is
 * still what the report card prints, so nothing changes underneath a parent
 * until somebody deliberately recomputes.
 */
export async function getSectionTermResults(
  locationId: string,
  termId: string,
  sectionId: string,
): Promise<SectionTermResults | null> {
  const term = await getExamTerm(locationId, termId);
  if (term === null) return null;

  const sectionRows = await db
    .select({
      sectionName: sections.name,
      academicYearId: sections.academicYearId,
      gradeId: sections.gradeId,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      classTeacherId: sections.classTeacherId,
    })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(and(eq(sections.locationId, locationId), eq(sections.id, sectionId)))
    .limit(1);

  const section = sectionRows[0];
  if (section === undefined) return null;

  const [cards, criteria, subcategories, settings, stored] = await Promise.all([
    getSectionReportCards(locationId, termId, sectionId),
    resolveGradeCriteria(locationId, section.academicYearId, section.gradeId),
    listResultSubcategories(locationId),
    getExamSettings(locationId),
    listSectionTermResultRows(locationId, termId, sectionId),
  ]);

  const storedByStudent = new Map(
    stored.map((row) => [row.studentProfileId, row] as const),
  );

  const students: SectionTermStudent[] = cards.map((card) => {
    const record = storedByStudent.get(card.student.studentProfileId);
    const attendancePercentage = attendanceForPromotion(card.attendance);

    const outcome =
      criteria.mechanism === 'descriptors'
        ? computeDescriptorPromotion({
            failingSubjectCount: card.subjects.filter((row) => row.isFail).length,
            attendancePercentage,
            criteria,
          })
        : computeMarksPromotion({
            overallPercentage: card.meanPercentage,
            failedSubjectCount: card.failedCount,
            attendancePercentage,
            criteria,
          });

    return {
      student: card.student,
      subjects: card.subjects,
      meanPercentage: card.meanPercentage,
      overallGradeLabel: card.overallGradeLabel,
      overallSubcategoryId: record?.overallSubcategoryId ?? null,
      attendancePercentage,
      failedSubjectCount: card.failedCount,
      computedStatus: outcome.status,
      storedComputedStatus: record?.computedStatus ?? null,
      reasons: outcome.reasons,
      finalStatus: record?.finalStatus ?? outcome.status,
      overrideReason: record?.overrideReason ?? null,
      overriddenAt: record?.overriddenAt?.toISOString() ?? null,
      isOverridden: record !== undefined && record.finalStatus !== record.computedStatus,
      hasRecord: record !== undefined,
    };
  });

  return {
    term,
    sectionId,
    sectionName: section.sectionName,
    gradeId: section.gradeId,
    gradeName: gradeLabel({
      name: section.gradeName,
      displayName: section.gradeDisplayName,
    }),
    academicYearId: section.academicYearId,
    classTeacherId: section.classTeacherId,
    mechanism: criteria.mechanism,
    criteria,
    subcategories,
    colorCodingEnabled: settings.colorCodingEnabled,
    students,
  };
}

/**
 * Recomputes a class's term and writes it down.
 *
 * ── An existing override survives ────────────────────────────────────────
 * If a row already carries a `final_status` that differs from what the rules
 * said, it keeps it — together with the reason, who set it and when. That is
 * the whole point of an override: a head who decided in March that a child
 * moves up must not have that reversed by a clerk pressing "recompute" in
 * April, silently, on a class of forty.
 *
 * The one case where an override is dropped is when the recomputation now
 * *agrees* with it. The status is then no longer a departure from the rules,
 * and the CHECK constraint refuses a reason on a row that matches — correctly,
 * because a reason explaining a decision the rules now make on their own is a
 * comment on a parent's portal about nothing.
 *
 * Everything is written in one transaction, statements built on `tx`. A
 * half-recomputed class is a class where some children were judged by the old
 * criteria and some by the new, and nothing on any screen would say so.
 */
export async function computeSectionTermResults(
  locationId: string,
  termId: string,
  sectionId: string,
  runner: Database | Tx = db,
): Promise<{ written: number; overridesKept: number; mechanism: PromotionMechanism }> {
  const sheet = await getSectionTermResults(locationId, termId, sectionId);
  if (sheet === null) return { written: 0, overridesKept: 0, mechanism: 'marks_grades' };

  const stored = await listSectionTermResultRows(locationId, termId, sectionId);
  const storedByStudent = new Map(
    stored.map((row) => [row.studentProfileId, row] as const),
  );

  let overridesKept = 0;

  const values = sheet.students.map((entry) => {
    const record = storedByStudent.get(entry.student.studentProfileId);

    const hadOverride =
      record !== undefined && record.finalStatus !== record.computedStatus;
    // Kept only while it is still a departure from what the rules say.
    const keepOverride = hadOverride && record.finalStatus !== entry.computedStatus;
    if (keepOverride) overridesKept += 1;

    return {
      locationId,
      termId,
      studentProfileId: entry.student.studentProfileId,
      sectionId,
      gradeId: sheet.gradeId,
      academicYearId: sheet.academicYearId,
      mechanism: sheet.mechanism,
      overallPercentage:
        entry.meanPercentage === null ? null : entry.meanPercentage.toFixed(2),
      overallGradeLabel: entry.overallGradeLabel,
      overallSubcategoryId: entry.overallSubcategoryId,
      computedStatus: entry.computedStatus,
      finalStatus: keepOverride ? record.finalStatus : entry.computedStatus,
      overrideReason: keepOverride ? record.overrideReason : null,
      computedAt: new Date(),
      updatedAt: new Date(),
    };
  });

  if (values.length === 0) {
    return { written: 0, overridesKept: 0, mechanism: sheet.mechanism };
  }

  await runner
    .insert(studentTermResults)
    .values(values)
    .onConflictDoUpdate({
      target: [
        studentTermResults.locationId,
        studentTermResults.termId,
        studentTermResults.studentProfileId,
      ],
      set: {
        sectionId: sql`excluded.section_id`,
        gradeId: sql`excluded.grade_id`,
        academicYearId: sql`excluded.academic_year_id`,
        mechanism: sql`excluded.mechanism`,
        overallPercentage: sql`excluded.overall_percentage`,
        overallGradeLabel: sql`excluded.overall_grade_label`,
        overallSubcategoryId: sql`excluded.overall_subcategory_id`,
        computedStatus: sql`excluded.computed_status`,
        finalStatus: sql`excluded.final_status`,
        overrideReason: sql`excluded.override_reason`,
        computedAt: sql`excluded.computed_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });

  return { written: values.length, overridesKept, mechanism: sheet.mechanism };
}

/** One term in a student's own history, as the portals show it. */
export interface StudentTermHistoryRow {
  termId: string;
  termName: string;
  academicYearId: string;
  academicYearName: string;
  gradeName: string;
  sectionName: string;
  mechanism: PromotionMechanism;
  overallPercentage: number | null;
  overallGradeLabel: string | null;
  overallSubcategory: ReportCardSubcategory | null;
  finalStatus: PromotionStatus;
  isOverridden: boolean;
  overrideReason: string | null;
  termIsPublished: boolean;
}

/**
 * Every term this child has a judgement for, newest first.
 *
 * ── Unpublished terms are withheld from families and not from the office ──
 * `publishedOnly` defaults to true, which is what both portals pass. A term
 * the school has not published has no report card as far as a family is
 * concerned (Sprint 9), and a promotion status is the most consequential thing
 * on the card — leaking it early would tell a parent their child has been held
 * back before the school has said so.
 *
 * ── The override reason travels with the row ─────────────────────────────
 * Deliberately. The product owner asked for the reason a status was changed to
 * be visible to every relevant party including parents, so it is part of the
 * payload rather than something the admin screens alone can see.
 */
export async function listStudentTermHistory(
  locationId: string,
  studentProfileId: string,
  options: { publishedOnly?: boolean | undefined; academicYearId?: string | undefined } = {},
): Promise<StudentTermHistoryRow[]> {
  const conditions: SQL[] = [
    eq(studentTermResults.locationId, locationId),
    eq(studentTermResults.studentProfileId, studentProfileId),
    isNull(examTerms.archivedAt),
  ];
  if (options.publishedOnly !== false) {
    conditions.push(eq(examTerms.isPublished, true));
  }
  if (options.academicYearId !== undefined && options.academicYearId !== '') {
    conditions.push(eq(studentTermResults.academicYearId, options.academicYearId));
  }

  const rows = await db
    .select({
      termId: studentTermResults.termId,
      termName: examTerms.name,
      termIsPublished: examTerms.isPublished,
      sequenceOrder: examTerms.sequenceOrder,
      academicYearId: studentTermResults.academicYearId,
      academicYearName: academicYears.name,
      yearStartYear: academicYears.startYear,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionName: sections.name,
      mechanism: studentTermResults.mechanism,
      overallPercentage: studentTermResults.overallPercentage,
      overallGradeLabel: studentTermResults.overallGradeLabel,
      subcategoryId: resultSubcategories.id,
      subcategoryLabel: resultSubcategories.label,
      subcategoryColor: resultSubcategories.colorHex,
      computedStatus: studentTermResults.computedStatus,
      finalStatus: studentTermResults.finalStatus,
      overrideReason: studentTermResults.overrideReason,
    })
    .from(studentTermResults)
    .innerJoin(examTerms, eq(examTerms.id, studentTermResults.termId))
    .innerJoin(academicYears, eq(academicYears.id, studentTermResults.academicYearId))
    .innerJoin(grades, eq(grades.id, studentTermResults.gradeId))
    .innerJoin(sections, eq(sections.id, studentTermResults.sectionId))
    .leftJoin(
      resultSubcategories,
      eq(resultSubcategories.id, studentTermResults.overallSubcategoryId),
    )
    .where(and(...conditions))
    .orderBy(desc(academicYears.startYear), desc(examTerms.sequenceOrder));

  return rows.map((row) => ({
    termId: row.termId,
    termName: row.termName,
    academicYearId: row.academicYearId,
    academicYearName: row.academicYearName,
    gradeName: gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
    sectionName: row.sectionName,
    mechanism: row.mechanism,
    overallPercentage: toMark(row.overallPercentage),
    overallGradeLabel: row.overallGradeLabel,
    overallSubcategory:
      row.subcategoryId === null
        ? null
        : {
            id: row.subcategoryId,
            label: row.subcategoryLabel ?? '',
            colorHex: row.subcategoryColor,
          },
    finalStatus: row.finalStatus,
    isOverridden: row.finalStatus !== row.computedStatus,
    overrideReason: row.overrideReason,
    termIsPublished: row.termIsPublished,
  }));
}

// -----------------------------------------------------------------------------
// Sprint 14 — the teacher's datesheet
// -----------------------------------------------------------------------------

/** One row of the datesheet a teacher sees for a class they teach. */
export interface TeacherScheduleRow {
  termId: string;
  termName: string;
  scheduleId: string;
  scheduleName: string;
  scheduleStart: string;
  scheduleEnd: string | null;
  subjectName: string;
  examDate: string;
  startTime: string | null;
  durationMinutes: number | null;
  maxMarks: number | null;
  gradeName: string;
  mechanism: PromotionMechanism;
}

/**
 * The datesheet rows for the subjects this teacher actually teaches.
 *
 * Narrowed by the timetable, exactly as `listTeacherPapers` is: a teacher's
 * exam screen is their own week, not the school's. A teacher timetabled to
 * three classes sees three grades' rows and no others, so a maths teacher does
 * not have to read past the whole senior school to find their Thursday.
 *
 * Max marks are carried for display and are null in descriptor mode, where
 * there is nothing for a paper to be out of.
 */
export async function listTeacherScheduleRows(
  locationId: string,
  teacherId: string,
  academicYearId: string,
): Promise<TeacherScheduleRow[]> {
  const rows = await db
    .selectDistinct({
      termId: examTerms.id,
      termName: examTerms.name,
      sequenceOrder: examTerms.sequenceOrder,
      scheduleId: examSchedules.id,
      scheduleName: examSchedules.name,
      scheduleStart: examSchedules.startDate,
      scheduleEnd: examSchedules.endDate,
      subjectName: subjects.name,
      examDate: examScheduleSubjects.examDate,
      startTime: examScheduleSubjects.startTime,
      durationMinutes: examScheduleSubjects.durationMinutes,
      maxMarks: examScheduleSubjects.maxMarks,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      mechanism: gradePromotionCriteria.mechanism,
    })
    .from(examScheduleSubjects)
    .innerJoin(examSchedules, eq(examSchedules.id, examScheduleSubjects.scheduleId))
    .innerJoin(examTerms, eq(examTerms.id, examSchedules.termId))
    .innerJoin(subjects, eq(subjects.id, examScheduleSubjects.subjectId))
    .innerJoin(
      examScheduleGrades,
      and(
        eq(examScheduleGrades.scheduleId, examSchedules.id),
        isNull(examScheduleGrades.archivedAt),
      ),
    )
    .innerJoin(grades, eq(grades.id, examScheduleGrades.gradeId))
    .innerJoin(sections, eq(sections.gradeId, grades.id))
    // The timetable is what makes a subject "theirs". Same rule as marks entry.
    .innerJoin(
      timetableEntries,
      and(
        eq(timetableEntries.sectionId, sections.id),
        eq(timetableEntries.subjectId, subjects.id),
        eq(timetableEntries.teacherId, teacherId),
        eq(timetableEntries.locationId, locationId),
      ),
    )
    .leftJoin(
      gradePromotionCriteria,
      and(
        eq(gradePromotionCriteria.gradeId, grades.id),
        eq(gradePromotionCriteria.locationId, locationId),
        eq(gradePromotionCriteria.academicYearId, academicYearId),
      ),
    )
    .where(
      and(
        eq(examScheduleSubjects.locationId, locationId),
        eq(examTerms.academicYearId, academicYearId),
        eq(sections.academicYearId, academicYearId),
        isNull(examScheduleSubjects.archivedAt),
        isNull(examSchedules.archivedAt),
        isNull(examTerms.archivedAt),
      ),
    )
    .orderBy(
      asc(examTerms.sequenceOrder),
      asc(examScheduleSubjects.examDate),
      asc(subjects.name),
    );

  return rows.map((row) => ({
    termId: row.termId,
    termName: row.termName,
    scheduleId: row.scheduleId,
    scheduleName: row.scheduleName,
    scheduleStart: row.scheduleStart,
    scheduleEnd: row.scheduleEnd,
    subjectName: row.subjectName,
    examDate: row.examDate,
    startTime: row.startTime,
    durationMinutes: row.durationMinutes,
    maxMarks: toMark(row.maxMarks),
    gradeName: gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
    mechanism: row.mechanism ?? DEFAULT_CRITERIA.mechanism,
  }));
}
