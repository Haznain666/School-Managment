import 'server-only';

import { and, eq, inArray, ne } from 'drizzle-orm';

import { schoolUsers } from '@/db/schema/school-users';
import { studentEnrollments } from '@/db/schema/student-enrollments';
import { studentGuardians } from '@/db/schema/student-guardians';
import { studentProfiles } from '@/db/schema/student-profiles';

import { freezeConversationsOnDeparture } from './chat-threads';
import { db } from './drizzle';
import { clearSubscriptionsFor } from './push';

/**
 * What happens to the logins when a pupil stops being a pupil.
 *
 * ── The rule that is not negotiable ──────────────────────────────────────
 * **A guardian with another actively enrolled child is never deactivated**,
 * whichever button the clerk pressed.
 *
 * One household has one login. Switching off a father because his eldest left
 * would lock him out of his other three children's fees, attendance and results
 * — and he would report it as the product being broken, correctly. So the
 * question this module asks is never "did this child leave" but "does this
 * guardian have anyone left here", and it asks it *excluding the child being
 * removed*, because that child's enrollment may or may not have been closed yet
 * depending on which caller got here first.
 *
 * ── Safe by construction, so the campus transfer is a no-op ──────────────
 * `deactivateFor` only ever acts on a pupil with **no active enrollment left**.
 * That is what makes it safe to call from `transferStudent`, which moves a
 * pupil between campuses of the same school: the pupil is still actively
 * enrolled at the receiving branch a moment later, so nothing is deactivated
 * and nothing needs to know that a transfer is different from a departure.
 *
 * A rule expressed as a condition beats a rule expressed as "remember not to
 * call this there".
 *
 * ── Three outcomes, and the caller chooses ───────────────────────────────
 * The dialog offers Cancel, "Continue without disabling", and "Disable and
 * continue". Cancel never reaches the server. The other two arrive as
 * `disablePortals`, a parameter — **the dialog is a courtesy to the clerk and
 * this is the rule**, so a request that skips the screen still has to say which
 * it meant.
 */

export interface DepartureOutcome {
  /** Accounts actually switched off. */
  deactivated: { schoolUserId: string; name: string; role: string }[];
  /** Guardians kept because another child of theirs is still enrolled. */
  keptWithOtherChildren: { schoolUserId: string; name: string }[];
  /** Conversations moved to read-only. */
  conversationsFrozen: number;
}

/**
 * Whether this pupil still has a live placement anywhere in the school.
 *
 * Campus transfer closes one enrollment and opens another in the same
 * transaction, so this answers *true* throughout a transfer and false only for
 * a genuine departure.
 */
export async function stillEnrolled(
  locationId: string,
  studentProfileId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: studentEnrollments.id })
    .from(studentEnrollments)
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.studentProfileId, studentProfileId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * The guardians of a departing pupil, split by whether they have other children
 * still enrolled here.
 *
 * Exported because the dialog shows it *before* the clerk decides: "Disable and
 * continue" is a very different act when it switches off two parents than when
 * it switches off none, and a clerk should be able to see which.
 */
export async function guardiansOnDeparture(
  locationId: string,
  studentProfileId: string,
): Promise<{
  losingLastChild: { schoolUserId: string; name: string }[];
  keptWithOtherChildren: { schoolUserId: string; name: string }[];
}> {
  const guardians = await db
    .selectDistinct({
      schoolUserId: studentGuardians.schoolUserId,
      name: schoolUsers.name,
    })
    .from(studentGuardians)
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentGuardians.schoolUserId))
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        eq(studentGuardians.studentProfileId, studentProfileId),
        eq(schoolUsers.isActive, true),
      ),
    );

  const losingLastChild: { schoolUserId: string; name: string }[] = [];
  const keptWithOtherChildren: { schoolUserId: string; name: string }[] = [];

  for (const guardian of guardians) {
    if (guardian.schoolUserId === null) continue;

    // "Does this guardian have any *other* child still actively enrolled" —
    // excluding the one being removed, because its enrollment row may or may
    // not have been closed yet by the caller above us.
    const others = await db
      .selectDistinct({ studentProfileId: studentProfiles.id })
      .from(studentGuardians)
      .innerJoin(studentProfiles, eq(studentProfiles.id, studentGuardians.studentProfileId))
      .innerJoin(
        studentEnrollments,
        eq(studentEnrollments.studentProfileId, studentProfiles.id),
      )
      .where(
        and(
          eq(studentGuardians.locationId, locationId),
          eq(studentGuardians.schoolUserId, guardian.schoolUserId),
          ne(studentProfiles.id, studentProfileId),
          eq(studentEnrollments.status, 'active'),
        ),
      )
      .limit(1);

    if (others.length > 0) {
      keptWithOtherChildren.push({ schoolUserId: guardian.schoolUserId, name: guardian.name });
    } else {
      losingLastChild.push({ schoolUserId: guardian.schoolUserId, name: guardian.name });
    }
  }

  return { losingLastChild, keptWithOtherChildren };
}

/**
 * Freezes the conversations, and — only when asked — switches off the logins.
 *
 * Conversations freeze **whichever way the clerk chose**. That is not the same
 * decision: a frozen thread is read-only and retained, and a departure must not
 * leave a live two-way channel open to somebody no longer at the school. What
 * `disablePortals` governs is the *account*, which is about whether a family
 * can still see last term's results and fee history.
 */
export async function applyDeparture(input: {
  locationId: string;
  studentProfileId: string;
  /** The pupil's own account, when it still exists. Hard delete removes it. */
  studentSchoolUserId: string | null;
  disablePortals: boolean;
  reason: string;
  /**
   * Whether to first check that the pupil has no live placement left.
   *
   * **True for withdrawal and transfer**, which is what makes this safe to call
   * from `transferStudent`: a campus move still has an active enrollment a
   * moment later, so the check returns early and nothing is deactivated.
   *
   * **False for a hard delete**, and that is not an inconsistency. At the
   * moment a delete calls this, the pupil is still `active` — the enrollment
   * rows have not been removed yet, and they cannot be, because
   * `student_guardians` cascades with the profile and this needs to read the
   * guardians *before* they are gone. A delete is an unambiguous departure and
   * does not need the check the ambiguous cases do.
   */
  requireNoActiveEnrollment?: boolean;
}): Promise<DepartureOutcome> {
  const outcome: DepartureOutcome = {
    deactivated: [],
    keptWithOtherChildren: [],
    conversationsFrozen: 0,
  };

  // Safe by construction: a campus transfer still has a live placement here, so
  // this returns early and `transferStudent` needs no special case.
  if (
    input.requireNoActiveEnrollment !== false &&
    (await stillEnrolled(input.locationId, input.studentProfileId))
  ) {
    return outcome;
  }

  outcome.conversationsFrozen = await freezeConversationsOnDeparture(
    input.locationId,
    input.studentProfileId,
    input.reason,
  );

  if (!input.disablePortals) return outcome;

  const { losingLastChild, keptWithOtherChildren } = await guardiansOnDeparture(
    input.locationId,
    input.studentProfileId,
  );

  outcome.keptWithOtherChildren = keptWithOtherChildren;

  const toDisable = [...losingLastChild.map((g) => g.schoolUserId)];
  if (input.studentSchoolUserId !== null) toDisable.push(input.studentSchoolUserId);

  if (toDisable.length === 0) return outcome;

  const now = new Date();

  const disabled = await db
    .update(schoolUsers)
    .set({
      isActive: false,
      deactivatedAt: now,
      deactivatedReason: input.reason,
      updatedAt: now,
    })
    .where(
      and(
        eq(schoolUsers.locationId, input.locationId),
        inArray(schoolUsers.id, toDisable),
        eq(schoolUsers.isActive, true),
      ),
    )
    .returning({ id: schoolUsers.id, name: schoolUsers.name, role: schoolUsers.role });

  outcome.deactivated = disabled.map((row) => ({
    schoolUserId: row.id,
    name: row.name,
    role: row.role,
  }));

  // A deactivated account must stop being buzzed. The rows would otherwise keep
  // pushing to a phone belonging to somebody who can no longer sign in to read
  // what they were pushed about.
  await clearSubscriptionsFor(
    input.locationId,
    disabled.map((row) => row.id),
  );

  return outcome;
}
