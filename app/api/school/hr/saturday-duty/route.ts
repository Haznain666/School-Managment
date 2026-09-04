import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  listStaffSaturdayDuty,
  saturdayPolicies,
  saveSaturdayPolicies,
  setStaffSaturdayOrdinals,
} from '@/lib/holiday-queries';
import { isUuid } from '@/lib/validation';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/hr/saturday-duty
 *
 * GET   the role policies and every member of staff's effective answer
 * PATCH replace the role policies, or set one person's override
 *
 * ── Two levels, and the difference between them is one character ─────────
 * `saturday_duty_policies` is the school's default **for a role** — teachers
 * every Saturday, the principal on the first and third. `staff.saturday_ordinals`
 * is one **person's** override, and:
 *
 *   · `null` means *no override, use the role policy*
 *   · `[]`   means *no Saturdays*, which is a real and opposite answer
 *
 * The body therefore distinguishes an **absent** `ordinals` from an empty
 * array, which is why this reads `body.ordinals === null` explicitly rather
 * than falling back through `??`. Collapsing the two would make it impossible
 * to excuse one coordinator from a rota her colleagues are on.
 *
 * ── Read with `hr.read`, written with `hr.write` ─────────────────────────
 * The roster is a staff rota. It is not `calendar.manage`, which is about the
 * days the school is shut — a Branch Administrator may close a campus for a
 * rally without being able to change who comes in on Saturdays.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 1–5: which Saturday of the month. 5 is real — a month can hold five. */
function readOrdinals(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;

  return [
    ...new Set(
      value
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= 5),
    ),
  ].sort((left, right) => left - right);
}

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const [policies, staffRows] = await Promise.all([
        saturdayPolicies(auth.locationId),
        listStaffSaturdayDuty(auth.locationId),
      ]);

      return apiSuccess({
        policies: USER_ROLES.map((role) => ({
          role,
          ordinals: policies.get(role) ?? [],
          // Whether the school has actually decided, as opposed to inheriting
          // the empty default. The screen says "not set" rather than "never",
          // because the two mean different things to whoever is reading it.
          isSet: policies.has(role),
        })),
        staff: staffRows,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.read' },
);

interface UpdateBody {
  /** Replaces every role policy. Absent leaves them alone. */
  policies?: unknown;
  /** One person's override. `ordinals: null` clears it back to the role's. */
  staffId?: unknown;
  ordinals?: unknown;
}

export const PATCH = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<UpdateBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      if (Array.isArray(body.policies)) {
        const policies = body.policies
          .filter(
            (entry): entry is { role: string; ordinals: unknown } =>
              typeof entry === 'object' &&
              entry !== null &&
              (USER_ROLES as readonly unknown[]).includes(
                (entry as { role?: unknown }).role,
              ),
          )
          .map((entry) => ({
            role: entry.role,
            ordinals: readOrdinals(entry.ordinals) ?? [],
          }));

        await saveSaturdayPolicies(auth.locationId, policies);
        return apiSuccess({ policies: policies.length });
      }

      const staffId = typeof body.staffId === 'string' ? body.staffId : '';
      if (!isUuid(staffId)) {
        return apiFailure(
          'invalid_body',
          'Send either a list of role policies or one staff member’s override.',
          400,
        );
      }

      /*
       * `null` clears the override; an array sets it, including an empty one.
       *
       * Written out rather than `readOrdinals(body.ordinals) ?? null`, which
       * would be the same expression and a lie: `readOrdinals` returns null for
       * anything that is not an array, so a malformed body would silently clear
       * an override instead of being refused.
       */
      const ordinals = body.ordinals === null ? null : readOrdinals(body.ordinals);
      if (ordinals === null && body.ordinals !== null) {
        return apiFailure(
          'invalid_body',
          'Send the Saturdays as a list of numbers between 1 and 5, or null to use the role policy.',
          400,
        );
      }

      const updated = await setStaffSaturdayOrdinals(auth.locationId, staffId, ordinals);
      if (!updated) return apiFailure('not_found', 'That staff member is not at this school.', 404);

      return apiSuccess({ staffId, ordinals });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.write' },
);
