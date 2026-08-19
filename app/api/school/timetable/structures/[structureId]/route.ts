import { and, eq, inArray, ne } from 'drizzle-orm';

import { grades, periodStructureGrades, periodStructures } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getPeriodStructure } from '@/lib/academics-queries';
import { batch, db, type Tx } from '@/lib/drizzle';
import { isUuid, readBoolean, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/timetable/structures/[structureId]
 *
 * PUT    rename it, re-describe it, make it the default, retire or restore it
 * DELETE retire it (never a real delete — timetable entries point at its slots)
 *
 * ── Assigning grades ─────────────────────────────────────────────────────
 * `gradeIds` on the PUT replaces the whole assignment set for this structure,
 * rather than adding to it. That is what the screen does — an administrator
 * ticks the grades that belong here and saves — and an add-only endpoint would
 * make un-assigning impossible without a second verb.
 *
 * A grade may sit on exactly one structure, enforced by a unique index on
 * `grade_id`. So assigning a grade here *moves* it: the delete of its previous
 * row and the insert of this one go out in one transaction, because the
 * half-way state is a grade assigned to nothing, which silently sends a class
 * back to the default bell.
 *
 * ── Why the default cannot be un-set, only moved ─────────────────────────
 * `isDefault: false` on the current default is refused. Every grade nobody has
 * assigned resolves through the default, and a school with none would have
 * grids that render zero rows with no error to explain it. To change which one
 * it is, mark the *other* one default; this route demotes the incumbent inside
 * the same transaction.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ structureId: string }> };

interface UpdateStructureBody {
  name?: unknown;
  description?: unknown;
  isDefault?: unknown;
  isActive?: unknown;
  gradeIds?: unknown;
}

export const PUT = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { structureId } = await context.params;
      if (!isUuid(structureId)) {
        return apiFailure('not_found', 'That schedule does not exist.', 404);
      }

      const existing = await getPeriodStructure(auth.locationId, structureId);
      if (existing === null) {
        return apiFailure('not_found', 'That schedule does not exist.', 404);
      }

      const body = await readJsonBody<UpdateStructureBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof periodStructures.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (body.name !== undefined) {
        const name = readString(body.name);
        if (name === '' || name.length > 60) {
          return apiFailure(
            'invalid_body',
            'Give the schedule a name of 60 characters or fewer.',
            400,
          );
        }
        updates.name = name;
      }

      if (body.description !== undefined) {
        const description = readOptionalString(body.description);
        if (description !== null && description.length > 200) {
          return apiFailure(
            'invalid_body',
            'Keep the description to 200 characters or fewer.',
            400,
          );
        }
        updates.description = description;
      }

      const makeDefault = body.isDefault === true;

      if (body.isDefault === false && existing.isDefault) {
        return apiFailure(
          'default_required',
          'Every school needs one default schedule — it is what a grade you have not assigned runs on. Make another schedule the default instead.',
          409,
        );
      }

      if (body.isActive !== undefined) {
        const isActive = readBoolean(body.isActive, true);

        // Retiring the default would leave unassigned grades resolving through
        // an inactive structure, which `resolveStructureForGrade` will not use.
        if (!isActive && existing.isDefault) {
          return apiFailure(
            'default_required',
            'This is the default schedule, so it cannot be retired. Make another schedule the default first.',
            409,
          );
        }
        updates.isActive = isActive;
      }

      // ── Grade assignments ────────────────────────────────────────────
      let gradeIds: string[] | null = null;

      if (body.gradeIds !== undefined) {
        if (!Array.isArray(body.gradeIds) || !body.gradeIds.every(isUuid)) {
          return apiFailure('invalid_body', 'Choose grades from the list.', 400);
        }

        gradeIds = [...new Set(body.gradeIds as string[])];

        if (gradeIds.length > 0) {
          // Every grade re-checked against this tenant. The ids came from a
          // browser, and one from another school must not reach the join table.
          const owned = await db
            .select({ id: grades.id })
            .from(grades)
            .where(
              and(eq(grades.locationId, auth.locationId), inArray(grades.id, gradeIds)),
            );

          if (owned.length !== gradeIds.length) {
            return apiFailure('invalid_body', 'One of those grades does not exist.', 400);
          }
        }
      }

      const assignments = gradeIds;

      await batch(db, (tx: Tx) => {
        const statements: PromiseLike<unknown>[] = [
          tx
            .update(periodStructures)
            .set(makeDefault ? { ...updates, isDefault: true, isActive: true } : updates)
            .where(
              and(
                eq(periodStructures.locationId, auth.locationId),
                eq(periodStructures.id, structureId),
              ),
            ),
        ];

        if (makeDefault) {
          // Demoted in the same transaction as the promotion. The partial
          // unique index would reject two defaults, so doing this in two
          // requests would fail on the first.
          statements.unshift(
            tx
              .update(periodStructures)
              .set({ isDefault: false, updatedAt: new Date() })
              .where(
                and(
                  eq(periodStructures.locationId, auth.locationId),
                  ne(periodStructures.id, structureId),
                  eq(periodStructures.isDefault, true),
                ),
              ),
          );
        }

        if (assignments !== null) {
          // Clear what this structure held…
          statements.push(
            tx
              .delete(periodStructureGrades)
              .where(
                and(
                  eq(periodStructureGrades.locationId, auth.locationId),
                  eq(periodStructureGrades.periodStructureId, structureId),
                ),
              ),
          );

          if (assignments.length > 0) {
            // …and take these grades off whichever structure held them, so the
            // insert below cannot collide with the unique index on grade_id.
            statements.push(
              tx
                .delete(periodStructureGrades)
                .where(
                  and(
                    eq(periodStructureGrades.locationId, auth.locationId),
                    inArray(periodStructureGrades.gradeId, assignments),
                  ),
                ),
            );

            statements.push(
              tx.insert(periodStructureGrades).values(
                assignments.map((gradeId) => ({
                  locationId: auth.locationId,
                  periodStructureId: structureId,
                  gradeId,
                })),
              ),
            );
          }
        }

        return statements;
      });

      return apiSuccess({
        structure: await getPeriodStructure(auth.locationId, structureId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { structureId } = await context.params;
      if (!isUuid(structureId)) {
        return apiFailure('not_found', 'That schedule does not exist.', 404);
      }

      const existing = await getPeriodStructure(auth.locationId, structureId);
      if (existing === null) {
        return apiFailure('not_found', 'That schedule does not exist.', 404);
      }

      if (existing.isDefault) {
        return apiFailure(
          'default_required',
          'This is the default schedule, so it cannot be retired. Make another schedule the default first.',
          409,
        );
      }

      /*
       * Retired, not deleted.
       *
       * `timetable_entries.slot_id` points at rows inside this structure, so a
       * real delete would cascade and take last term's timetable with it — the
       * same reason subjects are retired rather than removed.
       *
       * The periods themselves are deliberately left active. Nothing can reach
       * them while the structure is retired — `resolveStructureForGrade`
       * requires an active one, and every grid resolves through it — and
       * leaving them alone is what makes Restore put the schedule back exactly
       * as it was. Retiring them too would make retirement a one-way door
       * dressed up as a reversible one.
       */
      await batch(db, (tx: Tx) => [
        tx
          .update(periodStructures)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(periodStructures.locationId, auth.locationId),
              eq(periodStructures.id, structureId),
            ),
          ),
        // The grades on it fall back to the default, which is the only thing
        // left that can lay them out.
        tx
          .delete(periodStructureGrades)
          .where(
            and(
              eq(periodStructureGrades.locationId, auth.locationId),
              eq(periodStructureGrades.periodStructureId, structureId),
            ),
          ),
      ]);

      return apiSuccess({ retired: true });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.write' },
);
