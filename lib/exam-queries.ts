import 'server-only';

import { and, asc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';

import {
  academicYears,
  attendanceRecords,
  ATTEMPT_ORIGINAL,
  ATTEMPT_RESIT,
  examResults,
  examSubjects,
  examTerms,
  exams,
  gradeLabel,
  gradingBands,
  gradingSchemes,
  grades,
  schoolUsers,
  sections,
  studentEnrollments,
  studentProfiles,
  subjects,
  timetableEntries,
  type ResitStatus,
  type ResultStatus,
} from '@/db/schema';

import { db } from './drizzle';
import {
  assignPositions,
  percentageOf,
  resolveBand,
  sortBands,
  toMark,
  type ResolvedBand,
} from './grading';

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
  startDate: string;
  endDate: string;
  gradingSchemeId: string | null;
  isPublished: boolean;
  examCount: number;
}

export async function listExamTerms(
  locationId: string,
  filters: { academicYearId?: string | undefined } = {},
): Promise<ExamTermRow[]> {
  const conditions: SQL[] = [eq(examTerms.locationId, locationId)];
  if (filters.academicYearId !== undefined && filters.academicYearId !== '') {
    conditions.push(eq(examTerms.academicYearId, filters.academicYearId));
  }

  return db
    .select({
      id: examTerms.id,
      name: examTerms.name,
      academicYearId: examTerms.academicYearId,
      academicYearName: academicYears.name,
      startDate: examTerms.startDate,
      endDate: examTerms.endDate,
      gradingSchemeId: examTerms.gradingSchemeId,
      isPublished: examTerms.isPublished,
      examCount: sql<number>`count(${exams.id})`.mapWith(Number),
    })
    .from(examTerms)
    .innerJoin(academicYears, eq(academicYears.id, examTerms.academicYearId))
    .leftJoin(exams, eq(exams.termId, examTerms.id))
    .where(and(...conditions))
    .groupBy(examTerms.id, academicYears.name)
    .orderBy(asc(examTerms.startDate));
}

export async function getExamTerm(
  locationId: string,
  termId: string,
): Promise<ExamTermRow | null> {
  const rows = await db
    .select({
      id: examTerms.id,
      name: examTerms.name,
      academicYearId: examTerms.academicYearId,
      academicYearName: academicYears.name,
      startDate: examTerms.startDate,
      endDate: examTerms.endDate,
      gradingSchemeId: examTerms.gradingSchemeId,
      isPublished: examTerms.isPublished,
      examCount: sql<number>`0`.mapWith(Number),
    })
    .from(examTerms)
    .innerJoin(academicYears, eq(academicYears.id, examTerms.academicYearId))
    .where(and(eq(examTerms.locationId, locationId), eq(examTerms.id, termId)))
    .limit(1);

  return rows[0] ?? null;
}

// -----------------------------------------------------------------------------
// Exams and their papers
// -----------------------------------------------------------------------------

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
  const conditions: SQL[] = [eq(exams.locationId, locationId)];
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
    .leftJoin(examSubjects, eq(examSubjects.examId, exams.id))
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
    .where(and(eq(exams.locationId, locationId), eq(exams.id, examId)))
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
      and(eq(examSubjects.locationId, locationId), eq(examSubjects.examId, examId)),
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
  /** The mark for the attempt being entered. */
  marksObtained: number | null;
  isAbsent: boolean;
  remarks: string | null;
  /** The original sitting, shown for reference while entering a re-sit. */
  originalMarks: number | null;
  originalAbsent: boolean;
}

export interface MarksSheet {
  paper: ExamPaperContext;
  attempt: number;
  students: MarksSheetStudent[];
}

export async function getMarksSheet(
  locationId: string,
  examSubjectId: string,
  attempt: number,
): Promise<MarksSheet | null> {
  const paper = await getExamPaper(locationId, examSubjectId);
  if (paper === null) return null;

  const [roster, results] = await Promise.all([
    listSectionRoster(locationId, paper.sectionId, paper.academicYearId),
    db
      .select({
        studentProfileId: examResults.studentProfileId,
        attempt: examResults.attempt,
        marksObtained: examResults.marksObtained,
        isAbsent: examResults.isAbsent,
        remarks: examResults.remarks,
      })
      .from(examResults)
      .where(
        and(
          eq(examResults.locationId, locationId),
          eq(examResults.examSubjectId, examSubjectId),
        ),
      ),
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
    students: roster.map((student) => {
      const mine = forAttempt.get(student.studentProfileId);
      const first = original.get(student.studentProfileId);

      return {
        ...student,
        marksObtained: toMark(mine?.marksObtained),
        isAbsent: mine?.isAbsent ?? false,
        remarks: mine?.remarks ?? null,
        originalMarks: toMark(first?.marksObtained),
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
  marks: number | null;
  isAbsent: boolean;
  isResit: boolean;
  /** False when the paper's marks have not been published yet. */
  isPublished: boolean;
  isFail: boolean;
}

export interface TabulationRow {
  student: RosterStudent;
  cells: TabulationCell[];
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
}

/**
 * The grid a principal reviews after an exam.
 *
 * Unpublished papers are included and flagged, because reviewing them is the
 * point of the sheet. Nothing here is reachable without `exams.read`.
 */
export async function getTabulation(
  locationId: string,
  examId: string,
): Promise<Tabulation | null> {
  const exam = await getExamDetail(locationId, examId);
  if (exam === null) return null;

  const paperIds = exam.papers.map((paper) => paper.id);

  const [roster, bands, results] = await Promise.all([
    listSectionRoster(locationId, exam.sectionId, exam.academicYearId),
    bandsForTerm(locationId, exam.termId),
    paperIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            examSubjectId: examResults.examSubjectId,
            studentProfileId: examResults.studentProfileId,
            attempt: examResults.attempt,
            marksObtained: examResults.marksObtained,
            isAbsent: examResults.isAbsent,
          })
          .from(examResults)
          .where(
            and(
              eq(examResults.locationId, locationId),
              inArray(examResults.examSubjectId, paperIds),
            ),
          ),
  ]);

  const pick = resultPicker(results);

  const rows: TabulationRow[] = roster.map((student) => {
    const cells: TabulationCell[] = exam.papers.map((paper) => {
      const candidate = pick(paper, student.studentProfileId);
      const marks = toMark(candidate?.marksObtained);

      return {
        examSubjectId: paper.id,
        marks,
        isAbsent: candidate?.isAbsent ?? false,
        isResit: (candidate?.attempt ?? ATTEMPT_ORIGINAL) === ATTEMPT_RESIT,
        isPublished: paper.resultsStatus === 'published',
        isFail: marks !== null && marks < paper.passingMarks,
      };
    });

    // An absent paper still counts towards what was available: a percentage
    // that shrank its own denominator would reward missing your weakest paper.
    const available = exam.papers.reduce((sum, paper) => sum + paper.maxMarks, 0);
    const obtained = cells.reduce((sum, cell) => sum + (cell.marks ?? 0), 0);

    return {
      student,
      cells,
      obtained,
      available,
      percentage: percentageOf(obtained, available),
      grade: null,
      gpa: null,
      absentCount: cells.filter((cell) => cell.isAbsent).length,
      failedCount: cells.filter((cell) => cell.isFail).length,
      position: null,
    };
  });

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

  return {
    exam,
    papers: exam.papers,
    rows,
    bands,
    hasUnpublished: exam.papers.some((paper) => paper.resultsStatus !== 'published'),
  };
}

// -----------------------------------------------------------------------------
// Report cards
// -----------------------------------------------------------------------------

export interface ReportCardSubject {
  subjectName: string;
  examTitle: string;
  maxMarks: number;
  passingMarks: number;
  marks: number | null;
  isAbsent: boolean;
  isResit: boolean;
  isFail: boolean;
  percentage: number | null;
  grade: string | null;
}

export interface ReportCardAttendance {
  present: number;
  absent: number;
  late: number;
  excused: number;
  holiday: number;
  percentage: number;
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
  subjects: ReportCardSubject[];
  obtained: number;
  available: number;
  percentage: number;
  grade: string | null;
  gpa: number | null;
  remark: string | null;
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
        // A report card only ever reads published papers.
        eq(examSubjects.resultsStatus, 'published'),
      ),
    )
    .orderBy(asc(exams.examDate), asc(examSubjects.orderIndex), asc(subjects.name));

  const [roster, bands] = await Promise.all([
    listSectionRoster(locationId, sectionId, section.academicYearId),
    bandsForTerm(locationId, termId),
  ]);

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
          })
          .from(examResults)
          .where(
            and(
              eq(examResults.locationId, locationId),
              inArray(examResults.examSubjectId, paperIds),
            ),
          ),
    getTermAttendance(locationId, sectionId, term.startDate, term.endDate),
  ]);

  const pick = resultPicker(results);

  const cards: ReportCard[] = roster.map((student) => {
    const subjectRows: ReportCardSubject[] = papers.map((paper) => {
      const maxMarks = toMark(paper.maxMarks) ?? 0;
      const passingMarks = toMark(paper.passingMarks) ?? 0;

      const candidate = pick(paper, student.studentProfileId);
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
      };
    });

    const available = subjectRows.reduce((sum, row) => sum + row.maxMarks, 0);
    const obtained = subjectRows.reduce((sum, row) => sum + (row.marks ?? 0), 0);
    const percentage = percentageOf(obtained, available);
    const band = resolveBand(percentage, bands);

    return {
      student,
      termName: term.name,
      termIsPublished: term.isPublished,
      academicYearName: term.academicYearName,
      startDate: term.startDate,
      endDate: term.endDate,
      gradeName: gradeLabel({
        name: section.gradeName,
        displayName: section.gradeDisplayName,
      }),
      sectionName: section.sectionName,
      subjects: subjectRows,
      obtained,
      available,
      percentage,
      grade: band?.label ?? null,
      gpa: band?.gpa ?? null,
      remark: band?.remark ?? null,
      position: null,
      classSize: roster.length,
      absentCount: subjectRows.filter((row) => row.isAbsent).length,
      failedCount: subjectRows.filter((row) => row.isFail).length,
      attendance:
        attendance.get(student.studentProfileId) ??
        { present: 0, absent: 0, late: 0, excused: 0, holiday: 0, percentage: 0 },
    };
  });

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
      ),
    )
    .limit(1);

  return rows[0] !== undefined;
}
