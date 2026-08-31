import 'server-only';

import { eq } from 'drizzle-orm';

import { schoolUsers, schools } from '@/db/schema';

import { queueAccessEmail, type AccessEmailResult } from './access-email';
import { db } from './drizzle';
import { emailHolderAt, isEmailIndexConflict } from './school-queries';
import type { UserRole } from '@/types/school-auth';

/**
 * Creating a portal login, once, for every screen that creates one.
 *
 * ── Why this is a module and not three copies of the same twenty lines ───
 * There are now three places a `school_users` row is minted by hand: Invite
 * Staff, "Create a login" on the HR staff form, and "Create a login" on a staff
 * member's profile. Before Sprint 22 there was one, and it had drifted from
 * `POST /api/school/users` in a way nobody could see from either file:
 * `/api/school/invitations` still called `.onConflictDoNothing()` **untargeted**,
 * so migration `0038`'s partial unique index on `lower(email)` was swallowed
 * alongside the phone index and reported as *"Someone with that phone number
 * already exists at this school"* — about a number nobody held, with nothing on
 * the form to correct. Sprint 21's QA found and fixed that on `/users`, and the
 * invitation route was missed because the two were never the same code.
 *
 * They are now. The three guards travel together or not at all:
 *
 * 1. `emailHolderAt` **before** the write, so the school meets a sentence
 *    naming the person who holds the address rather than a SQLSTATE;
 * 2. `onConflictDoNothing` **targeted on the phone index**, so only the phone
 *    collision is swallowed and an address collision raises;
 * 3. `isEmailIndexConflict` in the catch, so the race between (1) and (2) — a
 *    second administrator, the same minute — still produces a sentence about
 *    the address.
 *
 * ── The mail is reported, never assumed ─────────────────────────────────
 * `queueAccessEmail`'s own `{ queued, reason }` comes back untouched. The
 * member exists either way and a transport that is down must not undo that, so
 * every caller renders the result. "Invited" over a message nobody queued is
 * the failure this shape exists to make impossible.
 */

export interface NewMemberAccount {
  /** From the verified session. Never from a body. */
  locationId: string;
  name: string;
  phone: string;
  email: string;
  role: UserRole;
  branchId: string | null;
  /** The administrator doing this, recorded on the row and the setup token. */
  invitedByUid: string;
}

export interface CreatedMember {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: string;
  authUserId: string | null;
}

export type MemberAccountResult =
  | { ok: true; member: CreatedMember; delivery: AccessEmailResult }
  | { ok: false; code: 'already_exists' | 'not_found'; message: string; status: number };

/**
 * Creates the `school_users` row and queues the set-password mail.
 *
 * Returns a refusal rather than throwing for the two conditions a school can
 * actually meet — the address is taken, the phone is taken — because every
 * caller has something of its own to say about them and one of them has already
 * written a `staff` row it must not roll back.
 */
export async function createMemberAccount(
  input: NewMemberAccount,
): Promise<MemberAccountResult> {
  const schoolRows = await db
    .select({ name: schools.name, slug: schools.slug })
    .from(schools)
    .where(eq(schools.locationId, input.locationId))
    .limit(1);

  const school = schoolRows[0];
  if (school === undefined) {
    return { ok: false, code: 'not_found', message: 'School not found.', status: 404 };
  }

  const holder = await emailHolderAt(input.locationId, input.email);
  if (holder !== null) {
    return {
      ok: false,
      code: 'already_exists',
      status: 409,
      message: `${holder.name} already uses that email address at this school, and one address can open only one account.`,
    };
  }

  let inserted;
  try {
    inserted = await db
      .insert(schoolUsers)
      .values({
        // Tenant comes from the verified session, never from the body.
        locationId: input.locationId,
        name: input.name,
        phone: input.phone,
        email: input.email,
        role: input.role,
        branchId: input.branchId,
        invitedByUid: input.invitedByUid,
      })
      // Targeted, so only the phone collision is swallowed. See the docblock.
      .onConflictDoNothing({ target: [schoolUsers.locationId, schoolUsers.phone] })
      .returning({
        id: schoolUsers.id,
        name: schoolUsers.name,
        phone: schoolUsers.phone,
        email: schoolUsers.email,
        role: schoolUsers.role,
        authUserId: schoolUsers.authUserId,
      });
  } catch (error) {
    if (!isEmailIndexConflict(error)) throw error;
    return {
      ok: false,
      code: 'already_exists',
      status: 409,
      message:
        'Somebody else at this school was just given that email address. One address can open only one account.',
    };
  }

  const member = inserted[0];
  if (member === undefined) {
    return {
      ok: false,
      code: 'already_exists',
      status: 409,
      message: 'Someone with that phone number already exists at this school.',
    };
  }

  const delivery = await queueAccessEmail({
    locationId: input.locationId,
    school: { name: school.name, slug: school.slug },
    member: {
      id: member.id,
      name: member.name,
      email: member.email,
      authUserId: member.authUserId,
    },
    createdBy: input.invitedByUid,
  });

  return { ok: true, member, delivery };
}
