import 'server-only';

import { and, eq, isNull, ne, or } from 'drizzle-orm';

import { branches, schoolUsers, staff } from '@/db/schema';

import type { AccessEmailResult } from './access-email';
import { db } from './drizzle';
import { isValidEmail, normalizeEmail } from './password-strength';
import { hasCompletePhoneOfAnyKind, normalisePhoneOfAnyKind } from './phone-formats';
import { createMemberAccount } from './school-member-accounts';
import { isUuid } from './validation';
import {
  BRANCH_REQUIRED_ROLES,
  INVITABLE_ROLES,
  isUserRole,
  type UserRole,
} from '@/types/school-auth';

/**
 * The two halves of a person, joined — `staff.school_user_id`.
 *
 * ── Why the join matters, in one sentence each ──────────────────────────
 * `timetable_entries.teacher_id` points at `school_users`: no login, no
 * periods. `sections.class_teacher_id` points at `staff`: no employment
 * record, cannot be a home-room teacher. A teacher needs both rows, the column
 * that says they are the same person has existed since Sprint 7, and until
 * Sprint 22 no screen in the product ever set it.
 *
 * ── The ordering rule, and it is not symmetric ──────────────────────────
 * Whichever record is the *point of the screen you are on* is written first
 * and is never rolled back. From HR that is the employment record; from Invite
 * Staff it is the account. The second half failing is reported in words, with
 * the reason and a way to finish the job — the same stance `enrollStudent`
 * takes over the sibling auto-grant (STATE.md §5bj). A person recorded is a
 * fact; a login that did not go out is one click from their profile.
 *
 * ── One staff row per account, enforced here ────────────────────────────
 * `staff.school_user_id` has no unique index and this sprint deliberately adds
 * none — an index would need a migration, and a partial unique index over a
 * nullable column is a change to a live table for a rule three code paths can
 * state. So every path that sets the column checks first that no other `staff`
 * row of the same tenant already claims that account. Two administrators on
 * the same minute can still both pass that check; the consequence is a
 * duplicate employment record, which is visible, repairable and not a security
 * boundary. A wrong *tenant* would be, and that is checked against the
 * database rather than against a body.
 */

export type PortalAccessOutcome =
  | { linked: true; schoolUserId: string; delivery: AccessEmailResult | null }
  /** Nothing was linked. `problem` is a sentence for whoever is at the screen. */
  | { linked: false; problem: string };

/** Whether the account exists at this tenant and is free to be linked. */
export async function accountLinkable(
  locationId: string,
  schoolUserId: string,
  exceptStaffId: string | null,
): Promise<{ ok: true } | { ok: false; problem: string }> {
  if (!isUuid(schoolUserId)) {
    return { ok: false, problem: 'That portal account does not exist.' };
  }

  const owner = await db
    .select({ id: schoolUsers.id, isActive: schoolUsers.isActive })
    .from(schoolUsers)
    .where(
      and(eq(schoolUsers.id, schoolUserId), eq(schoolUsers.locationId, locationId)),
    )
    .limit(1);

  // The tenant check reads the database rather than trusting the body: an id
  // from another school would otherwise be linked straight into this one's
  // staff directory by a foreign key that has no opinion about tenancy.
  if (owner[0] === undefined) {
    return { ok: false, problem: 'That portal account does not exist.' };
  }

  if (!owner[0].isActive) {
    return {
      ok: false,
      problem:
        'That account is deactivated. Reactivate it from Users & Staff before linking it to an employment record.',
    };
  }

  const claimed = await db
    .select({ id: staff.id, employeeCode: staff.employeeCode })
    .from(staff)
    .where(
      and(
        eq(staff.locationId, locationId),
        eq(staff.schoolUserId, schoolUserId),
        exceptStaffId === null ? undefined : ne(staff.id, exceptStaffId),
      ),
    )
    .limit(1);

  if (claimed[0] !== undefined) {
    return {
      ok: false,
      problem: `That account is already linked to employment record ${claimed[0].employeeCode}.`,
    };
  }

  return { ok: true };
}

/**
 * Writes the join, and only onto a record nobody else has claimed.
 *
 * The `school_user_id IS NULL` in the `WHERE` is not decoration: it is what
 * makes a second click, or a second tab, land on **nothing** rather than
 * quietly moving a link somebody else has just made. `OR school_user_id =
 * <target>` makes the same request idempotent instead of an error, which is
 * what a retried request deserves.
 *
 * One statement for both callers on purpose. Two nearly-identical `UPDATE`s in
 * one file is how a predicate gets fixed in one of them, and it is also how a
 * check script ends up executing one and reading the other — the exact failure
 * CLAUDE.md records shipping three times.
 *
 * Returns the row's id, or null when nothing was claimed.
 */
async function claimStaffLink(
  locationId: string,
  staffId: string,
  schoolUserId: string,
): Promise<string | null> {
  const updated = await db
    .update(staff)
    .set({ schoolUserId, updatedAt: new Date() })
    .where(
      and(
        eq(staff.id, staffId),
        eq(staff.locationId, locationId),
        or(isNull(staff.schoolUserId), eq(staff.schoolUserId, schoolUserId)),
      ),
    )
    .returning({ id: staff.id });

  return updated[0]?.id ?? null;
}

/**
 * Points an existing employment record at an existing portal account.
 */
export async function linkAccountToStaff(
  locationId: string,
  staffId: string,
  schoolUserId: string,
): Promise<PortalAccessOutcome> {
  const linkable = await accountLinkable(locationId, schoolUserId, staffId);
  if (!linkable.ok) return { linked: false, problem: linkable.problem };

  const updated = await claimStaffLink(locationId, staffId, schoolUserId);

  if (updated === null) {
    return {
      linked: false,
      problem:
        'That employment record is already linked to a different account. Unlink it first.',
    };
  }

  return { linked: true, schoolUserId, delivery: null };
}

export interface NewStaffLogin {
  role: UserRole;
  branchId: string | null;
  name: string;
  phone: string;
  email: string;
}

/**
 * Validates the "Create a login" half of a staff form.
 *
 * Returns the sentence to show rather than throwing, because the caller may
 * already have written the employment record and must not lose it over a
 * mistyped address.
 */
export async function checkNewStaffLogin(
  locationId: string,
  input: {
    role: unknown;
    branchId: string | null;
    name: string;
    phone: string;
    email: string;
  },
): Promise<{ ok: true; login: NewStaffLogin } | { ok: false; problem: string }> {
  /*
   * `INVITABLE_ROLES`, not `USER_ROLES`. `student` and `parent` accounts come
   * from the admissions flow alongside a student record, and a bare one of
   * either produces a login that can see nothing — which is why the invite
   * screen has never offered them and why an HR form must not either.
   */
  if (!isUserRole(input.role) || !INVITABLE_ROLES.includes(input.role)) {
    return { ok: false, problem: 'Select a role for the login.' };
  }

  if (input.name.trim() === '') {
    return { ok: false, problem: 'Enter the name the login is created against.' };
  }

  /*
   * Both are required in this mode and the form says why on screen: under
   * Supabase Auth the address *is* the identity the account is keyed by, and
   * `school_users.phone` is NOT NULL and unique per school. Neither is true of
   * an employment record, which is why "No login needed" asks for neither.
   */
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    return {
      ok: false,
      problem: 'A valid email address is required to create a login — it is what the account is keyed by.',
    };
  }

  const phone = normalisePhoneOfAnyKind(input.phone);
  if (!hasCompletePhoneOfAnyKind(phone)) {
    return {
      ok: false,
      problem:
        'A complete phone number is required to create a login — a mobile as (0321) 123-4567, or a landline as (021) 3456789.',
    };
  }

  if (BRANCH_REQUIRED_ROLES.includes(input.role) && input.branchId === null) {
    return { ok: false, problem: 'That role must be assigned to a branch.' };
  }

  if (input.branchId !== null) {
    if (!isUuid(input.branchId)) {
      return { ok: false, problem: 'That branch does not exist.' };
    }

    const owned = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, input.branchId), eq(branches.locationId, locationId)))
      .limit(1);

    if (owned[0] === undefined) {
      return { ok: false, problem: 'That branch does not exist.' };
    }
  }

  return {
    ok: true,
    login: {
      role: input.role,
      branchId: input.branchId,
      name: input.name.trim(),
      phone,
      email,
    },
  };
}

/**
 * Creates a portal account for an employment record that already exists.
 *
 * Step 2 of the HR ordering. The `staff` row is already committed, so a
 * failure here is reported and the record kept — see the module docblock.
 */
export async function createLoginForStaff(
  locationId: string,
  invitedByUid: string,
  staffId: string,
  login: NewStaffLogin,
): Promise<PortalAccessOutcome> {
  const created = await createMemberAccount({
    locationId,
    invitedByUid,
    name: login.name,
    phone: login.phone,
    email: login.email,
    role: login.role,
    branchId: login.branchId,
  });

  if (!created.ok) return { linked: false, problem: created.message };

  const updated = await claimStaffLink(locationId, staffId, created.member.id);

  if (updated === null) {
    /*
     * The account exists and the mail has gone; only the join failed, and it
     * failed because somebody linked this record while the request was in
     * flight. Saying so beats deleting the account, which would revoke a login
     * whose set-password mail is already in somebody's inbox.
     */
    return {
      linked: false,
      problem:
        'The login was created and the set-password email queued, but this employment record was linked to another account meanwhile. Link them from the profile.',
    };
  }

  return { linked: true, schoolUserId: created.member.id, delivery: created.delivery };
}

/** Clears the join. The two records both survive; only the link goes. */
export async function unlinkAccountFromStaff(
  locationId: string,
  staffId: string,
): Promise<boolean> {
  const updated = await db
    .update(staff)
    .set({ schoolUserId: null, updatedAt: new Date() })
    .where(and(eq(staff.id, staffId), eq(staff.locationId, locationId)))
    .returning({ id: staff.id });

  return updated[0] !== undefined;
}
