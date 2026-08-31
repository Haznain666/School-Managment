import "server-only";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import {
  schoolUsers,
  schools,
  studentEnrollments,
  studentGuardians,
  studentProfiles,
} from "@/db/schema";

import { queueAccessEmail } from "./access-email";
import { db } from "./drizzle";

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
 * What stands between this guardian and an account: a refusal, or an account
 * they should be given instead of a new one.
 *
 * Two reads and no writes, lifted out of `provisionGuardianPortalAccess` below
 * so that `npm run check-sprint21` can execute both against the real schema.
 * The upsert they guard cannot be executed by a check script — it writes — and
 * a guard that only runs on the path nobody dares run in a test is a guard
 * nobody has ever run.
 *
 * ── An address already in use is usually not a mistake ───────────────────
 * The first version of this returned a refusal for it, and that was wrong in a
 * way QA caught before any school did. Two things provoke it and both are
 * ordinary:
 *
 *   · **a household with one inbox.** A mother and a father sharing an email
 *     address is common on a Pakistani school roll. Refusing meant the second
 *     parent got no account at all;
 *   · **one parent recorded on two children with two different numbers.** The
 *     upsert keys on phone, so the second child's guardian row looked like a
 *     new person to the phone index and a duplicate to the address index. The
 *     refusal blamed the address; the difference was the phone.
 *
 * The second was the worse of the two, because the refusal returned *before*
 * the guardian link was written — so that child's `school_user_id` stayed
 * NULL, `listChildrenForGuardian` never returned them, and the parent portal
 * showed a family with a child missing from it. That is Sprint 21's original
 * symptom wearing a different hat, which is exactly how this defect class keeps
 * coming back.
 *
 * So an address already held by an active **non-student** row is now an
 * `adopt`: that row is the account for that inbox, because under Supabase Auth
 * the address *is* the identity and one inbox cannot sign in as two people. The
 * guardian is linked to it and welcomed through it. The same father gets one
 * login showing every child on both his numbers, and the mother sharing his
 * inbox reaches the same portal — which is what a household sharing an inbox
 * has actually asked for.
 *
 * A **student's** row is still a refusal, and always will be. That is the
 * defect this sprint exists to close, and adopting one would hand a parent
 * their own child's login.
 */
export type PortalAccountBlocker =
  | { kind: "refuse"; reason: string; occupantId: string | null }
  | {
      kind: "adopt";
      accountId: string;
      accountName: string;
      accountEmail: string | null;
      /*
       * Carried, not defaulted to null.
       *
       * `queueAccessEmail` writes a *first-time setup* link for an account with
       * no Supabase user and something else for one that already has one. An
       * adopted row usually has one — that is why it holds the address — so
       * inventing a null here would send a teacher or a parent who already
       * signs in a "choose your password" mail for an account they already use.
       */
      accountAuthUserId: string | null;
    };

export async function portalAccountBlocker(
  locationId: string,
  guardianName: string,
  phone: string,
  email: string,
): Promise<PortalAccountBlocker | null> {
  /*
   * ── The conflicting row, resolved before the upsert causes it ────────────
   *
   * The upsert lands on whatever row already holds this number at this school,
   * and for one school year that row was sometimes **the child's**. Until
   * `lib/enrollment.ts`'s sentinel shipped, a student's directory row borrowed
   * the primary guardian's mobile; provisioning then wrote the father's email
   * onto his own daughter's row and the guardian link followed it there. He
   * accepted the invite, GoTrue bound his uid to a row whose role is `student`,
   * and — because `school_users_location_id_auth_user_id_idx` is unique per
   * school — his uid could never afterwards sit on his own `parent` row. He was
   * permanently in the student portal, looking at one of his five children as
   * if he were her.
   *
   * The sentinel stops new rows being made that way. It does nothing for the
   * ones already there, and until this read nothing stopped the upsert landing
   * on them again.
   */
  const conflicting = await db
    .select({
      id: schoolUsers.id,
      role: schoolUsers.role,
      name: schoolUsers.name,
    })
    .from(schoolUsers)
    .where(
      and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.phone, phone)),
    )
    .limit(1);

  const occupant = conflicting[0] ?? null;

  if (occupant !== null && occupant.role === "student") {
    return {
      kind: "refuse",
      occupantId: occupant.id,
      reason: `${phone} is already recorded as the directory number for the student ${occupant.name}, so opening a parent account on it would hand ${guardianName} that child’s login. Correct the number on one of the two records, then send the invite again.`,
    };
  }

  /*
   * ── And the address, which `0038` makes a hard constraint ────────────────
   *
   * One email is one person. `school_users` had no unique index on
   * `(location_id, lower(email))` until `0038`, so two active memberships of
   * one school could carry one address and every sign-in path then resolved the
   * person arbitrarily. `0038` closes it, which means this upsert can newly
   * raise `23505` — and a school must never meet a SQLSTATE. It meets this
   * instead, which names the other person and says what to do.
   */
  const sameAddress = await db
    .select({
      id: schoolUsers.id,
      name: schoolUsers.name,
      role: schoolUsers.role,
      // Both carried so an adoption can address the welcome correctly rather
      // than assume the adopted account has never been set up.
      email: schoolUsers.email,
      authUserId: schoolUsers.authUserId,
    })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.isActive, true),
        sql`lower(${schoolUsers.email}) = lower(${email})`,
      ),
    )
    .orderBy(asc(schoolUsers.createdAt), asc(schoolUsers.id));

  const otherHolder = sameAddress.find((row) => row.id !== occupant?.id);

  if (otherHolder === undefined) return null;

  // A student holding the address is the defect, not a household. It can only
  // be a row `0038` did not reach, and adopting it would hand a parent their
  // own child's login — the whole subject of this sprint.
  if (otherHolder.role === "student") {
    return {
      kind: "refuse",
      occupantId: occupant?.id ?? null,
      reason: `${email} is recorded against the student ${otherHolder.name} at this school, so opening a parent account on it would hand ${guardianName} that child’s login. Correct the address on one of the two records, then send the invite again.`,
    };
  }

  return {
    kind: "adopt",
    accountId: otherHolder.id,
    accountName: otherHolder.name,
    accountEmail: otherHolder.email,
    accountAuthUserId: otherHolder.authUserId,
  };
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
      guardianName: "",
      schoolUserId: null,
      emailQueued: false,
      reason: "That guardian is no longer on this student’s record.",
    };
  }

  const email = (guardian.email ?? "").trim();
  if (email === "") {
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
      reason: "This school record is unavailable.",
    };
  }

  /*
   * What is in the way, decided before the upsert rather than after it.
   *
   * It lives in `portalAccountBlocker` above rather than here because a check
   * script can execute a read and cannot execute this upsert, and a guard that
   * only runs on a path nobody dares run in a test is a guard nobody has run.
   */
  const blocker = await portalAccountBlocker(
    locationId,
    guardian.name,
    guardian.phone,
    email,
  );

  if (blocker !== null && blocker.kind === "refuse") {
    return {
      guardianId: guardian.id,
      guardianName: guardian.name,
      schoolUserId: guardian.schoolUserId,
      emailQueued: false,
      reason: blocker.reason,
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
  const upserted =
    blocker !== null
      ? // Adopted. The address already has an account here and under Supabase
        // Auth the address *is* the identity, so this guardian signs in as that
        // account rather than as a second one that could never be reached. No
        // write: the row is somebody else's record and this call has no mandate
        // to rename it.
        [
          {
            id: blocker.accountId,
            name: blocker.accountName,
            email: blocker.accountEmail,
            authUserId: blocker.accountAuthUserId,
          },
        ]
      : await db
          .insert(schoolUsers)
          .values({
            locationId,
            name: guardian.name,
            phone: guardian.phone,
            email,
            role: "parent",
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

  /*
   * Link every guardian row on this number **and the one this call is about**.
   *
   * The same father recorded against three children is three rows, and the
   * parent portal finds his children by following all of them — so the phone
   * clause is what makes one invite cover a whole family.
   *
   * The `id` clause beside it is the case the phone clause cannot see: a school
   * that recorded the same parent on two children with two different numbers.
   * That row would be linked to nothing, and a guardian row with a NULL
   * `school_user_id` is a child who does not appear in their own parent's
   * portal — silently, with the family assuming the school never enrolled them.
   * It cost this sprint's QA one finding to notice, and it is the same shape as
   * the defect the sprint opened with.
   */
  await db
    .update(studentGuardians)
    .set({ schoolUserId: account.id })
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        or(
          eq(studentGuardians.id, guardian.id),
          eq(studentGuardians.phone, guardian.phone),
        ),
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
    audience: "parent",
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
        eq(studentEnrollments.status, "active"),
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
