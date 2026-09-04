import 'server-only';

import { and, eq, isNotNull } from 'drizzle-orm';

import { grades } from '@/db/schema/grades';
import { schoolUsers } from '@/db/schema/school-users';
import { schools } from '@/db/schema/schools';
import { sections } from '@/db/schema/sections';
import { studentEnrollments } from '@/db/schema/student-enrollments';
import { studentGuardians } from '@/db/schema/student-guardians';
import { studentProfiles } from '@/db/schema/student-profiles';

import { getChatSchoolSettings } from './chat-queries';
import { db } from './drizzle';
import { enqueueEmail } from './email-outbox';
import { smtpConfigured } from './email-sender';
import { buildSchoolLoginUrl } from './invite-links';
import { issueStudentCredential, studentCredentialAddress } from './student-credentials';

/**
 * A pupil's way into their own portal, and the guardians who are handed it.
 *
 * ── The mechanism the product owner chose, and what it replaced ──────────
 * Sprint 24 minted a pupil a credential and returned the password *to the
 * screen*: a clerk read it off, wrote it on a slip, and handed it to the child.
 * That was the safest thing anyone could think of — the login id is a
 * `.invalid` address that provably cannot receive mail, so no code path could
 * ever email a minor — and it was also unworkable. Nothing in the product ever
 * called that endpoint, so no school ever issued a single credential, and the
 * counter hand-off it assumed does not survive contact with a school office.
 *
 * Sprint 26 keeps the property and moves the delivery. **The login id is still
 * the `.invalid` address and the child is still never emailed. The password
 * goes to the guardians**, at the real addresses the school already holds and
 * already uses for the parent portal, the fee voucher and the absence notice.
 *
 * ── What that costs, stated rather than buried ───────────────────────────
 * A password sitting in a parent's inbox is readable by anybody who can open
 * that inbox, and reading it leaves no trace. The counter slip had the opposite
 * profile: hard to intercept, easy to lose. This is the trade the school makes,
 * and the two mitigations it comes with are that the password is **rotated
 * whenever anybody asks** — there is no recovery flow to compromise, only
 * reissue — and that a pupil account reaches a pupil's own portal and nothing
 * else.
 *
 * ── Why guardians and not "the guardian" ─────────────────────────────────
 * Every guardian with an address, not only the primary contact. A father who
 * gave the school his address and is not flagged primary is still the person
 * the child will ask, and picking one of two parents is a decision this module
 * has no basis to make. Guardians without an address are skipped and reported
 * by name — never failed — for the same reason `provisionGuardianPortalAccess`
 * skips them: most guardians on a Pakistani school roll have a phone and no
 * email, and refusing the whole operation over one of them helps nobody.
 */

/* ------------------------------------------------------------------------
 * Eligibility
 * --------------------------------------------------------------------- */

export interface PortalEligibility {
  /** Whether a credential may be issued for this pupil right now. */
  eligible: boolean;
  /** Why not, in a sentence for the screen. Null when eligible. */
  reason: string | null;
  /** The class the pupil is actually in, or null when not enrolled. */
  gradeName: string | null;
  /** The lowest class this school issues logins from, or null when unset. */
  thresholdGradeName: string | null;
}

/**
 * Whether this pupil is at or above the school's own threshold.
 *
 * ── "Grade 6 and above" is a school's answer, not the platform's ─────────
 * The product owner's rule is *"grade 6 or above"*, and there is no column in
 * this schema that means "grade 6". `grades.sort_order` is a ladder position:
 * at Lahore Grammar "Year 6" sits at 9 and at Askari "Class 6" also sits at 9,
 * because both schools run three pre-primary years first. A hard-coded
 * `sort_order >= 6` would have issued logins to eight-year-olds at both.
 *
 * So the threshold is `chat_school_settings.student_login_min_grade_sort_order`
 * — a per-school setting naming the lowest class — and Sprint 26 sets it to
 * each school's own Year 6 / Class 6. That is the only spelling of the rule
 * that keeps meaning the same thing after a grade is renamed, after one is
 * inserted below it, and at the next school that names its classes differently.
 *
 * **Null still means no pupil logins at all.** A school that has not answered
 * the question has not agreed to issue credentials to minors, and switching
 * every school on by default would be deciding that on their behalf.
 */
export async function portalEligibility(
  locationId: string,
  studentProfileId: string,
): Promise<PortalEligibility> {
  const settings = await getChatSchoolSettings(locationId);
  const floor = settings.studentLoginMinGradeSortOrder;

  const thresholdName =
    floor === null ? null : await gradeNameAtOrAbove(locationId, floor);

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

  const placement = rows[0] ?? null;

  if (floor === null) {
    return {
      eligible: false,
      reason:
        'This school has not turned on student sign-in. Set the lowest class in Chat settings first.',
      gradeName: placement?.gradeName ?? null,
      thresholdGradeName: null,
    };
  }

  if (placement === null) {
    return {
      eligible: false,
      reason: 'This student is not enrolled in a class this year.',
      gradeName: null,
      thresholdGradeName: thresholdName,
    };
  }

  if (placement.sortOrder < floor) {
    return {
      eligible: false,
      reason:
        thresholdName === null
          ? `${placement.gradeName} is below the class this school issues logins from.`
          : `Portal access starts at ${thresholdName}. ${placement.gradeName} is below it.`,
      gradeName: placement.gradeName,
      thresholdGradeName: thresholdName,
    };
  }

  return {
    eligible: true,
    reason: null,
    gradeName: placement.gradeName,
    thresholdGradeName: thresholdName,
  };
}

/** The name of the grade sitting exactly at the threshold, for the screen. */
async function gradeNameAtOrAbove(
  locationId: string,
  sortOrder: number,
): Promise<string | null> {
  const rows = await db
    .select({ name: grades.name })
    .from(grades)
    .where(and(eq(grades.locationId, locationId), eq(grades.sortOrder, sortOrder)))
    .limit(1);

  return rows[0]?.name ?? null;
}

/* ------------------------------------------------------------------------
 * Issue, and tell the guardians
 * --------------------------------------------------------------------- */

export interface GuardianDelivery {
  guardianName: string;
  email: string | null;
  queued: boolean;
  /** Why this guardian got nothing. Null when they did. */
  reason: string | null;
}

export type PortalAccessOutcome =
  | {
      ok: true;
      /** The pupil's login id. Always the `.invalid` address. */
      loginId: string;
      reissued: boolean;
      deliveries: GuardianDelivery[];
    }
  | { ok: false; problem: string };

/**
 * Mints a pupil a new password and emails it to their guardians.
 *
 * ── One call does both, deliberately ─────────────────────────────────────
 * Issuing without sending leaves a password nobody has and an account nobody
 * can reach — which is exactly the state Sprint 24 shipped. Sending without
 * issuing would mail a password that is not the account's. They are one act and
 * they live in one function so that no future caller can perform half of it.
 *
 * ── The password is never returned to the caller ─────────────────────────
 * It is not in the API response, not on the screen and not in any log. The only
 * copy that leaves this process is the one in the guardians' email. That is a
 * deliberate narrowing of Sprint 24's shape, where the password came back to
 * the browser: a value that reaches a screen reaches a screenshot, a support
 * ticket and a shared workstation.
 *
 * ── A failed send is reported, not swallowed ─────────────────────────────
 * The credential has already been rotated by the time an email fails, so the
 * old password is dead either way. Saying which guardians were reached — and
 * which were not, and why — is what lets a clerk pick up the phone instead of
 * pressing the button again and rotating it a third time.
 */
export async function issueAndNotify(input: {
  locationId: string;
  studentProfileId: string;
}): Promise<PortalAccessOutcome> {
  const issued = await issueStudentCredential(input.locationId, input.studentProfileId);
  if (!issued.ok) return { ok: false, problem: issued.problem };

  const context = await studentContext(input.locationId, input.studentProfileId);
  if (context === null) return { ok: false, problem: 'No such student.' };

  const guardians = await db
    .select({ name: studentGuardians.name, email: studentGuardians.email })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.locationId, input.locationId),
        eq(studentGuardians.studentProfileId, input.studentProfileId),
      ),
    );

  const loginUrl = buildSchoolLoginUrl(context.slug);
  const deliveries: GuardianDelivery[] = [];

  for (const guardian of guardians) {
    const address = guardian.email?.trim() ?? '';

    if (address === '') {
      deliveries.push({
        guardianName: guardian.name,
        email: null,
        queued: false,
        reason: 'No email address on file.',
      });
      continue;
    }

    // Checked per send rather than once: "SMTP is not configured" is a
    // deployment fault an administrator can be told about immediately, and
    // queueing into a transport that does not exist only produces a `failed`
    // row nobody reads. Same reasoning as `lib/invite-sender.ts`.
    if (!smtpConfigured()) {
      deliveries.push({
        guardianName: guardian.name,
        email: address,
        queued: false,
        reason: 'Email is not configured on this deployment.',
      });
      continue;
    }

    try {
      await enqueueEmail({
        locationId: input.locationId,
        to: address,
        subject: `${context.studentName}’s student portal sign-in — ${context.schoolName}`,
        text: buildStudentAccessMessage({
          guardianName: guardian.name,
          studentName: context.studentName,
          admissionNumber: context.admissionNumber,
          schoolName: context.schoolName,
          loginId: issued.email,
          password: issued.password,
          loginUrl,
        }),
      });

      deliveries.push({
        guardianName: guardian.name,
        email: address,
        queued: true,
        reason: null,
      });
    } catch (error) {
      deliveries.push({
        guardianName: guardian.name,
        email: address,
        queued: false,
        reason: error instanceof Error ? error.message : 'Unknown email error.',
      });
    }
  }

  return {
    ok: true,
    loginId: issued.email,
    reissued: issued.reissued,
    deliveries,
  };
}

/**
 * The words.
 *
 * Written to be read on a phone by somebody who did not ask for it. It names
 * the child first, because a parent with three at the school needs to know
 * which one this is about before anything else on the page matters.
 *
 * It says the address is not a real one. A parent who tries to write to
 * `asst-2026-0001@students.askari.invalid` and gets a bounce will conclude the
 * school's systems are broken, and one sentence prevents that.
 */
export function buildStudentAccessMessage(input: {
  guardianName: string;
  studentName: string;
  admissionNumber: string;
  schoolName: string;
  loginId: string;
  password: string;
  loginUrl: string;
}): string {
  return [
    `Dear ${input.guardianName},`,
    '',
    `${input.studentName} (${input.admissionNumber}) now has their own sign-in for the ${input.schoolName} student portal.`,
    '',
    `Portal:    ${input.loginUrl}`,
    `Login ID:  ${input.loginId}`,
    `Password:  ${input.password}`,
    '',
    'The login ID is an identifier, not a mailbox — it cannot send or receive email, and nothing will ever be sent to it. Everything the school needs to tell you comes to this address.',
    '',
    'Please pass these details to your child and keep this email safe. If the password is forgotten or you would like it changed, ask the school office and a new one will be sent to you here. The old one stops working the moment a new one is issued.',
    '',
    input.schoolName,
  ].join('\n');
}

/** Name, admission number, school name and slug, in one read. */
async function studentContext(
  locationId: string,
  studentProfileId: string,
): Promise<{
  studentName: string;
  admissionNumber: string;
  schoolName: string;
  slug: string;
} | null> {
  const rows = await db
    .select({
      studentName: schoolUsers.name,
      admissionNumber: studentProfiles.studentId,
      schoolName: schools.name,
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

  return rows[0] ?? null;
}

/* ------------------------------------------------------------------------
 * What the screen shows
 * --------------------------------------------------------------------- */

export interface PortalAccessState extends PortalEligibility {
  /** The address, whether or not it has been issued yet. */
  loginId: string;
  /** When a password was last issued and mailed out. Null when never. */
  issuedAt: Date | null;
  /** Guardians who would receive the next one. */
  recipients: string[];
}

/**
 * Everything the student profile card needs, in one call.
 *
 * The login id is computed even when nothing has been issued, because
 * `studentCredentialAddress` is deterministic — it is a function of the
 * admission number and the school slug — and showing a clerk the address in
 * advance is what lets them recognise it in a parent's screenshot later.
 */
export async function portalAccessState(
  locationId: string,
  studentProfileId: string,
): Promise<PortalAccessState | null> {
  const context = await studentContext(locationId, studentProfileId);
  if (context === null) return null;

  const [eligibility, issuedRows, recipientRows] = await Promise.all([
    portalEligibility(locationId, studentProfileId),
    db
      .select({
        issuedAt: schoolUsers.studentCredentialIssuedAt,
        email: schoolUsers.email,
      })
      .from(studentProfiles)
      .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
      .where(
        and(
          eq(studentProfiles.locationId, locationId),
          eq(studentProfiles.id, studentProfileId),
        ),
      )
      .limit(1),
    db
      .select({ name: studentGuardians.name })
      .from(studentGuardians)
      .where(
        and(
          eq(studentGuardians.locationId, locationId),
          eq(studentGuardians.studentProfileId, studentProfileId),
          isNotNull(studentGuardians.email),
        ),
      ),
  ]);

  const row = issuedRows[0] ?? null;

  return {
    ...eligibility,
    loginId:
      row?.email ??
      studentCredentialAddress(context.admissionNumber, context.slug),
    issuedAt: row?.issuedAt ?? null,
    recipients: recipientRows.map((entry) => entry.name),
  };
}

/* ------------------------------------------------------------------------
 * The automatic sends
 * --------------------------------------------------------------------- */

export interface AutoIssueResult {
  /** True when a password was minted and at least one guardian was mailed. */
  sent: boolean;
  /** Why nothing was sent. Null when something was. */
  skipped: string | null;
  /** Guardians reached, by name, for the screen to report. */
  recipients: string[];
}

/**
 * Issues a pupil's sign-in automatically, if this is the moment for it.
 *
 * ── Called at the two moments the rule names, and nowhere else ───────────
 * A new enrolment into an eligible class, and a promotion that crosses into
 * one. Both are "the pupil has just become entitled to a login", and neither is
 * a decision a clerk should have to remember to make — the product owner's rule
 * is that it happens by itself.
 *
 * ── It never throws, and never fails the thing that called it ────────────
 * An admission is a fact and a promotion is a decision the school has already
 * taken. Neither may be rolled back because SMTP was misconfigured or a
 * guardian's address was blank. This reports what it did and the caller carries
 * that into its own response, exactly as the GHL sync and the enrolment
 * discounts do beside it.
 *
 * ── Already issued means already issued ──────────────────────────────────
 * `student_credential_issued_at` is the guard. Without it a promotion run over
 * a whole grade would rotate the password of every pupil who had one — silently
 * invalidating logins that were working that morning, for no reason anybody
 * could see.
 *
 * ── Deliberately not called by the bulk import ───────────────────────────
 * `lib/student-import-queries.ts` loads a school's existing roll, eight hundred
 * children who are already at the school. Mailing eight hundred families a
 * password on the afternoon somebody migrated a spreadsheet is not what the
 * rule means by "a new student is enrolling", and the office would spend a week
 * on the phone. Those pupils are issued from the profile screen, one press,
 * when the school is ready.
 */
export async function autoIssuePortalAccess(input: {
  locationId: string;
  studentProfileId: string;
}): Promise<AutoIssueResult> {
  try {
    const state = await portalAccessState(input.locationId, input.studentProfileId);

    if (state === null) return { sent: false, skipped: 'No such student.', recipients: [] };
    if (!state.eligible) {
      return { sent: false, skipped: state.reason, recipients: [] };
    }
    if (state.issuedAt !== null) {
      return {
        sent: false,
        skipped: 'This student already has portal access.',
        recipients: [],
      };
    }
    if (state.recipients.length === 0) {
      return {
        sent: false,
        skipped:
          'No guardian on this student has an email address, so there is nobody to send the sign-in to.',
        recipients: [],
      };
    }

    const outcome = await issueAndNotify(input);
    if (!outcome.ok) return { sent: false, skipped: outcome.problem, recipients: [] };

    const reached = outcome.deliveries
      .filter((delivery) => delivery.queued)
      .map((delivery) => delivery.guardianName);

    return {
      sent: reached.length > 0,
      skipped: reached.length > 0 ? null : 'The sign-in email could not be queued.',
      recipients: reached,
    };
  } catch (error) {
    // Swallowed on purpose: see the docblock. The enrolment stands.
    console.warn(
      '[student-portal-access] automatic issue failed:',
      error instanceof Error ? error.message : error,
    );
    return { sent: false, skipped: 'The sign-in could not be issued.', recipients: [] };
  }
}
