import {
  academicYearName,
  academicYearRangeProblem,
} from '@/db/schema/academic-years';

/**
 * Building a school's calendar in one go — Sprint 19b, item 14b.
 *
 * ── Why a run and not a form you press five times ────────────────────────
 * A school setting itself up needs the next five or ten sessions, and every one
 * of them is the same two months a year apart. Asking for that five times is
 * five chances to type 2028 where 2029 was meant, on a value that later decides
 * which year a child's fees, results and admission number are filed under. The
 * run asks for the shape once — start month, end month, first year, how many —
 * and derives the rest.
 *
 * ── The end year is derived, never asked ─────────────────────────────────
 * `endMonth <= startMonth` means the session crosses the new year (August–July,
 * the common Pakistani shape), so it ends the *following* calendar year.
 * Otherwise it ends in the same one (April–March is `4` to `3`, which crosses;
 * January–December is `1` to `12`, which does not). Deriving it removes the one
 * field an operator can put an internally inconsistent answer into, and
 * `academicYearRangeProblem` still checks the result — a rule that produces an
 * invalid window is a bug and should fail loudly rather than be stored.
 *
 * ── Dependency-free of the database, and of `server-only` ────────────────
 * The create form previews the whole run in the browser — "this will create
 * 2026-2027 … 2030-2031" — and the route plans the same run on the server. Two
 * implementations of "what does this produce" is one too many, and the one that
 * would drift is the preview, which is the only one anybody reads before
 * pressing the button.
 */

/**
 * How many sessions one run may create.
 *
 * Ten is more than any school has ever needed at once — a decade of calendar —
 * and it is small enough that the confirmation ("7 created, 3 already existed")
 * stays a sentence rather than a report. The ceiling exists because the field
 * is a number input and a stray keystroke turns 5 into 55.
 */
export const MAX_RUN_YEARS = 10;

/** One session a run would create. */
export interface PlannedAcademicYear {
  startMonth: number;
  startYear: number;
  endMonth: number;
  endYear: number;
  /** `2026-2027`, derived exactly as a hand-created year's name is. */
  name: string;
}

export interface AcademicYearRunRequest {
  startMonth: number;
  endMonth: number;
  startYear: number;
  /** How many consecutive sessions to create. 1 is the single-year form. */
  count: number;
}

/**
 * The calendar year a session ending in `endMonth` ends in.
 *
 * Exported because the run form shows the derived end beside the inputs, and a
 * form that shows a different end from the one that gets stored is worse than
 * one that shows none.
 */
export function endYearFor(
  startMonth: number,
  startYear: number,
  endMonth: number,
): number {
  return endMonth <= startMonth ? startYear + 1 : startYear;
}

/** What is wrong with a run, or null. */
export function academicYearRunProblem(
  request: AcademicYearRunRequest,
): string | null {
  const { startMonth, endMonth, startYear, count } = request;

  if (!Number.isInteger(count) || count < 1 || count > MAX_RUN_YEARS) {
    return `Create between 1 and ${MAX_RUN_YEARS} years at a time.`;
  }

  for (const month of [startMonth, endMonth]) {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return 'Months must be between 1 and 12.';
    }
  }

  if (!Number.isInteger(startYear) || startYear < 2000 || startYear > 2100) {
    return 'Years must be between 2000 and 2100.';
  }

  // The *last* year of the run has to be storable too. A run of ten starting in
  // 2095 would otherwise be accepted here and refused half way through by the
  // range check below, leaving a school with part of a calendar and an error
  // message about a year they never typed.
  const last = startYear + count - 1;
  if (last > 2100) {
    return `A run of ${count} years from ${startYear} would reach ${last}. Years must be 2100 or earlier.`;
  }

  // Delegated rather than restated. `academicYearRangeProblem` is what the
  // single-year path has always used and what the column CHECKs mirror.
  return academicYearRangeProblem({
    startMonth,
    startYear,
    endMonth,
    endYear: endYearFor(startMonth, startYear, endMonth),
  });
}

/**
 * The sessions a run would create, in calendar order.
 *
 * Returns an empty array for a request `academicYearRunProblem` rejects, so a
 * caller that forgot to validate creates nothing rather than something wrong.
 */
export function planAcademicYearRun(
  request: AcademicYearRunRequest,
): PlannedAcademicYear[] {
  if (academicYearRunProblem(request) !== null) return [];

  const planned: PlannedAcademicYear[] = [];

  for (let offset = 0; offset < request.count; offset += 1) {
    const startYear = request.startYear + offset;
    const endYear = endYearFor(request.startMonth, startYear, request.endMonth);

    planned.push({
      startMonth: request.startMonth,
      startYear,
      endMonth: request.endMonth,
      endYear,
      name: academicYearName(startYear, endYear),
    });
  }

  return planned;
}

/**
 * The identity of a session, for the purpose of "does this already exist".
 *
 * ── The campus set is part of it, and that is a decision ────────────────
 * `2026-2027 at Karachi` and `2026-2027 school-wide` are different rows saying
 * different things, so creating the first when the second exists is not a
 * duplicate. It reads oddly on a list — two years with the same name — and the
 * alternative reads worse: a group that has just given Karachi its own calendar
 * would find the run silently did nothing, with no way to tell whether that was
 * the guard working or the form failing.
 *
 * Campuses are sorted so that ticking them in a different order is still the
 * same set. An empty set is school-wide and sorts to the empty string, which is
 * a value the key can hold rather than a case it has to special-case.
 */
export function academicYearKey(year: {
  startMonth: number;
  startYear: number;
  endMonth: number;
  endYear: number;
  branchIds: readonly string[];
}): string {
  const campuses = [...year.branchIds].sort().join(',');
  return `${year.startYear}-${year.startMonth}-${year.endYear}-${year.endMonth}|${campuses}`;
}

/** What the run reports back, in the school's own terms. */
export interface AcademicYearRunResult {
  created: number;
  /** Candidates that already existed. Skipped, never an error. */
  skipped: number;
}

/**
 * "7 created, 3 already existed" — the sentence the screen shows.
 *
 * Written here rather than in the component because the API returns the same
 * counts to anything that calls it, and a school reading "7 created" with no
 * mention of the 3 would reasonably conclude three years had been lost.
 */
export function describeRunResult(result: AcademicYearRunResult): string {
  const created =
    result.created === 1 ? '1 year created' : `${result.created} years created`;

  if (result.skipped === 0) return `${created}.`;

  const skipped =
    result.skipped === 1 ? '1 already existed' : `${result.skipped} already existed`;

  return `${created}, ${skipped}.`;
}
