import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { isValidCnic } from '@/lib/national-id';
import { lookupGuardianByCnic } from '@/lib/siblings';

/**
 * /api/school/guardians/lookup?cnic=42101-1234567-1
 *
 * "Does this school already know this person, and whose children are they?"
 *
 * ── Why the enrollment form asks this before it asks anything else ────────
 * The second child of an existing parent is the case the whole sibling feature
 * is about, and it is decided in the first three seconds of the guardian step.
 * If the clerk types the father's name and number from scratch, any difference
 * in spelling — a `0300` written `+92300`, a middle name included this time —
 * creates a second person, and the two children are related in the database by
 * nothing at all. Asking for the CNIC first and filling the rest in from the
 * record the school already holds is how that stops happening.
 *
 * ── What it deliberately does not do ─────────────────────────────────────
 * It is not a search. A whole, correctly shaped CNIC comes back with an answer;
 * anything shorter comes back empty rather than prefix-matching, so this cannot
 * be walked to enumerate the guardians of a school. That matters because the
 * response carries a phone number, an email address and the names of children.
 *
 * It is gated on `admissions.write` rather than `admissions.read` for the same
 * reason: the people who need it are the people entering a guardian, not
 * everyone who can look at a class list.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const cnic = (new URL(request.url).searchParams.get('cnic') ?? '').trim();

      if (!isValidCnic(cnic)) {
        return apiFailure(
          'invalid_cnic',
          'Enter a whole CNIC — 13 digits, as 42101-1234567-1.',
          400,
        );
      }

      return apiSuccess(await lookupGuardianByCnic(auth.locationId, cnic));
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
