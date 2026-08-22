import { and, eq } from 'drizzle-orm';

import {
  isEmploymentType,
  isGender,
  isStaffStatus,
  schoolUsers,
  staff,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { normalizeCnic } from '@/lib/national-id';
import { db } from '@/lib/drizzle';
import { listDepartments, listStaff } from '@/lib/hr-queries';
import {
  isIsoDate,
  isUuid,
  readBoolean,
  readOptionalString,
  readString,
} from '@/lib/validation';

/**
 * /api/school/hr/staff
 *
 * GET  the staff directory
 * POST add an employment record
 *
 * ── On branch scope ──────────────────────────────────────────────────────
 * A branch admin sees their own branch and nothing else, and that is enforced
 * here rather than trusted from the query string: `auth.branchId` overrides
 * whatever the caller asked for whenever it is set. A `?branchId=` from
 * someone confined to one branch would otherwise be a way to read another's.
 *
 * An employment record does not require a portal login. A driver or a cleaner
 * is on the payroll and never signs in, and demanding an account first would
 * push a school back onto a spreadsheet for half its staff — so `schoolUserId`
 * is optional, and validated to belong to this tenant when it is supplied.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      // The caller's own branch wins over the parameter. Never the other way.
      const requestedBranch = url.searchParams.get('branchId');
      const branchId =
        auth.branchId ?? (requestedBranch === null || requestedBranch === '' ? undefined : requestedBranch);

      const statusParam = url.searchParams.get('status');

      const [rows, departments] = await Promise.all([
        listStaff(auth.locationId, {
          search: url.searchParams.get('search') ?? undefined,
          status: isStaffStatus(statusParam) ? statusParam : undefined,
          branchId: branchId ?? undefined,
          department: url.searchParams.get('department') ?? undefined,
        }),
        listDepartments(auth.locationId),
      ]);

      return apiSuccess({ staff: rows, departments });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.read' },
);

interface CreateStaffBody {
  employeeCode?: unknown;
  isClassTeacher?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  designation?: unknown;
  department?: unknown;
  employmentType?: unknown;
  joinedOn?: unknown;
  branchId?: unknown;
  schoolUserId?: unknown;
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

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateStaffBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const employeeCode = readString(body.employeeCode).toUpperCase();
      if (employeeCode === '' || employeeCode.length > 32) {
        return apiFailure(
          'invalid_body',
          'Enter an employee code of 32 characters or fewer.',
          400,
        );
      }

      const firstName = readString(body.firstName);
      const lastName = readString(body.lastName);
      if (firstName === '' || lastName === '') {
        return apiFailure('invalid_body', 'Enter the first and last name.', 400);
      }

      if (body.employmentType !== undefined && body.employmentType !== null) {
        if (!isEmploymentType(body.employmentType)) {
          return apiFailure('invalid_body', 'Choose a valid employment type.', 400);
        }
      }

      if (body.gender !== undefined && body.gender !== null && !isGender(body.gender)) {
        return apiFailure('invalid_body', 'Choose a valid gender.', 400);
      }

      const joinedOn = readOptionalString(body.joinedOn);
      if (joinedOn !== null && !isIsoDate(joinedOn)) {
        return apiFailure('invalid_body', 'Enter a valid joining date.', 400);
      }

      const dateOfBirth = readOptionalString(body.dateOfBirth);
      if (dateOfBirth !== null && !isIsoDate(dateOfBirth)) {
        return apiFailure('invalid_body', 'Enter a valid date of birth.', 400);
      }

      // A branch admin may only file staff against their own branch.
      const requestedBranch = readOptionalString(body.branchId);
      const branchId = auth.branchId ?? requestedBranch;
      if (branchId !== null && !isUuid(branchId)) {
        return apiFailure('invalid_body', 'Choose a valid branch.', 400);
      }

      const schoolUserId = readOptionalString(body.schoolUserId);
      if (schoolUserId !== null) {
        if (!isUuid(schoolUserId)) {
          return apiFailure('invalid_body', 'Choose a valid portal account.', 400);
        }

        // The account must belong to this tenant. Without this check an id from
        // another school could be linked into this one's staff directory.
        const owner = await db
          .select({ id: schoolUsers.id })
          .from(schoolUsers)
          .where(
            and(
              eq(schoolUsers.id, schoolUserId),
              eq(schoolUsers.locationId, auth.locationId),
            ),
          )
          .limit(1);

        if (owner[0] === undefined) {
          return apiFailure('invalid_body', 'That portal account was not found.', 404);
        }
      }

      const created = await db
        .insert(staff)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          branchId,
          schoolUserId,
          employeeCode,
          firstName,
          lastName,
          // Whether this person may be offered as a class's class teacher.
          // One flag rather than a role: the product owner was explicit that
          // "Class Teacher (Home Room)" and "None" are the same option.
          isClassTeacher: readBoolean(body.isClassTeacher, false),
          designation: readOptionalString(body.designation),
          department: readOptionalString(body.department),
          employmentType: isEmploymentType(body.employmentType)
            ? body.employmentType
            : null,
          joinedOn,
          phone: readOptionalString(body.phone),
          email: readOptionalString(body.email),
          // One spelling, as everywhere else a CNIC is stored. See
          // `lib/national-id.ts`.
          cnic: normalizeCnic(readOptionalString(body.cnic)),
          dateOfBirth,
          gender: isGender(body.gender) ? body.gender : null,
          address: readOptionalString(body.address),
          qualification: readOptionalString(body.qualification),
          emergencyContactName: readOptionalString(body.emergencyContactName),
          emergencyContactPhone: readOptionalString(body.emergencyContactPhone),
          bankAccountTitle: readOptionalString(body.bankAccountTitle),
          bankAccountNumber: readOptionalString(body.bankAccountNumber),
          bankName: readOptionalString(body.bankName),
        })
        .onConflictDoNothing({ target: [staff.locationId, staff.employeeCode] })
        .returning({ id: staff.id });

      if (created[0] === undefined) {
        return apiFailure(
          'duplicate',
          `Employee code "${employeeCode}" is already in use at your school.`,
          409,
        );
      }

      return apiSuccess({ staffId: created[0].id }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.write' },
);
