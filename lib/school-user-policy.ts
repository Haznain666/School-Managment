import 'server-only';

import type { SchoolAuthContext } from './api-auth';
import type { SchoolUserRow } from './school-queries';

/**
 * The refusals a school administrator's delete must survive, over and above
 * what the database enforces.
 *
 * `lib/school-queries.ts` owns the referential refusal — Postgres will not
 * orphan a register. These three are policy, they are specific to a member of
 * the school deleting another, and they exist because each one is a way to lock
 * the school out of its own portal:
 *
 *   - **Yourself.** Deleting your own row ends your session on the next request
 *     and cannot be undone from inside the portal.
 *   - **The last active administrator.** A school with no `school_admin` cannot
 *     invite one: invitations are sent from inside the portal, so recovery
 *     needs a platform operator. Deactivating the last one is survivable
 *     because it is reversible; deleting is not.
 *   - **Outside your branch.** A `branch_admin` cannot even *read* a member of
 *     another branch (`GET` returns 404), so being able to delete one would be
 *     the only place their scope leaked.
 *
 * The Super Admin path deliberately has none of these. A platform operator
 * emptying a school of administrators is doing it on purpose, and is the person
 * who would otherwise be called to undo it.
 */

/** True when deleting this member would reduce the school's administrators. */
export function consumesAdminSlot(member: SchoolUserRow): boolean {
  return member.role === 'school_admin' && member.isActive;
}

/**
 * Why this member may not be deleted, or null if they may be.
 *
 * `activeAdminsRemaining` is how many active administrators the school has at
 * the moment this row is considered — **not** when the request started. The
 * bulk path decrements it as deletions succeed, so selecting all three
 * administrators deletes two and refuses the third, rather than refusing all
 * three because each one can see the other two.
 */
export function schoolDeleteRefusal(
  auth: SchoolAuthContext,
  member: SchoolUserRow,
  activeAdminsRemaining: number,
): string | null {
  if (member.authUserId !== null && member.authUserId === auth.uid) {
    return (
      'You cannot delete your own account. Ask another administrator, or ' +
      'deactivate yourself if you are leaving.'
    );
  }

  if (auth.branchId !== null && member.branchId !== auth.branchId) {
    return 'That user belongs to another branch.';
  }

  if (consumesAdminSlot(member) && activeAdminsRemaining <= 1) {
    return (
      `${member.name} is the school's only active administrator. Deleting ` +
      'them would leave nobody able to invite a replacement — appoint another ' +
      'administrator first.'
    );
  }

  return null;
}
