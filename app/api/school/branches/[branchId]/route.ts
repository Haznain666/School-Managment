import { and, count, eq } from 'drizzle-orm';

import {
  branches,
  grades,
  isCurriculumLevel,
  ledgerTransactions,
  schoolUsers,
  sections,
  staff,
  studentEnrollments,
} from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { sanitiseClassLevels } from '@/lib/branch-classes';
import { resolveBranchScope, scopeAdmitsWrite } from '@/lib/branch-scope';
import { demoteOtherMainBranches } from '@/lib/branches';
import { isPakistaniCity } from '@/lib/cities';
import { db } from '@/lib/drizzle';
import {
  readCoordinate,
  readEmailField,
  readLandlineField,
  readMobileField,
} from '@/lib/profile-fields';
import { isUuid, readOptionalString, readString } from '@/lib/validation';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/branches/[branchId] — a school editing its own campus.
 *
 * GET    one campus
 * PATCH  edit it
 * DELETE erase it, or refuse and say what is attached
 *
 * ── Why this exists (Sprint 19a, item 8) ─────────────────────────────────
 * Until now a school could *create* a campus and never touch it again: editing
 * and deleting lived only in the Super Admin panel, behind a login no school
 * has. A campus name typed with a spelling mistake, a landline that changed, a
 * duplicate created while somebody was learning the product — every one of them
 * was a support ticket.
 *
 * ── `branches.manage`, not `settings.write` ──────────────────────────────
 * Creating stays on `settings.write` where it has been since Sprint 10.5, so a
 * school that has never opened the permissions screen can still make its first
 * campus exactly as it could yesterday. Editing and deleting are the new key,
 * default `school_admin` only — a campus administrator editing the campus
 * record is editing the boundary they are confined by, and `resolveBranchScope`
 * reads that boundary on every request.
 *
 * ── Every query is filtered by `location_id` *and* `id` ──────────────────
 * A branch UUID belonging to another school cannot be read or written through
 * this school's session. `auth.locationId` is the only tenant value used and it
 * comes from the verified session, never the URL.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ branchId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { branchId } = await context.params;
      if (!isUuid(branchId)) return apiFailure('not_found', 'Branch not found.', 404);

      const rows = await db
        .select()
        .from(branches)
        .where(and(eq(branches.id, branchId), eq(branches.locationId, auth.locationId)))
        .limit(1);

      const branch = rows[0];
      if (branch === undefined) return apiFailure('not_found', 'Branch not found.', 404);

      return apiSuccess({ branch });
    } catch (error) {
      return handleApiError(error);
    }
  },
  // Any signed-in member may read a campus record: it is the address and the
  // landline printed on their own vouchers, and every branch picker in the
  // product already shows the names.
  { allowedRoles: USER_ROLES },
);

interface UpdateBranchBody {
  name?: unknown;
  code?: unknown;
  city?: unknown;
  address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  landline?: unknown;
  phone?: unknown;
  email?: unknown;
  curriculumLevel?: unknown;
  boardName?: unknown;
  classLevels?: unknown;
  isMainBranch?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { branchId } = await context.params;
      if (!isUuid(branchId)) return apiFailure('not_found', 'Branch not found.', 404);

      /*
       * Item 2e. A campus outside the caller's scope is refused before anything
       * is read, not after — the same guard the timetable route has applied to
       * period structures since Sprint 12, and for the same reason: a stale tab
       * left open across a reassignment writes a row that satisfies every
       * constraint and then appears in no listing.
       */
      const scope = await resolveBranchScope(auth.locationId, auth);
      if (!scopeAdmitsWrite(scope, branchId)) {
        return apiFailure('forbidden', 'That campus is not one you can edit.', 403);
      }

      const body = await readJsonBody<UpdateBranchBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      /*
       * The row as it stands, needed before anything is validated.
       *
       * `classLevels` has to be filtered against the curriculum this branch
       * will *end up* on — the one in the body when it names one, the stored
       * one otherwise — and getting that wrong either drops rungs the operator
       * just ticked or keeps ones the new curriculum has never had.
       * `boardName` has the same problem in reverse: a patch switching a branch
       * to MIXED must demand a board name even though the field it is checking
       * is not in the body. Identical reasoning to the Super Admin route, which
       * is why the two read the same way.
       */
      const existingRows = await db
        .select({
          curriculumLevel: branches.curriculumLevel,
          boardName: branches.boardName,
          classLevels: branches.classLevels,
        })
        .from(branches)
        .where(and(eq(branches.id, branchId), eq(branches.locationId, auth.locationId)))
        .limit(1);

      const existing = existingRows[0];
      if (existing === undefined) return apiFailure('not_found', 'Branch not found.', 404);

      const updates: Partial<typeof branches.$inferInsert> = {};

      if (body.name !== undefined) {
        const name = readString(body.name);
        if (name === '') {
          return apiFailure('invalid_body', 'Branch name cannot be empty.', 400);
        }
        updates.name = name;
      }

      if (body.code !== undefined) {
        const code = readString(body.code).toUpperCase();
        if (code === '') {
          return apiFailure('invalid_body', 'Branch code cannot be empty.', 400);
        }
        updates.code = code;
      }

      if (body.city !== undefined) {
        const city = readString(body.city);
        if (!isPakistaniCity(city)) {
          return apiFailure('invalid_body', 'Select a city from the list.', 400);
        }
        updates.city = city;
      }

      if (body.curriculumLevel !== undefined) {
        if (!isCurriculumLevel(body.curriculumLevel)) {
          return apiFailure(
            'invalid_body',
            'curriculumLevel must be MATRIC, O_LEVELS, A_LEVELS or MIXED.',
            400,
          );
        }
        updates.curriculumLevel = body.curriculumLevel;
      }

      const curriculum = updates.curriculumLevel ?? existing.curriculumLevel;

      if (body.boardName !== undefined || updates.curriculumLevel !== undefined) {
        const boardName =
          body.boardName === undefined
            ? existing.boardName
            : readOptionalString(body.boardName);

        if (curriculum === 'MIXED' && boardName === null) {
          return apiFailure(
            'invalid_body',
            'Name the board this campus follows. “Mixed” on its own does not say which.',
            400,
          );
        }

        updates.boardName = curriculum === 'MIXED' ? boardName : null;
      }

      if (body.classLevels !== undefined) {
        updates.classLevels = sanitiseClassLevels(body.classLevels, curriculum);
      } else if (updates.curriculumLevel !== undefined) {
        updates.classLevels = sanitiseClassLevels(existing.classLevels, curriculum);
      }

      if (body.address !== undefined) updates.address = readOptionalString(body.address);
      if (body.latitude !== undefined) {
        updates.latitude = readCoordinate(body.latitude, 'latitude');
      }
      if (body.longitude !== undefined) {
        updates.longitude = readCoordinate(body.longitude, 'longitude');
      }

      if (body.landline !== undefined) {
        const landline = readLandlineField(body.landline);
        if (!landline.ok) return apiFailure('invalid_body', landline.message, 400);
        updates.landline = landline.value;
      }

      if (body.phone !== undefined) {
        const phone = readMobileField(body.phone);
        if (!phone.ok) return apiFailure('invalid_body', phone.message, 400);
        updates.phone = phone.value;
      }

      if (body.email !== undefined) {
        const email = readEmailField(body.email);
        if (!email.ok) return apiFailure('invalid_body', email.message, 400);
        updates.email = email.value;
      }

      if (typeof body.isMainBranch === 'boolean') {
        updates.isMainBranch = body.isMainBranch;
      }

      /*
       * `isActive` is deliberately absent, and this is the one place the school
       * route differs from the operator's. Inside the portal an inactive campus
       * is simply invisible — it disappears from every picker, including the
       * one on this very form — so a school administrator who switched it off
       * would have hidden a campus with no screen left that shows it again.
       * `components/super-admin/BranchForm.tsx` makes the same argument about
       * the toggle it hides.
       */

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      updates.updatedAt = new Date();

      const updated = await db
        .update(branches)
        .set(updates)
        .where(and(eq(branches.id, branchId), eq(branches.locationId, auth.locationId)))
        .returning();

      const branch = updated[0];
      if (branch === undefined) return apiFailure('not_found', 'Branch not found.', 404);

      if (updates.isMainBranch === true) {
        await demoteOtherMainBranches(auth.locationId, branch.id);
      }

      return apiSuccess({ branch });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'branches.manage' },
);

/**
 * DELETE — erase a campus, or refuse and say what is attached.
 *
 * ── Why a refusal and not a cascade ──────────────────────────────────────
 * The foreign keys pointing at `branches.id` fall into two groups and both are
 * dangerous, in opposite directions.
 *
 * Most are **`ON DELETE SET NULL`** — `staff`, `school_users`,
 * `school_invitations`, `payroll_runs`, `payslips`, and the nine catalogue
 * tables Sprint 19a added. Postgres would happily delete a busy campus and
 * quietly detach its teachers and their payroll history from any campus at
 * all. Nothing would error. The rows would simply become school-wide, appear
 * in every campus filter, and there would be no record of where they were.
 *
 * `grades` is the other group: **`ON DELETE CASCADE`**, and `sections` and
 * `fee_structures` cascade from `grades` in turn. So deleting a campus does
 * not detach its classes — it destroys them, along with every section and the
 * whole price list, silently and with nothing left to say they existed.
 * `student_enrollments.section_id` has no cascade, which is the only reason a
 * campus with a child enrolled in it is refused at all: Postgres raises a
 * foreign-key violation, caught below. That is a backstop, not a design. A
 * campus that is fully configured but not yet enrolled trips none of it, and
 * `grades` is counted above precisely so that case is refused by this route
 * with a sentence rather than by nothing at all.
 *
 * **A campus with a child enrolled in it is not a row anybody may drop.** So it
 * is a **409** naming the counts, with *deactivate instead* offered in the same
 * sentence — and deactivating is a platform operator's control, which is why
 * the message says who to ask rather than offering a button this route does not
 * have.
 *
 * The ledger is counted alongside the people, and it is the one that can be
 * non-zero when nobody is left: a campus closed at the end of a year still has
 * every rupee it took recorded against it, and `ledger_transactions` is
 * append-only by the rule in CLAUDE.md. Deleting the campus would leave those
 * postings pointing at nothing.
 *
 * ── The code, typed ──────────────────────────────────────────────────────
 * Every school group has two campuses called "Main". A yes/no box is clicked
 * through; a code that has to be typed is read. The same reasoning as the
 * student delete's admission number (§5bf) and the school delete's name.
 */
export const DELETE = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { branchId } = await context.params;
      if (!isUuid(branchId)) return apiFailure('not_found', 'Branch not found.', 404);

      const scope = await resolveBranchScope(auth.locationId, auth);
      if (!scopeAdmitsWrite(scope, branchId)) {
        return apiFailure('forbidden', 'That campus is not one you can delete.', 403);
      }

      const existing = await db
        .select({ id: branches.id, name: branches.name, code: branches.code })
        .from(branches)
        .where(and(eq(branches.id, branchId), eq(branches.locationId, auth.locationId)))
        .limit(1);

      const branch = existing[0];
      if (branch === undefined) return apiFailure('not_found', 'Branch not found.', 404);

      const body = await readJsonBody<{ confirmCode?: unknown }>(request);
      if (readString(body?.confirmCode).toUpperCase() !== branch.code.toUpperCase()) {
        return apiFailure(
          'confirmation_required',
          `To delete this campus, type its code exactly: ${branch.code}.`,
          400,
        );
      }

      /*
       * ── Count what a campus actually holds, not what it used to ─────────
       * This counted `students.branch_id`, and `students` is the minimal
       * Sprint 1 table that **nothing in the product has ever inserted into**
       * — enrolment writes `student_profiles` and `student_enrollments`. So
       * the count was zero at every school, and the refusal below could never
       * say "still has 12 students" however full the campus was.
       *
       * A child reaches a campus the way every other query reaches it: through
       * their section's grade. `student_enrollments.section_id` has no cascade,
       * so Postgres does block the delete once a child is enrolled — but it
       * blocks it as a caught foreign-key error and a vague sentence about
       * "classes, timetables or exams", when the true answer is twelve
       * children. A refusal that cannot name what it is protecting reads as an
       * obstacle rather than a reason.
       *
       * `grades` is counted for the case Postgres does **not** catch: a campus
       * configured but not yet enrolled. `grades`, `sections` and
       * `fee_structures` all cascade from a branch, so deleting one of those
       * silently destroys the whole ladder and the price list with it, raises
       * nothing, and leaves no record that any of it existed.
       */
      const [studentRows, staffRows, memberRows, ledgerRows, gradeRows] = await Promise.all([
        db
          .select({ value: count() })
          .from(studentEnrollments)
          .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
          .innerJoin(grades, eq(grades.id, sections.gradeId))
          .where(
            and(
              eq(grades.branchId, branchId),
              eq(studentEnrollments.locationId, auth.locationId),
              eq(studentEnrollments.status, 'active'),
            ),
          ),
        db.select({ value: count() }).from(staff).where(eq(staff.branchId, branchId)),
        db
          .select({ value: count() })
          .from(schoolUsers)
          .where(eq(schoolUsers.branchId, branchId)),
        db
          .select({ value: count() })
          .from(ledgerTransactions)
          .where(eq(ledgerTransactions.branchId, branchId)),
        db
          .select({ value: count() })
          .from(grades)
          .where(and(eq(grades.branchId, branchId), eq(grades.locationId, auth.locationId))),
      ]);

      const attached = [
        { n: studentRows[0]?.value ?? 0, one: 'enrolled student', many: 'enrolled students' },
        { n: gradeRows[0]?.value ?? 0, one: 'class', many: 'classes' },
        { n: staffRows[0]?.value ?? 0, one: 'staff member', many: 'staff' },
        { n: memberRows[0]?.value ?? 0, one: 'portal member', many: 'portal members' },
        {
          n: ledgerRows[0]?.value ?? 0,
          one: 'ledger entry',
          many: 'ledger entries',
        },
      ].filter((entry) => entry.n > 0);

      if (attached.length > 0) {
        const listed = attached
          .map((entry) => `${entry.n} ${entry.n === 1 ? entry.one : entry.many}`)
          .join(', ');

        return apiFailure(
          'in_use',
          `${branch.name} still has ${listed} attached to it, so it cannot be deleted — ` +
            'deleting it would detach every one of them from any campus at all, with ' +
            'no record of where they were. Move them to another campus first, or ask ' +
            'your platform operator to deactivate this one instead, which keeps ' +
            'everything and simply hides the campus.',
          409,
        );
      }

      /*
       * `grades` cascades from a branch, and grades are referenced by sections,
       * enrolments and exams which do not. So a campus with a grade ladder but
       * no people can still be refused by Postgres itself. That refusal is
       * caught and reported rather than surfacing as a 500 — the same treatment
       * `deleteSchoolMember` gives a referenced member.
       */
      try {
        const removed = await db
          .delete(branches)
          .where(and(eq(branches.id, branchId), eq(branches.locationId, auth.locationId)))
          .returning({ id: branches.id });

        if (removed[0] === undefined) {
          return apiFailure('not_found', 'Branch not found.', 404);
        }
      } catch {
        return apiFailure(
          'in_use',
          `${branch.name} still has classes, timetables or exams filed against it, so ` +
            'it cannot be deleted. Ask your platform operator to deactivate it instead.',
          409,
        );
      }

      return apiSuccess({ deleted: true, branchId });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'branches.manage' },
);
