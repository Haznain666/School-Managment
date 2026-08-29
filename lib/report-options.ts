import 'server-only';

import { and, asc, desc, eq, inArray } from 'drizzle-orm';

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
 *
 * ── The campus list is a scope, not a session field (Sprint 19a, item 9) ─
 * This module used to take `sessionBranchId` and offer **no** campus control at
 * all when it was set, on the reasoning that a branch-bound caller is pinned to
 * their own campus and a dropdown offering others would be a control that
 * silently does nothing.
 *
 * That reasoning survives; the input does not. A principal granted two extra
 * campuses in `school_user_branches` has a real choice to make and was being
 * shown no control at all — so the parameter is now the resolved list from
 * `lib/branch-scope.ts`, and the rule becomes: **offer exactly the campuses
 * this person may read.** One campus still means no control, which is item 13's
 * rule and the same behaviour the old code produced for the common case.
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
  /**
   * The campuses this caller may read, from `resolveBranchScope`. `null` is
   * every campus, which is what a school-wide administrator gets.
   */
  branchIds: string[] | null,
): Promise<ReportOptions> {
  const wants = (filter: ReportDefinition['filters'][number]): boolean =>
    definition.filters.includes(filter);

  const [branchRows, gradeRows, termRows, yearRows, payrollYears] = await Promise.all([
    // Exactly the campuses this caller may read. A person confined to one gets
    // an empty list and therefore no control — the runner would pin the scope
    // to their campus regardless, and an offered control that is silently
    // overridden is worse than no control. The filter bar's own condition
    // (`options.branches.length > 0`) is what turns that into a hidden field.
    wants('branch')
      ? db
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(
            and(
              eq(branches.locationId, locationId),
              eq(branches.isActive, true),
              branchIds === null ? undefined : inArray(branches.id, branchIds),
            ),
          )
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
              // The class list narrows with the campus list, so a reader is
              // never offered a class that belongs to a campus they cannot see.
              branchIds === null ? undefined : inArray(grades.branchId, branchIds),
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
    /*
     * Every campus the caller may read, including when that is exactly one.
     *
     * Item 13 — one campus is not a question — is applied by `ReportFilterBar`,
     * which draws the control only above one option. It is **not** applied here,
     * and that distinction is load-bearing: `selectedNames` reads this list to
     * caption the printed sheet, and a list emptied for being short would leave
     * a one-campus printout captioned "All campuses" while its figures are one
     * campus's. `lib/report-catalogue.ts` says at length why a sheet captioned
     * with the wrong scope is worse than one with no caption at all.
     */
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
