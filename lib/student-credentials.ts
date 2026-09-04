import 'server-only';

import { randomInt } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { grades } from '@/db/schema/grades';
import { schoolUsers } from '@/db/schema/school-users';
import { schools } from '@/db/schema/schools';
import { sections } from '@/db/schema/sections';
import { studentEnrollments } from '@/db/schema/student-enrollments';
import { studentProfiles } from '@/db/schema/student-profiles';

import { getChatSchoolSettings } from './chat-queries';
import { db } from './drizzle';
import { getOrCreateAuthUser, setUserPassword } from './supabase-auth';

/**
 * Giving a pupil a way to sign in.
 *
 * ── The blocker this sprint had to clear ─────────────────────────────────
 * `lib/enrollment.ts` creates a `school_users` row for every pupil with no
 * email, no `auth_user_id`, and a sentinel phone (`student:GVS-2025-0001`)
 * deliberately shaped so `normalizePhone` can never produce it and it cannot be
 * used to request a passcode. A pupil is an addressable directory entry and not
 * an actor.
 *
 * Every control the chat brief described — the initiation toggle, the reply
 * window, the class opened for two hours — governs a person who, until this
 * file, had no way to reach the product at all.
 *
 * ── The address, and why `.invalid` ──────────────────────────────────────
 *
 *     <admission-number>@students.<school-slug>.invalid
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve. That is the whole
 * point: the address is an identity for GoTrue, and it is *provably* never a
 * delivery target, so no code path anywhere in this product can accidentally
 * email a minor. It is unique by construction, which satisfies `0038`'s partial
 * unique index on the active lowercased address.
 *
 * It lives in the existing `school_users.email` column and not in a new one. A
 * second address column would be a second thing for the login lookup to
 * disagree with, and `STATE.md` §5bk is the incident report about what that
 * costs: a father permanently signed in as his own daughter.
 *
 * ── The sentinel phone stays ─────────────────────────────────────────────
 * Nothing here touches it. It is what stops a pupil row shadowing a real number
 * at the login lookup, and issuing a credential does not make that less true.
 *
 * ── There is no self-service reset, and there must not be ────────────────
 * The address receives no mail, so the ordinary "email me a link" path cannot
 * work by construction. A pupil who forgets their password asks the school
 * office, which is the right answer anyway: it is the one identity check that
 * does not depend on an inbox a child may not control.
 */

/** The reserved TLD. RFC 2606: guaranteed never to resolve. */
const CREDENTIAL_DOMAIN_SUFFIX = 'invalid';

/**
 * A password a clerk can read down a corridor and a pupil can type.
 *
 * Four words would be better and there is no wordlist in this repository to
 * take them from. Eight characters from an alphabet with no `0`/`O`, `1`/`l`
 * or `5`/`S` is the compromise: it survives being written on a slip of paper
 * and read back, which is how it will actually be delivered.
 */
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZabcdefghjkmnpqrtuvwxyz23467889';
const PASSWORD_LENGTH = 10;

export function generateStudentPassword(): string {
  let password = '';
  for (let index = 0; index < PASSWORD_LENGTH; index += 1) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return password;
}

/** The address a pupil's credential is minted on. */
export function studentCredentialAddress(admissionNumber: string, schoolSlug: string): string {
  const local = admissionNumber.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
  return `${local}@students.${schoolSlug}.${CREDENTIAL_DOMAIN_SUFFIX}`;
}

/** Whether an address is one of ours. Used to keep these out of mail paths. */
export function isStudentCredentialAddress(email: string | null): boolean {
  return email !== null && email.toLowerCase().endsWith(`.${CREDENTIAL_DOMAIN_SUFFIX}`);
}

export interface IssueResult {
  ok: true;
  email: string;
  password: string;
  reissued: boolean;
}

export type IssueOutcome = IssueResult | { ok: false; problem: string };

/**
 * Issues — or reissues — a pupil's credential.
 *
 * Reissuing is the ordinary case, not an exception: a forgotten password is
 * answered by generating a new one at the office counter. The address never
 * changes, so the pupil's identity, their `auth_user_id` and everything hanging
 * off it survive the reset.
 */
export async function issueStudentCredential(
  locationId: string,
  studentProfileId: string,
): Promise<IssueOutcome> {
  const rows = await db
    .select({
      schoolUserId: studentProfiles.schoolUserId,
      admissionNumber: studentProfiles.studentId,
      existingEmail: schoolUsers.email,
      issuedAt: schoolUsers.studentCredentialIssuedAt,
      isActive: schoolUsers.isActive,
      slug: schools.slug,
    })
    .from(studentProfiles)
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .innerJoin(schools, eq(schools.locationId, studentProfiles.locationId))
    .where(
      and(
        eq(studentProfiles.locationId, locationId),
        eq(studentProfiles.id, studentProfileId),
      ),
    )
    .limit(1);

  const student = rows[0];
  if (student === undefined) return { ok: false, problem: 'No such student.' };
  if (!student.isActive) {
    return { ok: false, problem: 'That student’s account is not active.' };
  }

  const floorProblem = await gradeFloorProblem(locationId, studentProfileId);
  if (floorProblem !== null) return { ok: false, problem: floorProblem };

  const email =
    student.existingEmail !== null && isStudentCredentialAddress(student.existingEmail)
      ? student.existingEmail
      : studentCredentialAddress(student.admissionNumber, student.slug);

  // A pupil who already has a *real* address is not one of ours to overwrite —
  // that is a person the school has deliberately given an ordinary account, and
  // replacing it would take their mail away.
  if (
    student.existingEmail !== null &&
    student.existingEmail !== '' &&
    !isStudentCredentialAddress(student.existingEmail)
  ) {
    return {
      ok: false,
      problem:
        'That student already signs in with a real email address. Reset it from the user record instead.',
    };
  }

  const password = generateStudentPassword();

  const authUser = await getOrCreateAuthUser(email, { studentOf: locationId });
  await setUserPassword(authUser.id, password);

  await db
    .update(schoolUsers)
    .set({
      email,
      authUserId: authUser.id,
      studentCredentialIssuedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.id, student.schoolUserId)),
    );

  return { ok: true, email, password, reissued: student.issuedAt !== null };
}

/**
 * Why this pupil is below the school's threshold, or null.
 *
 * The floor is a `grades.sort_order` and not a grade id, because it is a floor:
 * the answer has to keep meaning the same thing after a grade is renamed, after
 * one is inserted below it, and across the campuses of a group that name their
 * grades differently.
 *
 * **Null in the settings means no pupil accounts at all**, and null is the
 * default. A school that has not answered the question has not agreed to issue
 * credentials to minors, and provisioning them because chat was switched on
 * would be deciding that on the school's behalf.
 */
export async function gradeFloorProblem(
  locationId: string,
  studentProfileId: string,
): Promise<string | null> {
  const settings = await getChatSchoolSettings(locationId);
  const floor = settings.studentLoginMinGradeSortOrder;

  if (floor === null) {
    return 'This school has not turned on student sign-in. Set the lowest class in Chat settings first.';
  }

  const rows = await db
    .select({ sortOrder: grades.sortOrder, gradeName: grades.name })
    .from(studentEnrollments)
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.studentProfileId, studentProfileId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .limit(1);

  const placement = rows[0];
  if (placement === undefined) {
    return 'That student is not enrolled in a class this year.';
  }

  if (placement.sortOrder < floor) {
    return `Sign-in is only issued from the class set in Chat settings upwards. ${placement.gradeName} is below it.`;
  }

  return null;
}
