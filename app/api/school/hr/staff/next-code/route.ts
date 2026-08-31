import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { nextEmployeeCode } from '@/lib/hr-queries';

/**
 * /api/school/hr/staff/next-code — the next free `EMP-<n>` for this school.
 *
 * `staff.employee_code` is `NOT NULL` and unique per school and has never had a
 * generator. That is tolerable on the HR screen, where a school entering its
 * payroll has its own numbering to hand, and hopeless on Invite Staff, where
 * the person filling the form is inviting a colleague and has no idea what the
 * school's codes look like.
 *
 * A **proposal, not a reservation** — see `nextEmployeeCode`. Two administrators
 * on the same minute are handed the same number and the second one meets the
 * unique index, reported against the field rather than swallowed.
 *
 * Static segment beside `[staffId]`, which is fine: Next matches the literal
 * first, and `[staffId]` refuses anything that is not a UUID in any case.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      return apiSuccess({ employeeCode: await nextEmployeeCode(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  // `hr.write`, not `hr.read`: this answers "what should I type next", which is
  // only ever asked by somebody about to write a record.
  { permission: 'hr.write' },
);
