import 'server-only';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  schoolUsers,
  schools,
  studentEnrollments,
  studentGuardians,
  studentProfiles,
} from '@/db/schema';

import { queueAccessEmail } from './access-email';
import { db } from './drizzle';

/**
 * Parent portal accounts, and the welcome that carries the link to them.
 *
 * ── The defect this exists to close ──────────────────────────────────────
 * A guardian was a contact record and nothing more. `student_guardians` held a
 * father's name, phone and address; `school_users` — the only table that can
 * sign anybody in — held nothing for him, and no code path ever put anything
 * there. So the parent portal existed, was routed, was permissioned, had six
 * screens, and had no way for a single parent to reach it. The profile page
 * said "No portal account" beside every guardian in the system and nothing on
 * screen suggested that was a state anyone could leave.
 *
 * This module is the missing half: it creates the `school_users` row with role
 * `parent`, links it back to the guardian, and queues the first-time setup
 * email that lets them choose a password. It is the same mechanism staff have
 * had since §5g — `lib/access-email.ts` — with parent wording.
 *
 * ── Why an email address, and only an email address ──────────────────────
 * Under Supabase Auth the address *is* the identity: it keys the account and it
 * is where the code goes. A guardian with no address cannot be given an account
 * at all, so they are skipped and reported, never failed. Most guardians on a
 * Pakistani school roll have a phone and no email, and an enrollment that
 * refused to complete without one would be worse than the defect it fixed.
 *
 * ── One account, however many children ───────────────────────────────────
 * Keyed on the phone number within the school, which is what
 * `school_users_location_id_phone_idx` already enforces. A father with three
 * children at the school gets one login that shows all three, and
 * `student_guardians.school_user_id` is what the parent portal follows to find
 * them. `welcome_email_sent_at` on the guardian row is what stops him being
 * welcomed once per child.
 */

export interface ProvisionResult {
  guardianId: string;
  guardianName: string;
  /** Null when the guardian has no address and so got no account. */
  schoolUserId: string | null;
  /** True when a welcome was written to `email_outbox` by this call. */
  emailQueued: boolean;
  /** Safe to show an administrator. Null when everything worked. */
  reason: string | null;
}

interface GuardianRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  schoolUserId: string | null;
  welcomeEmailSentAt: Date | null;
  studentProfileId: string;
}

async function loadSchool(
  locationId: string,
): Promise<{ name: string; slug: string } | null> {
  const rows = await db
    .select({ name: schools.name, slug: schools.slug })
    .from(schools)
    .where(eq(schools.locationId, locationId))
    .limit(1);

  return rows[0] ?? null;
}

/** The names on this parent's children, for the welcome. */
async function childNamesFor(
  locationId: string,
  guardianPhone: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ name: schoolUsers.name })
    .from(studentGuardians)
    .innerJoin(
      studentProfiles,
      eq(studentProfiles.id, studentGuardians.studentProfileId),
    )
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        eq(studentGuardians.phone, guardianPhone),
      ),
    );

  return rows.map((row) => row.name);
}

/**
 * Gives one guardian a portal account and queues their welcome.
 *
 * Idempotent in both halves. An existing `school_users` row on the same phone
 * is reused rather than duplicated — it may already be there because the
 * enrollment linked it, or because the same person is a teacher at the school —
 * and a guardian whose `welcome_email_sent_at` is already stamped is linked but
 * not mailed again.
 *
 * Never throws for an expected condition. Every caller has already committed
 * something more important than an email — an admission, a payment — and none
 * of them should roll that back because SMTP is unconfigured.
 */
export async function provisionGuardianPortalAccess(input: {
  locationId: string;
  guardianId: string;
  /** Auth uid recorded on the setup token, for the audit trail. */
  actorUid: string;
  /** Send even if `welcome_email_sent_at` is already stamped. */
  force?: boolean;
}): Promise<ProvisionResult> {
  const { locationId, guardianId, actorUid } = input;

  const guardianRows = await db
    .select({
      id: studentGuardians.id,
      name: studentGuardians.name,
      phone: studentGuardians.phone,
      email: studentGuardians.email,
      schoolUserId: studentGuardians.schoolUserId,
      welcomeEmailSentAt: studentGuardians.welcomeEmailSentAt,
      studentProfileId: studentGuardians.studentProfileId,
    })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        eq(studentGuardians.id, guardianId),
      ),
    )
    .limit(1);

  const guardian: GuardianRow | undefined = guardianRows[0];
  if (guardian === undefined) {
    return {
      guardianId,
      guardianName: '',
      schoolUserId: null,
      emailQueued: false,
      reason: 'That guardian is no longer on this student’s record.',
    };
  }

  const email = (guardian.email ?? '').trim();
  if (email === '') {
    return {
      guardianId: guardian.id,
      guardianName: guardian.name,
      schoolUserId: guardian.schoolUserId,
      emailQueued: false,
      reason: `${guardian.name} has no email address on file, so there is no parent portal account to open. Add one and send the invite from this page.`,
    };
  }

  const school = await loadSchool(locationId);
  if (school === null) {
    return {
      guardianId: guardian.id,
      guardianName: guardian.name,
      schoolUserId: guardian.schoolUserId,
      emailQueued: false,
      reason: 'This school record is unavailable.',
    };
  }

  /*
   * Upsert on (location, phone) rather than insert.
   *
   * That index already exists and already means "one person per school". The
   * conflict path deliberately does NOT overwrite `role`: the same number may
   * belong to a teacher who is also a parent at the school they work at, and
   * demoting her to `parent` would take away her register. It fills in the
   * address if the existing row had none, because an account with no address
   * cannot sign in and that is the whole point of this call.
   */
  const upserted = await db
    .insert(schoolUsers)
    .values({
      locationId,
      name: guardian.name,
      phone: guardian.phone,
      email,
      role: 'parent',
      invitedByUid: actorUid,
      invitedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schoolUsers.locationId, schoolUsers.phone],
      set: {
        email: sql`COALESCE(NULLIF(${schoolUsers.email}, ''), ${email})`,
        isActive: true,
        updatedAt: new Date(),
      },
    })
    .returning({
      id: schoolUsers.id,
      name: schoolUsers.name,
      email: schoolUsers.email,
      authUserId: schoolUsers.authUserId,
    });

  const account = upserted[0];
  if (account === undefined) {
    return {
      guardianId: guardian.id,
      guardianName: guardian.name,
      schoolUserId: guardian.schoolUserId,
      emailQueued: false,
      reason: `Could not open a portal account for ${guardian.name}.`,
    };
  }

  // Link every guardian row on this number, not only the one asked about: the
  // same father recorded against three children is three rows, and the parent
  // portal finds his children by following all of them.
  await db
    .update(studentGuardians)
    .set({ schoolUserId: account.id })
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        eq(studentGuardians.phone, guardian.phone),
        isNull(studentGuardians.schoolUserId),
      ),
    );

  if (guardian.welcomeEmailSentAt !== null && input.force !== true) {
    return {
      guardianId: guardian.id,
      guardianName: guardian.name,
      schoolUserId: account.id,
      emailQueued: false,
      reason: null,
    };
  }

  const outcome = await queueAccessEmail({
    locationId,
    school,
    member: {
      id: account.id,
      name: account.name,
      email: account.email,
      authUserId: account.authUserId,
    },
    createdBy: actorUid,
    audience: 'parent',
    childNames: await childNamesFor(locationId, guardian.phone),
  });

  if (!outcome.queued) {
    return {
      guardianId: guardian.id,
      guardianName: guardian.name,
      schoolUserId: account.id,
      emailQueued: false,
      reason: outcome.reason,
    };
  }

  // Stamped only after the queue accepted it, so a failure leaves the guardian
  // owed a welcome rather than silently marked as having had one.
  await db
    .update(studentGuardians)
    .set({ welcomeEmailSentAt: new Date() })
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        eq(studentGuardians.phone, guardian.phone),
      ),
    );

  return {
    guardianId: guardian.id,
    guardianName: guardian.name,
    schoolUserId: account.id,
    emailQueued: true,
    reason: null,
  };
}

/**
 * Welcomes every guardian of one student who is still owed one.
 *
 * This is what the fee gate calls. It runs over the guardians rather than over
 * the student because the account belongs to the parent: a family clearing the
 * fee for their second child welcomes nobody new, which is correct — the
 * parents already have the login that now shows two children instead of one.
 */
export async function welcomeStudentGuardians(input: {
  locationId: string;
  studentProfileId: string;
  actorUid: string;
}): Promise<ProvisionResult[]> {
  const rows = await db
    .select({ id: studentGuardians.id })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.locationId, input.locationId),
        eq(studentGuardians.studentProfileId, input.studentProfileId),
        isNull(studentGuardians.welcomeEmailSentAt),
      ),
    );

  const results: ProvisionResult[] = [];

  // Sequential rather than Promise.all: two guardians sharing one phone number
  // — which happens, a household with one mobile — would otherwise race on the
  // same upsert and one of them would lose.
  for (const row of rows) {
    results.push(
      await provisionGuardianPortalAccess({
        locationId: input.locationId,
        guardianId: row.id,
        actorUid: input.actorUid,
      }),
    );
  }

  return results;
}

/**
 * Which enrollments a set of students hold, and whether each has cleared.
 *
 * Used by the profile screens to show one badge. Exported from here rather than
 * from `admissions-queries` because the fee gate owns the meaning of the
 * column, and a second reader spelling the rule differently is how these two
 * end up disagreeing.
 */
export async function feeClearanceFor(
  locationId: string,
  studentProfileIds: readonly string[],
): Promise<Map<string, { feeStatus: string; feeClearedAt: Date | null }>> {
  if (studentProfileIds.length === 0) return new Map();

  const rows = await db
    .select({
      studentProfileId: studentEnrollments.studentProfileId,
      feeStatus: studentEnrollments.feeStatus,
      feeClearedAt: studentEnrollments.feeClearedAt,
    })
    .from(studentEnrollments)
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.status, 'active'),
        inArray(studentEnrollments.studentProfileId, [...studentProfileIds]),
      ),
    );

  return new Map(
    rows.map((row) => [
      row.studentProfileId,
      { feeStatus: row.feeStatus, feeClearedAt: row.feeClearedAt },
    ]),
  );
}
