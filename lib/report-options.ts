import 'server-only';

import { and, asc, desc, eq } from 'drizzle-orm';

import { branches, examTerms, gradeLabel, grades, payrollRuns } from '@/db/schema';

import { listAcademicYears } from './admissions-queries';
import { db } from './drizzle';
import type { ReportDefinition, ReportParams } from './report-catalogue';

/**
 * What the filter bar offers, and what the printed sheet calls it.
 *
 * Loaded once per request and handed to both the filter bar and
 * `describeScope`, so the sheet's header line names the same term the dropdown
 * was showing. The alternative — the print page re-reading the names — is how a
 * printout ends up captioned with an id.
 *
 * Only the lists a report actually declares are read. A payroll report asks for
 * years and campuses and pays nothing for the grade list it does not offer.
 */

export interface ReportOption {
  value: string;
  label: string;
}

export interface ReportOptions {
  branches: ReportOption[];
  grades: ReportOption[];
  terms: ReportOption[];
  academicYears: ReportOption[];
  years: ReportOption[];
}

const EMPTY: ReportOptions = {
  branches: [],
  grades: [],
  terms: [],
  academicYears: [],
  years: [],
};

export async function loadReportOptions(
  definition: ReportDefinition,
  locationId: string,
  sessionBranchId: string | null,
): Promise<ReportOptions> {
  const wants = (filter: ReportDefinition['filters'][number]): boolean =>
    definition.filters.includes(filter);

  const [branchRows, gradeRows, termRows, yearRows, payrollYears] = await Promise.all([
    // A branch-bound administrator gets no campus control at all — the runner
    // pins the scope to their own campus, so a dropdown offering others would
    // be a control that silently does nothing.
    wants('branch') && sessionBranchId === null
      ? db
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(and(eq(branches.locationId, locationId), eq(branches.isActive, true)))
          .orderBy(asc(branches.name))
      : Promise.resolve([]),

    wants('grade')
      ? db
          .select({
            id: grades.id,
            name: grades.name,
            displayName: grades.displayName,
            sortOrder: grades.sortOrder,
          })
          .from(grades)
          .where(
            and(
              eq(grades.locationId, locationId),
              eq(grades.isActive, true),
              sessionBranchId === null
                ? undefined
                : eq(grades.branchId, sessionBranchId),
            ),
          )
          .orderBy(asc(grades.sortOrder))
      : Promise.resolve([]),

    wants('term')
      ? db
          .select({ id: examTerms.id, name: examTerms.name, startDate: examTerms.startDate })
          .from(examTerms)
          .where(eq(examTerms.locationId, locationId))
          .orderBy(desc(examTerms.startDate))
      : Promise.resolve([]),

    wants('academicYear') ? listAcademicYears(locationId) : Promise.resolve([]),

    wants('year')
      ? db
          .selectDistinct({ year: payrollRuns.payrollYear })
          .from(payrollRuns)
          .where(eq(payrollRuns.locationId, locationId))
          .orderBy(desc(payrollRuns.payrollYear))
      : Promise.resolve([]),
  ]);

  const thisYear = new Date().getFullYear();

  // The current year is always offered even when no run exists for it yet:
  // otherwise a school opening the payroll report in January, before the first
  // run of the year, is shown a dropdown that cannot select the year they are
  // looking at.
  const years = [
    ...new Set([thisYear, ...payrollYears.map((row) => row.year)]),
  ].sort((a, b) => b - a);

  return {
    ...EMPTY,
    branches: branchRows.map((row) => ({ value: row.id, label: row.name })),
    grades: gradeRows.map((row) => ({
      value: row.id,
      label: gradeLabel({ name: row.name, displayName: row.displayName }),
    })),
    terms: termRows.map((row) => ({ value: row.id, label: row.name })),
    academicYears: yearRows.map((row) => ({ value: row.id, label: row.name })),
    years: years.map((year) => ({ value: String(year), label: String(year) })),
  };
}

/** The chosen options' labels, for the printed header line. */
export function selectedNames(
  options: ReportOptions,
  params: ReportParams,
): { branch?: string; grade?: string; term?: string; academicYear?: string } {
  const find = (list: ReportOption[], value: string | undefined): string | undefined =>
    value === undefined ? undefined : list.find((row) => row.value === value)?.label;

  return {
    branch: find(options.branches, params.branchId),
    grade: find(options.grades, params.gradeId),
    term: find(options.terms, params.termId),
    academicYear: find(options.academicYears, params.academicYearId),
  };
}
