/**
 * Vocabulary shared by the four delete surfaces: the school portal's Users &
 * Staff table and the Super Admin school Users tab, each with a single-row and
 * a bulk path.
 *
 * **Keep this module dependency-free.** It is imported by client components on
 * both sides, for the same reason `lib/challan-print.ts` is: the cap is
 * enforced in the browser (to disable the button) and again in the route (which
 * is the actual gate), and a number that drifted between them would either
 * offer a selection the route refuses or refuse one it would have taken.
 */

/**
 * Most rows a single bulk delete may carry.
 *
 * A blast-radius limit rather than a database one — the loop is per-row and
 * would happily run longer. 100 is the same figure `MAX_SCHOOLS_PER_APPLY` uses
 * for the other tool on this platform that can do a lot of damage in one click.
 */
export const MAX_BULK_DELETE = 100;

/** What became of one member in a delete request. */
export interface DeletionOutcome {
  id: string;
  name: string;
  deleted: boolean;
  /** Why not, in words meant for the operator. Null when it was deleted. */
  reason: string | null;
}

/**
 * The refusal every delete path shares, and the reason it is not a bug.
 *
 * Several foreign keys into `school_users` are `NO ACTION`: attendance marked,
 * leave approved, payroll run, periods taught. Postgres refuses to orphan that
 * history, which is correct — who marked a register is part of the register.
 * The refusal is turned into this, which points at the action that does work.
 */
export function referencedExplanation(name: string): string {
  return (
    `${name} cannot be deleted because their name is on records the school ` +
    'keeps — attendance they marked, leave they approved, payroll they ran, ' +
    'or periods they taught. Deactivate them instead: they lose access ' +
    'immediately and the records stay attributable.'
  );
}

/**
 * One line summarising a bulk result.
 *
 * Bulk delete is deliberately **not** all-or-nothing. A single member whose
 * name is on a register would otherwise block the other ninety-nine, and the
 * operator would have no way to discover which one without deleting them one at
 * a time. So each row is attempted on its own and the refusals are reported
 * with their reasons rather than rolled back into silence.
 */
export function deletionSummary(outcomes: readonly DeletionOutcome[]): string {
  const deleted = outcomes.filter((outcome) => outcome.deleted).length;
  const refused = outcomes.length - deleted;

  const deletedPart = `${deleted} user${deleted === 1 ? '' : 's'} deleted`;
  return refused === 0 ? `${deletedPart}.` : `${deletedPart}, ${refused} kept.`;
}
