import 'server-only';

import { and, asc, eq, isNull } from 'drizzle-orm';

import {
  principalAssignments,
  schoolUserBranches,
  schoolUsers,
  schools,
} from '@/db/schema';

import { queueAccessEmail } from './access-email';
import { db } from './drizzle';
import { emailRejectionReason } from './email-validation';
import { isValidMobile, MOBILE_HINT } from './phone-formats';
import { createFirstSchoolAdmin } from './school-bootstrap';

/**
 * `lib/branch-leads.ts` — who runs this campus, answered once for both branch
 * forms. Sprint 19a, item 3.
 *
 * ── One validator, not two ───────────────────────────────────────────────
 * The campus form is reached from four places: the Super Admin wizard, the
 * Super Admin branch pages, and — new this sprint — the school portal's own
 * create and edit screens. Two of those post to
 * `/api/super-admin/schools/[schoolId]/branches` and two to
 * `/api/school/branches`, and the spec is explicit that the validation is *the
 * same module*, not two copies. A rule that exists twice is a rule that has
 * already diverged; `lib/challan-print.ts` is this repository's worked example
 * of the cap that drifted between a list and its print page.
 *
 * ── The three answers, and why "the school owner" is one of them ─────────
 * Decision D3. Asked who administers a campus, a school group's honest answer
 * is very often "I do" — the same person who owns the school. Expressed as a
 * second `school_users` row that is a duplicate membership: it breaks the
 * one-row-per-person unique index, and where it does not, it puts the owner in
 * Users & Staff twice with two different campuses beside their name.
 *
 * So *the school owner* writes an **assignment**, never an account:
 *
 *   Branch Admin     -> `school_user_branches(owner, thisBranch)`
 *   Branch Principal -> `principal_assignments(owner, thisBranch, today)`
 *
 * **No invitation and no password email.** The owner already has a login;
 * sending them a "set your password" link for a campus they just created would
 * be, at best, confusing and at worst a support ticket about an account that
 * does not exist. The form says so in one sentence.
 *
 * *Somebody else* is the path that mints an account, and it is the only one.
 */

/** Which hat is being filled. Decides the role and whether a scope row is written. */
export type BranchLeadKind = 'admin' | 'principal';

/**
 * One of the form's two toggle groups, as it arrives on the wire.
 *
 * `mode: 'none'` is the toggle switched off and is the default for both, so a
 * form that says nothing changes nothing — which is what the wizard's step 2
 * posted before this existed and must go on doing.
 */
export interface BranchLeadInput {
  mode: 'none' | 'owner' | 'invite';
  /** Only for `invite`. */
  fullName: string;
  phone: string;
  email: string;
}

const NONE: BranchLeadInput = { mode: 'none', fullName: '', phone: '', email: '' };

/**
 * Reads and validates one toggle group off a request body.
 *
 * Returns a string when the answer is unusable, which every caller turns into a
 * 400 with that sentence. Refusing here rather than in the route is the whole
 * point of the module: the two routes cannot disagree about whether a mobile
 * number is required, and one of them already had a validator that refused its
 * own form's output (§5aw).
 */
export function readBranchLead(raw: unknown): BranchLeadInput | string {
  if (raw === null || raw === undefined) return NONE;
  if (typeof raw !== 'object') return 'Branch lead details were not readable.';

  const value = raw as Record<string, unknown>;
  const mode = value['mode'];

  if (mode === undefined || mode === null || mode === 'none') return NONE;
  if (mode === 'owner') return { ...NONE, mode: 'owner' };
  if (mode !== 'invite') return 'Choose the school owner, or somebody else.';

  const fullName = typeof value['fullName'] === 'string' ? value['fullName'].trim() : '';
  const phone = typeof value['phone'] === 'string' ? value['phone'].trim() : '';
  const email = typeof value['email'] === 'string' ? value['email'].trim() : '';

  if (fullName === '') return 'Enter the name of the person who will run this campus.';

  /*
   * Both an address and a mobile, and neither is negotiable.
   *
   * `school_users.phone` is NOT NULL and unique per school — it is how a member
   * is identified within a tenant, so there is no row to write without one. The
   * email is where the password link goes, and an account nobody can sign in to
   * is worse than no account: it holds the phone number's uniqueness against
   * the person who is later invited properly.
   */
  if (!isValidMobile(phone)) return `That mobile number is not usable. ${MOBILE_HINT}`;
  if (email === '') return 'Enter an email address — it is where the password link goes.';

  const emailProblem = emailRejectionReason(email);
  if (emailProblem !== null) return emailProblem;

  return { mode: 'invite', fullName, phone, email };
}

/** What happened, in words a form can print without interpreting. */
export interface BranchLeadOutcome {
  kind: BranchLeadKind;
  /** A `school_users` row was written. */
  created: boolean;
  /** A password-setup email was queued. */
  emailQueued: boolean;
  /** The owner was given this campus without an account being created. */
  assignedToOwner: boolean;
  /** Why nothing happened, when nothing did. Safe to show. */
  reason: string | null;
}

/**
 * The school's owner: the `school_admin` whose membership names no campus.
 *
 * Ordered by `created_at` so a group with two school-wide administrators
 * resolves to the same person every time rather than to whichever row the
 * planner returned first. Null when the school has none, which is a real state
 * — a school provisioned but never bootstrapped — and is reported rather than
 * guessed at.
 */
async function findSchoolOwner(
  locationId: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await db
    .select({ id: schoolUsers.id, name: schoolUsers.name })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.role, 'school_admin'),
        eq(schoolUsers.isActive, true),
        isNull(schoolUsers.branchId),
      ),
    )
    .orderBy(asc(schoolUsers.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

/** Today as `YYYY-MM-DD`, the form the `date` columns hold. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Applies one toggle group to a freshly created campus.
 *
 * ── Never throws, and never fails the branch ─────────────────────────────
 * The campus is already committed by the time this runs, and it is the thing
 * the operator asked for. A mail server that is down, or a phone number already
 * used by somebody else at the school, must not turn a created campus into a
 * 500 that says nothing was created — the operator would create it again. So
 * every failure comes back as a `reason` the form prints beside the success.
 *
 * That is the same arrangement the Super Admin route has used for
 * `inviteAsBranchAdmin` since Sprint 10.5, and this replaces that flag rather
 * than sitting beside it.
 */
export async function applyBranchLead(
  kind: BranchLeadKind,
  input: BranchLeadInput,
  context: {
    locationId: string;
    branchId: string;
    branchName: string;
    /** Whoever is doing this, for `granted_by_uid` and the setup token. */
    actor: string;
  },
): Promise<BranchLeadOutcome | null> {
  if (input.mode === 'none') return null;

  const base: BranchLeadOutcome = {
    kind,
    created: false,
    emailQueued: false,
    assignedToOwner: false,
    reason: null,
  };

  if (input.mode === 'owner') {
    const owner = await findSchoolOwner(context.locationId);
    if (owner === null) {
      return {
        ...base,
        reason:
          'This school has no school-wide administrator yet, so there is nobody to give the campus to. Invite one from Users & Staff first.',
      };
    }

    if (kind === 'admin') {
      /*
       * A grant, not a membership. `onConflictDoNothing` because saving the
       * campus twice is not two grants — the unique index in `0035` says the
       * same thing at the database, and this is the statement it was put there
       * for.
       */
      await db
        .insert(schoolUserBranches)
        .values({
          locationId: context.locationId,
          schoolUserId: owner.id,
          branchId: context.branchId,
          grantedByUid: context.actor,
        })
        .onConflictDoNothing({
          target: [schoolUserBranches.schoolUserId, schoolUserBranches.branchId],
        });

      return { ...base, assignedToOwner: true };
    }

    /*
     * A principal assignment, open-ended and starting today. There is no unique
     * index to lean on here — a school legitimately re-appoints the same head
     * after a gap — so a duplicate is refused by reading first. Two identical
     * open assignments would not break the resolver (it unions them) but they
     * would print the same person twice on the campus's own screen.
     */
    const existing = await db
      .select({ id: principalAssignments.id })
      .from(principalAssignments)
      .where(
        and(
          eq(principalAssignments.locationId, context.locationId),
          eq(principalAssignments.schoolUserId, owner.id),
          eq(principalAssignments.branchId, context.branchId),
          isNull(principalAssignments.endsOn),
        ),
      )
      .limit(1);

    if (existing[0] === undefined) {
      await db.insert(principalAssignments).values({
        locationId: context.locationId,
        schoolUserId: owner.id,
        branchId: context.branchId,
        startsOn: today(),
      });
    }

    return { ...base, assignedToOwner: true };
  }

  // `invite` — the one path that mints an account.
  const schoolRows = await db
    .select({ name: schools.name, slug: schools.slug })
    .from(schools)
    .where(eq(schools.locationId, context.locationId))
    .limit(1);

  const school = schoolRows[0];
  if (school === undefined) {
    return { ...base, reason: 'The school could not be read, so no account was created.' };
  }

  const member = await createFirstSchoolAdmin(db, {
    locationId: context.locationId,
    name: input.fullName,
    phone: input.phone,
    email: input.email,
    role: kind === 'admin' ? 'branch_admin' : 'principal',
    branchId: context.branchId,
  });

  if (member.status !== 'created') {
    return {
      ...base,
      reason:
        member.status === 'exists'
          ? `Somebody at this school already uses ${input.phone}, so no new account was created for ${context.branchName}.`
          : member.reason,
    };
  }

  /*
   * A principal is only a principal of somewhere once they are assigned. The
   * role alone narrows nothing — `lib/principal-resolver.ts` says so at length
   * — so an account created here without an assignment would be a head who
   * signs in and is shown the whole group.
   */
  if (kind === 'principal') {
    await db.insert(principalAssignments).values({
      locationId: context.locationId,
      schoolUserId: member.userId,
      branchId: context.branchId,
      startsOn: today(),
    });
  }

  const access = await queueAccessEmail({
    locationId: context.locationId,
    school: { name: school.name, slug: school.slug },
    member: {
      id: member.userId,
      name: input.fullName,
      email: input.email,
      authUserId: null,
    },
    createdBy: context.actor,
  });

  return {
    ...base,
    created: true,
    emailQueued: access.queued,
    reason: access.queued ? null : access.reason,
  };
}

/** One sentence per outcome, for the screen that asked. */
export function describeBranchLead(outcome: BranchLeadOutcome): string {
  const hat = outcome.kind === 'admin' ? 'campus administrator' : 'campus principal';

  if (outcome.reason !== null) return outcome.reason;
  if (outcome.assignedToOwner) {
    return `The school owner is now the ${hat} for this campus. No invitation was sent — they already have a login.`;
  }
  if (outcome.created && outcome.emailQueued) {
    return `A ${hat} account was created and emailed a link to set their password.`;
  }
  if (outcome.created) {
    return `A ${hat} account was created, but no email could be sent. Resend the invitation from Users & Staff.`;
  }

  return `No ${hat} was set for this campus.`;
}
