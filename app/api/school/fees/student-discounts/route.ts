import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  effectiveBranchIds,
  readBranchParam,
  resolveBranchScope,
} from '@/lib/branch-scope';
import { applySchemeToStudents, ConcessionSchemeError } from '@/lib/concession-schemes';
import { normalizeCnic } from '@/lib/national-id';
import { normalizePhone } from '@/lib/phone';
import {
  closeStudentConcession,
  getNewChildDiscountState,
  getStudentDiscountState,
  StudentDiscountError,
} from '@/lib/student-discounts';
import { isUuid, readString } from '@/lib/validation';

/**
 * /api/school/fees/student-discounts — the Apply-discount panel (Sprint 20,
 * item 7).
 *
 * GET   the panel's whole state, for one child **or** for a child being enrolled
 * POST  grant one scheme of each selected type
 * PATCH close one grant
 *
 * ── Two GET modes, one shape ─────────────────────────────────────────────
 * `?studentProfileId=` answers for an enrolled child. `?cnic=&phone=` —
 * repeatable, one pair per guardian — answers for a child in the enrollment
 * wizard, who has no row yet and whose family is known only from what the clerk
 * has typed. The response shape is identical, which is what lets one component
 * serve both screens (decision D3) and what stops the wizard and the profile
 * coming to different conclusions about who qualifies.
 *
 * ── Permissions, and why there are no new keys ───────────────────────────
 * `fees.read` to look, `fees.write` to change. A discount is money off a fee,
 * which is the thing `fees.write` has always guarded; a key of its own would be
 * a question the permissions screen has to ask and a widening of the
 * `role_permissions` CHECK — the trap STATE.md §5o records — for a distinction
 * nobody has asked to draw.
 *
 * ── The tenant is the session's, always ──────────────────────────────────
 * `auth.locationId`, never a body or query value. The student id in the query
 * is re-read against that tenant inside `getStudentDiscountState`, which
 * answers null for a child of another school rather than leaking a name.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The guardian identities off a wizard request.
 *
 * Canonicalised on the way in, exactly as they would be on the way to the
 * column: a CNIC typed `4210112345671` and one typed `42101-1234567-1` are one
 * person, and comparing them raw is how a family silently stops being a family
 * — CLAUDE.md's CNIC rule, applied to a read rather than a write.
 */
function identitiesFrom(url: URL): { cnic: string | null; phone: string | null }[] {
  const cnics = url.searchParams.getAll('cnic');
  const phones = url.searchParams.getAll('phone');
  const rows: { cnic: string | null; phone: string | null }[] = [];

  for (let index = 0; index < Math.max(cnics.length, phones.length); index += 1) {
    const cnic = normalizeCnic(cnics[index] ?? null);

    /*
     * A half-typed number is dropped, never refused. This runs while a clerk
     * is still filling the guardian step in, so `normalizePhone` throwing on
     * `(0321) 123-` is the expected case rather than an error — and a panel
     * that 400s on a keystroke is a panel nobody leaves open.
     */
    let phone: string | null = null;
    try {
      const canonical = normalizePhone(phones[index] ?? '');
      phone = canonical === '' ? null : canonical;
    } catch {
      phone = null;
    }

    if (cnic === null && phone === null) continue;
    rows.push({ cnic, phone });
  }

  return rows;
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const scope = await resolveBranchScope(auth.locationId, auth, readBranchParam(url));
      const branchIds = effectiveBranchIds(scope);

      const studentProfileId = url.searchParams.get('studentProfileId') ?? '';

      if (studentProfileId !== '') {
        if (!isUuid(studentProfileId)) {
          return apiFailure('invalid_query', 'Select a student.', 400);
        }

        const state = await getStudentDiscountState(
          auth.locationId,
          studentProfileId,
          branchIds,
        );

        if (state === null) {
          return apiFailure('not_found', 'That student is not at this school.', 404);
        }

        return apiSuccess(state);
      }

      // Wizard mode. A name is carried only so the panel can write the
      // sentence — "Sara has a brother at this school" — and is never stored.
      const studentName = readString(url.searchParams.get('studentName'));

      return apiSuccess(
        await getNewChildDiscountState(
          auth.locationId,
          studentName === '' ? 'This student' : studentName,
          identitiesFrom(url),
          branchIds,
        ),
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);

interface ApplyBody {
  studentProfileId?: unknown;
  schemeIds?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<ApplyBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      if (!isUuid(body.studentProfileId)) {
        return apiFailure('invalid_body', 'Select a student.', 400);
      }

      const schemeIds = Array.isArray(body.schemeIds)
        ? [...new Set(body.schemeIds.filter(isUuid))]
        : [];

      if (schemeIds.length === 0) {
        return apiFailure('invalid_body', 'Choose at least one discount.', 400);
      }

      const studentProfileId = body.studentProfileId;
      let granted = 0;
      let skipped = 0;
      let repricedVouchers = 0;

      /*
       * One scheme at a time, in order, through `applySchemeToStudents`.
       *
       * **Not a second grant path.** That function is the only place the
       * freezing rule lives — the scheme's name, rate, dates and heads are
       * copied onto the grant — and a second writer would be a second place for
       * it to be forgotten. It also skips a student who already holds the
       * scheme and reprices afterwards, which is exactly what the panel wants
       * when somebody applies a second discount to a child who has one.
       *
       * Sequentially rather than in parallel: each call reprices the same
       * student's open vouchers, and two of those racing would both read the
       * pre-reprice state.
       */
      for (const schemeId of schemeIds) {
        const result = await applySchemeToStudents({
          locationId: auth.locationId,
          schemeId,
          studentProfileIds: [studentProfileId],
          actorUid: auth.uid,
        });

        granted += result.granted;
        skipped += result.skipped;
        repricedVouchers += result.repricedVouchers;
      }

      return apiSuccess({ granted, skipped, repricedVouchers }, 201);
    } catch (error) {
      if (error instanceof ConcessionSchemeError) {
        return apiFailure(error.code, error.message, error.status);
      }
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);

interface CloseBody {
  studentProfileId?: unknown;
  concessionId?: unknown;
}

/**
 * Closes one grant.
 *
 * `PATCH`, not `DELETE`, and the verb is the point: the row is not removed, it
 * is **dated closed**. The vouchers it already discounted stay explainable, and
 * that is the same rule the automatic sweep follows and the same reasoning the
 * append-only ledger rests on.
 */
export const PATCH = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CloseBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      if (!isUuid(body.studentProfileId) || !isUuid(body.concessionId)) {
        return apiFailure('invalid_body', 'Select a discount to remove.', 400);
      }

      const result = await closeStudentConcession({
        locationId: auth.locationId,
        studentProfileId: body.studentProfileId,
        concessionId: body.concessionId,
        actorUid: auth.uid,
      });

      return apiSuccess(result);
    } catch (error) {
      if (error instanceof StudentDiscountError) {
        return apiFailure(error.code, error.message, error.status);
      }
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
