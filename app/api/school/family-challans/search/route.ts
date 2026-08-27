import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { searchFamilies } from '@/lib/family-challans';

/**
 * GET /api/school/family-challans/search?q=
 *
 * Step 1 of the family-voucher wizard: find the family.
 *
 * ── Why the screen has a Search button ───────────────────────────────────
 * This is a server round trip over every open voucher in the school, folded
 * into families by the union-find in `lib/family-challans.ts`. A debounce
 * firing on every keystroke against that is what "the search does not work"
 * describes: the answer for `Ah` arrives after the answer for `Ahm`, the list
 * flickers between two results, and the clerk stops trusting it. So the button
 * is the trigger, and pressing it is the moment the reader expects to wait.
 *
 * ── What comes back ──────────────────────────────────────────────────────
 * Only families with **more than one child** — a single child does not need a
 * family voucher. Each result carries the guardian, their contact, the
 * children's names, and the months anything is open in, which is what step 2
 * is choosing between.
 *
 * Gated on `fees.read`: it is the fee register, narrowed to a person.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Below this a query matches most of a school and answers nothing. */
const MIN_QUERY = 2;

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const query = (new URL(request.url).searchParams.get('q') ?? '').trim();

      if (query.length < MIN_QUERY) {
        return apiFailure(
          'query_too_short',
          `Type at least ${String(MIN_QUERY)} characters of a parent's or a child's name, an admission number or a phone number.`,
          400,
        );
      }

      return apiSuccess({ families: await searchFamilies(auth.locationId, query) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);
