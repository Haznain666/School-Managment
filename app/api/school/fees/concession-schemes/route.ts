import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  effectiveBranchIds,
  readBranchParam,
  resolveBranchScope,
} from '@/lib/branch-scope';
import {
  createConcessionScheme,
  listConcessionSchemes,
  ConcessionSchemeError,
} from '@/lib/concession-schemes';

import { readSchemeInput } from './input';

/**
 * /api/school/fees/concession-schemes
 *
 * GET  every scheme the school has defined
 * POST define one
 *
 * A scheme is a discount the *school* owns — "Sibling Discount, 20%, every fee
 * head, from 1 August" — as opposed to `student_concessions`, which is one
 * child's grant of it. Creating a scheme grants nothing to anybody; that is
 * `[schemeId]/apply`, and keeping the two apart is what stops a rate change
 * from silently re-billing four hundred families.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const scope = await resolveBranchScope(
        auth.locationId,
        auth,
        readBranchParam(new URL(request.url)),
      );

      return apiSuccess({
        schemes: await listConcessionSchemes(
          auth.locationId,
          effectiveBranchIds(scope),
        ),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<Record<string, unknown>>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const input = readSchemeInput(body);
      if (typeof input === 'string') {
        return apiFailure('invalid_body', input, 400);
      }

      const schemeId = await createConcessionScheme(auth.locationId, auth.uid, input);

      return apiSuccess({ schemeId }, 201);
    } catch (error) {
      if (error instanceof ConcessionSchemeError) {
        return apiFailure(error.code, error.message, error.status);
      }
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
