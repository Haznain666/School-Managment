import 'server-only';

import type { SchoolAuthContext } from './api-auth';
import { schoolUserIdForUid } from './accounting-queries';
import { getLeaveApplicant, type LeaveApplicant } from './leave-queries';
import { hasPermission } from './permission-queries';
import { staffIdForSchoolUser } from './staff-self-queries';
import { isUuid, readOptionalString } from './validation';

/**
 * Whose leave this is, and whether the caller may act for them. Sprint 33b.
 *
 * Shared by `POST /api/school/leave/requests` and `GET /api/school/leave/count`
 * (QA round 1, F5) so the form's day count and the write answer "for whom" by
 * the same three rules:
 *
 *   1. no `staffId` means **my own** record, derived from the session — never
 *      chosen, so there is no id to forget to check;
 *   2. somebody else's needs **`leave.manage`** — decision 6's junior teacher,
 *      filed by HR — and never `leave.approve`, which is the other end of the
 *      same request;
 *   3. somebody else's must be at a campus the caller is bound to. Sprint 33a
 *      shipped this guard on the decision; filing had the same hole.
 */

export type ApplicantResolution =
  | { ok: true; applicant: LeaveApplicant; staffId: string; onBehalf: boolean }
  | { ok: false; code: string; message: string; status: number };

export async function resolveLeaveApplicant(
  auth: SchoolAuthContext,
  requestedStaffId: unknown,
): Promise<ApplicantResolution> {
  const schoolUserId = await schoolUserIdForUid(auth.locationId, auth.uid);
  const ownStaffId =
    schoolUserId === null ? null : await staffIdForSchoolUser(auth.locationId, schoolUserId);

  const requested = readOptionalString(requestedStaffId);
  if (requested !== null && !isUuid(requested)) {
    return { ok: false, code: 'invalid_body', message: 'Choose a staff member.', status: 400 };
  }

  const staffId = requested ?? ownStaffId;
  if (staffId === null) {
    return {
      ok: false,
      code: 'no_staff_record',
      message:
        'Leave is recorded against an HR staff record and your account is not linked to one yet. Ask the school office to link it.',
      status: 409,
    };
  }

  const onBehalf = staffId !== ownStaffId;
  if (onBehalf && !(await hasPermission(auth.locationId, auth.role, 'leave.manage'))) {
    return {
      ok: false,
      code: 'forbidden',
      message: 'Only somebody who manages leave can file a request for another member of staff.',
      status: 403,
    };
  }

  const applicant = await getLeaveApplicant(auth.locationId, staffId);
  if (applicant === null) {
    return { ok: false, code: 'not_found', message: 'Staff member not found.', status: 404 };
  }

  if (
    onBehalf &&
    auth.branchId !== null &&
    applicant.branchId !== null &&
    applicant.branchId !== auth.branchId
  ) {
    return {
      ok: false,
      code: 'wrong_campus',
      message:
        'That member of staff belongs to another campus. Somebody at that campus files their leave.',
      status: 403,
    };
  }

  return { ok: true, applicant, staffId, onBehalf };
}
