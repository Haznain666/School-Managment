import { isEmploymentType, isGender, isStaffStatus, staff } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { normalizeCnic } from '@/lib/national-id';
import { joiningDateProblem } from '@/lib/dates';
import { visibleScopeFor } from '@/lib/principal-visibility';
import { db } from '@/lib/drizzle';
import { listDepartments, listStaff } from '@/lib/hr-queries';
import { hasPermission } from '@/lib/permission-queries';
import {
  accountLinkable,
  checkNewStaffLogin,
  createLoginForStaff,
  type NewStaffLogin,
} from '@/lib/staff-portal-access';
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
 *
 * ── Portal access, Sprint 22 ─────────────────────────────────────────────
 * `portalAccess.mode` is `none` (the default and the one that must not change),
 * `link` (an existing account, from `listUnlinkedSchoolUsers`) or `create` (a
 * new `school_users` row plus `queueAccessEmail` — the same path
 * `POST /api/school/invitations` takes, never `school_invitations`).
 *
 * The employment record is inserted **first** and is never rolled back. See
 * `lib/staff-portal-access.ts` for why the ordering is not symmetric with the
 * invite screen's.
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

      /*
       * BR4 — Sprint 23, item 3. A head sees their own campuses' staff.
       *
       * The *campus* half of the scope, because `staff` carries a branch and no
       * grade — see `ListStaffFilters.scopeBranchIds` for why that is the
       * honest narrowing rather than a contrived one.
       */
      const visible = await visibleScopeFor(auth);

      const [rows, departments] = await Promise.all([
        listStaff(auth.locationId, {
          scopeBranchIds: visible.branchIds,
          search: url.searchParams.get('search') ?? undefined,
          status: isStaffStatus(statusParam) ? statusParam : undefined,
          branchId: branchId ?? undefined,
          department: url.searchParams.get('department') ?? undefined,
          // `?linked=none` — the split records, and nothing else is a value.
          linked: url.searchParams.get('linked') === 'none' ? 'none' : undefined,
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
  portalAccess?: unknown;
}

/**
 * The three mutually exclusive answers to "does this person sign in?".
 *
 * `none` is the default and stays the default: a driver is on the payroll and
 * never signs in, and a form that implied otherwise would push a school back
 * onto a spreadsheet for half its staff.
 */
interface PortalAccessBody {
  mode?: unknown;
  role?: unknown;
  branchId?: unknown;
  schoolUserId?: unknown;
}

function readPortalAccess(value: unknown): PortalAccessBody {
  return typeof value === 'object' && value !== null ? (value as PortalAccessBody) : {};
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
      /*
       * The surname may be blank, and refusing it here was a dead end.
       *
       * `staff.last_name` is NOT NULL but an empty string satisfies that, and
       * `splitPersonName` leaves it empty on purpose for a one-word name — a
       * great many people in Pakistan are recorded under one. The Users & Staff
       * profile's "Add an employment record" button posts here with the split
       * already applied, so "Sikandar" was badged *No employment record* and
       * then refused by the button the badge points at, with a sentence naming
       * two fields that screen does not show.
       *
       * `POST /api/school/invitations` inserts the same split straight into
       * `staff` and has never had this guard, so the same person filed without
       * complaint from the other direction. One of the two was wrong; this was.
       *
       * The HR form itself is unaffected — `StaffManager` requires both fields
       * in the browser, which is the right place to ask a clerk typing a record
       * from scratch for a surname.
       */
      if (firstName === '') {
        return apiFailure('invalid_body', 'Enter the name.', 400);
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

      // Sprint 23, item 8. The identical rule `POST /api/school/invitations`
      // applies, through the identical function — see the note there.
      const joiningProblem = joiningDateProblem(joinedOn);
      if (joiningProblem !== null) {
        return apiFailure('invalid_body', joiningProblem, 400);
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

      /*
       * ── Portal access, decided before anything is written ───────────────
       *
       * `body.schoolUserId` is the pre-Sprint-22 shape and is still honoured:
       * the route has accepted it since Sprint 7 even though no screen ever
       * sent one, and a caller that does is asking to link.
       *
       * Everything that can be refused *without* costing the school its
       * employment record is refused here, before the insert — a role that is
       * not invitable, an address that is not an address, an account belonging
       * to another school. What is left for step 2 is the collision that only
       * the write can discover, and by then the record is worth keeping.
       */
      const portal = readPortalAccess(body.portalAccess);
      const legacySchoolUserId = readOptionalString(body.schoolUserId);
      const mode =
        portal.mode === 'create' || portal.mode === 'link'
          ? portal.mode
          : legacySchoolUserId !== null
            ? 'link'
            : 'none';

      let linkTarget: string | null = null;
      let pendingLogin: NewStaffLogin | null = null;

      if (mode === 'link') {
        const requested =
          readOptionalString(portal.schoolUserId) ?? legacySchoolUserId;
        if (requested === null) {
          return apiFailure('invalid_body', 'Choose a portal account to link.', 400);
        }

        const linkable = await accountLinkable(auth.locationId, requested, null);
        if (!linkable.ok) {
          return apiFailure('invalid_body', linkable.problem, 400);
        }
        linkTarget = requested;
      }

      if (mode === 'create') {
        /*
         * One screen, two permission keys. Creating a login from HR is a
         * `users.write` action wearing an HR form's clothes, and enforcing that
         * only in the component would leave the request itself unguarded.
         */
        if (!(await hasPermission(auth.locationId, auth.role, 'users.write'))) {
          return apiFailure(
            'forbidden',
            'Creating a portal login also needs permission to manage users. Save the employment record without one, and ask an administrator to add the login.',
            403,
          );
        }

        const requestedLoginBranch = readOptionalString(portal.branchId);
        const checked = await checkNewStaffLogin(auth.locationId, {
          role: portal.role,
          // A branch admin's own branch wins here exactly as it does over the
          // employment record above. Never the other way.
          branchId: auth.branchId ?? requestedLoginBranch ?? branchId,
          // The staff form's own fields, not a second pair. The person is one
          // person; asking for their address twice is how the two records
          // start disagreeing on the day they are created.
          name: `${firstName} ${lastName}`,
          phone: readString(body.phone),
          email: readString(body.email),
        });

        if (!checked.ok) {
          return apiFailure('invalid_body', checked.problem, 400);
        }
        pendingLogin = checked.login;
      }

      const created = await db
        .insert(staff)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          branchId,
          schoolUserId: linkTarget,
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

      const staffId = created[0].id;

      /*
       * Step 2. The employment record is committed and stays committed.
       *
       * A login that could not be created comes back as `portalAccess.linked:
       * false` with the reason, and the screen says the staff member was saved
       * and the login was not. The alternative — deleting the row we have just
       * written — loses the fact the school came to this screen to record.
       */
      if (pendingLogin !== null) {
        const outcome = await createLoginForStaff(
          auth.locationId,
          auth.uid,
          staffId,
          pendingLogin,
        );

        return apiSuccess({ staffId, portalAccess: outcome }, 201);
      }

      return apiSuccess(
        {
          staffId,
          portalAccess:
            linkTarget === null
              ? null
              : { linked: true, schoolUserId: linkTarget, delivery: null },
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.write' },
);
