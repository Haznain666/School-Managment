import { randomUUID } from 'node:crypto';

import { and, eq, ne } from 'drizzle-orm';

import { academicYearBranches, academicYears } from '@/db/schema';
import {
  academicYearKey,
  academicYearRunProblem,
  planAcademicYearRun,
} from '@/lib/academic-year-runs';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { listAcademicYears } from '@/lib/admissions-queries';
import {
  branchForWrite,
  effectiveBranchIds,
  outOfScopeMessage,
  readBranchParam,
  resolveBranchScope,
  scopeAdmitsWrite,
  type BranchScope,
} from '@/lib/branch-scope';
import { db } from '@/lib/drizzle';
import { isUuid, readBoolean } from '@/lib/validation';

/**
 * /api/school/academic-years — the sessions this school runs.
 *
 * GET  every year this caller's campuses run, newest first, with the enrollment
 *      count that blocks deletion and the campuses each session belongs to
 * POST create a **run** of them
 *
 * Windows are stored as month/year pairs because Pakistani schools do not share
 * a calendar; see `db/schema/academic-years.ts`.
 *
 * ── Sprint 19b, item 14: a run, and it never duplicates ─────────────────
 * The body asks for a shape — start month, end month, first year, how many —
 * and the route creates every session that does not already exist, skipping the
 * ones that do and *counting* them. Refusing the whole run because one year is
 * already there is how a school ends up with half a calendar and no way to tell
 * which half: the years that failed and the years that were never asked for
 * look identical afterwards.
 *
 * The single-year case is the same code with `years: 1`, with one difference
 * that is worth the branch: when the *only* candidate already exists the caller
 * gets a **409 naming it**, because "0 created, 1 already existed" is a
 * summary, and a summary of one is a refusal that declines to say so.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      // Years this caller's campuses run, plus every school-wide year — which
      // is all of them until somebody attaches a campus. `?branch=` narrows
      // further and is validated by the resolver, never here.
      const scope = await resolveBranchScope(
        auth.locationId,
        auth,
        readBranchParam(new URL(request.url)),
      );

      return apiSuccess({
        academicYears: await listAcademicYears(
          auth.locationId,
          effectiveBranchIds(scope),
        ),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.read' },
);

interface CreateYearBody {
  startMonth?: unknown;
  startYear?: unknown;
  endMonth?: unknown;
  /** How many consecutive sessions. Absent means one. */
  years?: unknown;
  /** Campuses to attach. Absent or empty means school-wide — see below. */
  branchIds?: unknown;
  setAsActive?: unknown;
}

/** Reads a numeric field, returning NaN for anything that is not a number. */
function readNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

/**
 * The campuses a run should be filed against, or a refusal.
 *
 * ── Every id is checked, not just the first ─────────────────────────────
 * `scopeAdmitsWrite` per campus, so a stale tab left open across a
 * reassignment cannot attach a session to a campus the caller has since lost.
 * The refusal names the campus rather than the id, because an operator cannot
 * do anything with a uuid.
 *
 * ── An empty selection defers to `branchForWrite` ────────────────────────
 * Which is the same rule every other create in this product follows: a
 * school-wide caller means every campus (no rows), a branch-bound caller with
 * one campus means theirs, and a person holding several who has chosen none is
 * refused with a sentence asking them to pick. Inventing an answer there would
 * file a whole decade of calendar under a campus at random.
 */
function campusesForRun(
  scope: BranchScope,
  requested: readonly string[],
): { ok: true; branchIds: string[] } | { ok: false; message: string } {
  if (requested.length === 0) {
    const fallback = branchForWrite(scope, null);
    if (!fallback.ok) return fallback;
    return { ok: true, branchIds: fallback.branchId === null ? [] : [fallback.branchId] };
  }

  for (const branchId of requested) {
    if (!scopeAdmitsWrite(scope, branchId)) {
      return { ok: false, message: outOfScopeMessage(branchId, scope.options) };
    }
  }

  return { ok: true, branchIds: [...new Set(requested)] };
}

/** The `branchIds` field, narrowed to uuids. Anything else is a bad request. */
function readBranchIds(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  if (!value.every((entry) => typeof entry === 'string' && isUuid(entry))) return null;
  return value as string[];
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateYearBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const run = {
        startMonth: readNumber(body.startMonth),
        startYear: readNumber(body.startYear),
        endMonth: readNumber(body.endMonth),
        count: body.years === undefined ? 1 : readNumber(body.years),
      };

      const problem = academicYearRunProblem(run);
      if (problem !== null) return apiFailure('invalid_body', problem, 400);

      const requested = readBranchIds(body.branchIds);
      if (requested === null) {
        return apiFailure('invalid_body', 'Choose campuses from the list.', 400);
      }

      // Item 2e. The campus set is checked against the caller's own scope
      // before anything is written.
      const scope = await resolveBranchScope(auth.locationId, auth);
      const campuses = campusesForRun(scope, requested);
      if (!campuses.ok) return apiFailure('forbidden', campuses.message, 403);

      /*
       * What already exists, read once.
       *
       * The whole list rather than a query per candidate: a run of ten would
       * otherwise be ten round trips to Supabase before the first insert, and
       * a school has at most a few dozen years. `listAcademicYears` is called
       * unscoped on purpose — a year the caller cannot *see* is still a year
       * that exists, and creating a second one under it would produce two rows
       * with the same name that only the owner could tell apart.
       */
      const existing = await listAcademicYears(auth.locationId);
      const taken = new Map(
        existing.map((year) => [
          academicYearKey({
            ...year,
            branchIds: year.campuses.map((campus) => campus.id),
          }),
          year,
        ]),
      );

      const planned = planAcademicYearRun(run);

      const toCreate = planned.filter(
        (year) =>
          !taken.has(academicYearKey({ ...year, branchIds: campuses.branchIds })),
      );
      const skipped = planned.length - toCreate.length;

      if (toCreate.length === 0) {
        // The single-year form, refused by name. See the module docblock.
        if (planned.length === 1) {
          const clash = taken.get(
            academicYearKey({ ...planned[0]!, branchIds: campuses.branchIds }),
          );
          return apiFailure(
            'already_exists',
            `Your school already has ${clash?.name ?? planned[0]!.name} with exactly these campuses. ` +
              'Open Academic years to set it as active or edit it.',
            409,
          );
        }

        return apiSuccess({ created: 0, skipped, academicYears: [] });
      }

      const setAsActive = readBoolean(body.setAsActive, false);
      // Only ever the *first* year of a run. "Make these five active" has no
      // meaning — exactly one year is active — and activating the last would
      // leave a school enrolling children into 2031.
      const activeId = setAsActive ? randomUUID() : null;

      const rows = toCreate.map((year, index) => ({
        id: index === 0 && activeId !== null ? activeId : randomUUID(),
        // Tenant comes from the verified session, never from the body.
        locationId: auth.locationId,
        name: year.name,
        startMonth: year.startMonth,
        startYear: year.startYear,
        endMonth: year.endMonth,
        endYear: year.endYear,
        isActive: index === 0 && activeId !== null,
      }));

      const attachments = rows.flatMap((row) =>
        campuses.branchIds.map((branchId) => ({
          locationId: auth.locationId,
          academicYearId: row.id,
          branchId,
        })),
      );

      /*
       * One transaction, built on `tx` throughout.
       *
       * A year whose campus rows did not land is a *school-wide* year — the
       * absence is meaningful here — so a half-applied run would silently give
       * every campus a session that was meant for one. That is the failure
       * atomicity is for, and it is why the demotion of the incumbent active
       * year is inside it too: a school with two active years is a school whose
       * enrollment screen picks one at random.
       */
      await db.transaction(async (tx) => {
        await tx.insert(academicYears).values(rows);

        if (attachments.length > 0) {
          await tx.insert(academicYearBranches).values(attachments);
        }

        if (activeId !== null) {
          await tx
            .update(academicYears)
            .set({ isActive: false, updatedAt: new Date() })
            .where(
              and(
                eq(academicYears.locationId, auth.locationId),
                ne(academicYears.id, activeId),
              ),
            );
        }
      });

      return apiSuccess(
        {
          created: rows.length,
          skipped,
          academicYears: rows.map((row) => ({ id: row.id, name: row.name })),
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
