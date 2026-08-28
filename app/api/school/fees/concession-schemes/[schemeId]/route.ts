import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  deleteConcessionScheme,
  updateConcessionScheme,
  ConcessionSchemeError,
} from '@/lib/concession-schemes';
import { isUuid } from '@/lib/validation';

import { readSchemeInput } from '../input';

/**
 * /api/school/fees/concession-schemes/[schemeId]
 *
 * PATCH  edit the policy
 * DELETE remove it
 *
 * ── Neither one touches a grant ──────────────────────────────────────────
 * Editing a scheme changes what the *next* student granted it receives.
 * Everybody who already holds it keeps the name, rate and dates frozen onto
 * their own `student_concessions` row at grant time, and their unpaid vouchers
 * are not re-priced. That is the whole reason the grant carries a copy: a
 * school correcting a typo in a scheme name in March must not rewrite what
 * February's printed slip claims to be, and cutting a rate must not quietly
 * raise four hundred bills.
 *
 * A school that means "everybody now gets 15%" removes the grants and applies
 * the amended scheme again — two deliberate actions, each of which says on
 * screen what it is about to do.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schemeId: string }> };

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { schemeId } = await context.params;
      if (!isUuid(schemeId)) return apiFailure('not_found', 'Scheme not found.', 404);

      const body = await readJsonBody<Record<string, unknown>>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const input = readSchemeInput(body);
      if (typeof input === 'string') {
        return apiFailure('invalid_body', input, 400);
      }

      await updateConcessionScheme(auth.locationId, schemeId, input);

      return apiSuccess({ updated: true });
    } catch (error) {
      if (error instanceof ConcessionSchemeError) {
        return apiFailure(error.code, error.message, error.status);
      }
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { schemeId } = await context.params;
      if (!isUuid(schemeId)) return apiFailure('not_found', 'Scheme not found.', 404);

      await deleteConcessionScheme(auth.locationId, schemeId);

      return apiSuccess({ deleted: true });
    } catch (error) {
      if (error instanceof ConcessionSchemeError) {
        return apiFailure(error.code, error.message, error.status);
      }
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
