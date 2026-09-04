import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import {
  enrolledSiblingsFor,
  generateFamilyChallan,
  monthClashesForGuardian,
  primaryGuardianFor,
  FamilyChallanError,
} from '@/lib/family-challans';
import { ChallanGenerationError } from '@/lib/fee-challans';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/family-challans/generate
 *
 * GET  who the run would bill, and whose month is already taken. Takes either
 *      a `guardianId` or a `studentProfileId` — the second is how the screen
 *      actually reaches this, because the family being billed for the first
 *      time has no open vouchers to be found by, and a clerk always knows a
 *      child
 * POST raise the month's voucher for every enrolled sibling **and** the family
 *      wrapper over them, in one action
 *
 * ── Why this is a separate route from POST /family-challans ──────────────
 * That one *clubs* vouchers the school has already raised and takes a list of
 * challan ids. This one takes a guardian and a month and raises them. The two
 * bodies have nothing in common and the second is not a mode of the first — a
 * route that switched behaviour on whether `challanIds` was present would be
 * one typo away from doing the wrong one silently.
 *
 * ── Why the clash list is on the GET and not in the refusal body ─────────
 * `apiFailure` carries a code and a sentence, which is the whole envelope this
 * codebase has, and the sentence *does* name every child. What the screen
 * additionally needs — a row per child with a voucher number to show beside a
 * checkbox — is a list, and a list belongs on a read. So the dialog asks this
 * route what it would do, draws the answer, and the person decides; the POST
 * then refuses anyway if the answer moved underneath them, which is the same
 * discipline `createFamilyChallan` applies to its member list.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The four values both verbs need, or the failure that says which is wrong. */
function readPeriod(source: {
  guardianId?: unknown;
  academicYearId?: unknown;
  billingMonth?: unknown;
  billingYear?: unknown;
}):
  | {
      ok: true;
      guardianId: string;
      academicYearId: string;
      billingMonth: number;
      billingYear: number;
    }
  | { ok: false; message: string } {
  const guardianId = typeof source.guardianId === 'string' ? source.guardianId : '';
  if (!isUuid(guardianId)) return { ok: false, message: 'Choose a family.' };

  const academicYearId =
    typeof source.academicYearId === 'string' ? source.academicYearId : '';
  if (!isUuid(academicYearId)) {
    return { ok: false, message: 'Choose an academic year.' };
  }

  const billingMonth = Number(source.billingMonth);
  if (!Number.isInteger(billingMonth) || billingMonth < 1 || billingMonth > 12) {
    return { ok: false, message: 'Choose a billing month.' };
  }

  const billingYear = Number(source.billingYear);
  if (!Number.isInteger(billingYear) || billingYear < 2000 || billingYear > 2100) {
    return { ok: false, message: 'Choose a billing year.' };
  }

  return { ok: true, guardianId, academicYearId, billingMonth, billingYear };
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      /*
       * Either key resolves to the same answer. The pupil is looked up first
       * so that a request carrying both is answered from the child, which is
       * what the screen sends and what a stale `guardianId` in a bookmarked
       * URL would otherwise override.
       */
      const studentProfileId = url.searchParams.get('studentProfileId');
      let guardianId = url.searchParams.get('guardianId');
      let guardianName: string | null = null;

      if (studentProfileId !== null) {
        if (!isUuid(studentProfileId)) {
          return apiFailure('invalid_query', 'That student is not at this school.', 400);
        }

        const guardian = await primaryGuardianFor(auth.locationId, studentProfileId);
        if (guardian === null) {
          return apiFailure(
            'no_guardian',
            'That student has no primary contact recorded, so there is nobody to address a family voucher to.',
            409,
          );
        }

        guardianId = guardian.id;
        guardianName = guardian.name;
      }

      const period = readPeriod({
        guardianId,
        academicYearId: url.searchParams.get('academicYearId'),
        billingMonth: url.searchParams.get('billingMonth'),
        billingYear: url.searchParams.get('billingYear'),
      });

      if (!period.ok) return apiFailure('invalid_query', period.message, 400);

      const siblings = await enrolledSiblingsFor(
        auth.locationId,
        period.guardianId,
        period.academicYearId,
      );

      const clashes =
        siblings.length === 0
          ? []
          : await monthClashesForGuardian(
              auth.locationId,
              period.academicYearId,
              siblings.map((sibling) => sibling.studentProfileId),
              period.billingMonth,
              period.billingYear,
            );

      return apiSuccess({
        guardianId: period.guardianId,
        guardianName,
        siblings,
        clashes,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);

interface GenerateBody {
  guardianId?: unknown;
  academicYearId?: unknown;
  billingMonth?: unknown;
  billingYear?: unknown;
  dueDate?: unknown;
  cancelExisting?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<GenerateBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const period = readPeriod(body);
      if (!period.ok) return apiFailure('invalid_body', period.message, 400);

      const dueDateRaw = typeof body.dueDate === 'string' ? body.dueDate.trim() : '';
      if (
        dueDateRaw !== '' &&
        (!ISO_DATE.test(dueDateRaw) || Number.isNaN(Date.parse(dueDateRaw)))
      ) {
        return apiFailure('invalid_body', 'That due date is not a date.', 400);
      }

      const result = await generateFamilyChallan({
        // The tenant comes from the verified session and from nowhere else.
        locationId: auth.locationId,
        actorUid: auth.uid,
        guardianId: period.guardianId,
        academicYearId: period.academicYearId,
        billingMonth: period.billingMonth,
        billingYear: period.billingYear,
        // Absent means the school's own due day applied to the billing month —
        // `defaultDueDate`, which is what every other generator uses.
        dueDate: dueDateRaw === '' ? undefined : dueDateRaw,
        cancelExisting: body.cancelExisting === true,
      });

      return apiSuccess({ result }, 201);
    } catch (error) {
      if (error instanceof FamilyChallanError) {
        return apiFailure('invalid_body', error.message, error.status);
      }

      // A pricing refusal — no enrollment, no fee structure, no monthly heads —
      // reaches here from `generateChallan` and already carries a sentence
      // written for the person reading it.
      if (error instanceof ChallanGenerationError) {
        return apiFailure(error.code, error.message, error.status);
      }

      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
