import { and, eq } from 'drizzle-orm';

import { isEmploymentType, isGender, isStaffStatus, staff } from '@/db/schema';
import { withSchoolAuth, canAccessBranch } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { normalizeCnic } from '@/lib/national-id';
import { joiningDateProblem } from '@/lib/dates';
import { db } from '@/lib/drizzle';
import { getStaff, getStaffSalaryStructure } from '@/lib/hr-queries';
import { getSchoolUserById } from '@/lib/school-queries';
import { isIsoDate, isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/hr/staff/[staffId]
 *
 * GET   one employment record, with its salary structure
 * PATCH amend it
 *
 * There is no DELETE. A staff member who has ever appeared on a payroll run is
 * referenced by payslips, and a school still has to be able to explain what it
 * paid last March. Setting `status: 'resigned'` takes them off future runs
 * while leaving the record intact — which is also what a labour inspector
 * expects to find.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ staffId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { staffId } = await context.params;
      if (!isUuid(staffId)) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      const detail = await getStaff(auth.locationId, staffId);
      if (detail === null) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      // A branch admin may not read another branch's staff, even by direct id.
      if (detail.branchId !== null && !canAccessBranch(auth, detail.branchId)) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      /*
       * The linked account, read from the other end.
       *
       * A second small statement rather than a fourth join on `getStaff`: the
       * account's branch is a *different* branch from the employment record's,
       * so joining it would need `branches` twice under an alias, on a
       * statement CLAUDE.md's rule about unqualified references already applies
       * to. `getSchoolUserById` answers the same question, is tenant-scoped,
       * and has been executed by a gate since Sprint 19.
       */
      const account =
        detail.schoolUserId === null
          ? null
          : await getSchoolUserById(auth.locationId, detail.schoolUserId);

      return apiSuccess({
        staff: detail,
        account:
          account === null
            ? null
            : {
                id: account.id,
                name: account.name,
                role: account.role,
                branchName: account.branchName,
                isActive: account.isActive,
                authUserId: account.authUserId,
              },
        salaryStructure: await getStaffSalaryStructure(auth.locationId, staffId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.read' },
);

interface UpdateStaffBody {
  firstName?: unknown;
  isClassTeacher?: unknown;
  lastName?: unknown;
  designation?: unknown;
  department?: unknown;
  employmentType?: unknown;
  status?: unknown;
  joinedOn?: unknown;
  resignedOn?: unknown;
  branchId?: unknown;
  phone?: unknown;
  email?: unknown;
  cnic?: unknown;
  dateOfBirth?: unknown;
  gender?: unknown;
  address?: unknown;
  qualification?: unknown;
  emergencyContactName?: unknown;
  emergencyContactPhone?: unknown;
  bankAccountTitle?: unknown;
  bankAccountNumber?: unknown;
  bankName?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { staffId } = await context.params;
      if (!isUuid(staffId)) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      const existing = await getStaff(auth.locationId, staffId);
      if (existing === null) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      if (existing.branchId !== null && !canAccessBranch(auth, existing.branchId)) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      const body = await readJsonBody<UpdateStaffBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof staff.$inferInsert> = {};

      if (body.firstName !== undefined) {
        const firstName = readString(body.firstName);
        if (firstName === '') {
          return apiFailure('invalid_body', 'Enter a first name.', 400);
        }
        updates.firstName = firstName;
      }

      if (body.lastName !== undefined) {
        const lastName = readString(body.lastName);
        if (lastName === '') {
          return apiFailure('invalid_body', 'Enter a last name.', 400);
        }
        updates.lastName = lastName;
      }

      if (body.employmentType !== undefined) {
        if (body.employmentType === null) updates.employmentType = null;
        else if (isEmploymentType(body.employmentType)) {
          updates.employmentType = body.employmentType;
        } else {
          return apiFailure('invalid_body', 'Choose a valid employment type.', 400);
        }
      }

      if (body.status !== undefined) {
        if (!isStaffStatus(body.status)) {
          return apiFailure('invalid_body', 'Choose a valid staff status.', 400);
        }
        updates.status = body.status;
      }

      if (body.gender !== undefined) {
        if (body.gender === null) updates.gender = null;
        else if (isGender(body.gender)) updates.gender = body.gender;
        else return apiFailure('invalid_body', 'Choose a valid gender.', 400);
      }

      for (const field of ['joinedOn', 'resignedOn', 'dateOfBirth'] as const) {
        if (body[field] === undefined) continue;

        const value = readOptionalString(body[field]);
        if (value !== null && !isIsoDate(value)) {
          return apiFailure('invalid_body', 'Enter a valid date.', 400);
        }

        /*
         * Sprint 23, item 8, applied on the edit as well as the create.
         *
         * A ceiling enforced only on creation is a ceiling a clerk gets past by
         * saving twice, and the profile panel is where a joining date is most
         * often corrected — which is exactly where the year gets mistyped.
         */
        if (field === 'joinedOn') {
          const problem = joiningDateProblem(value);
          if (problem !== null) return apiFailure('invalid_body', problem, 400);
        }

        updates[field] = value;
      }

      if (body.branchId !== undefined) {
        // A branch admin cannot move someone out of their branch, or into it.
        if (auth.branchId !== null) {
          return apiFailure(
            'forbidden',
            'Only a school administrator can move staff between branches.',
            403,
          );
        }

        const branchId = readOptionalString(body.branchId);
        if (branchId !== null && !isUuid(branchId)) {
          return apiFailure('invalid_body', 'Choose a valid branch.', 400);
        }
        updates.branchId = branchId;
      }

      if (body.isClassTeacher !== undefined) {
        if (typeof body.isClassTeacher !== 'boolean') {
          return apiFailure('invalid_body', 'isClassTeacher must be true or false.', 400);
        }
        // Clearing it does not unseat them from a class they already hold.
        // `sections.class_teacher_id` is a separate decision made on the class,
        // and silently emptying it here would move a promotion screen out from
        // under the person using it.
        updates.isClassTeacher = body.isClassTeacher;
      }

      const optionalText = [
        'designation',
        'department',
        'phone',
        'email',
        'cnic',
        'address',
        'qualification',
        'emergencyContactName',
        'emergencyContactPhone',
        'bankAccountTitle',
        'bankAccountNumber',
        'bankName',
      ] as const;

      for (const field of optionalText) {
        if (body[field] !== undefined) updates[field] = readOptionalString(body[field]);
      }

      // The CNIC is the one member of that list that has a canonical form, and
      // it is re-written here rather than excluded from the loop so that the
      // loop stays the plain thing it is. See `lib/national-id.ts`.
      if (updates.cnic !== undefined) updates.cnic = normalizeCnic(updates.cnic);

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      updates.updatedAt = new Date();

      const updated = await db
        .update(staff)
        .set(updates)
        .where(and(eq(staff.id, staffId), eq(staff.locationId, auth.locationId)))
        .returning({ id: staff.id });

      if (updated[0] === undefined) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      return apiSuccess({ staff: await getStaff(auth.locationId, staffId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.write' },
);
