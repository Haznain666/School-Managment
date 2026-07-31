import type { UserRole } from '@/types/school-auth';

/**
 * Who may see and who may change fee data.
 *
 * Split because the two are genuinely different jobs: an HR manager or branch
 * admin has business reading the fee register, but only the school
 * administrator and the accountant should be raising challans, recording
 * payments or granting concessions — those move money.
 *
 * Kept in one module so a new fee route cannot quietly invent its own policy.
 */

export const FEE_READ_ROLES: readonly UserRole[] = [
  'school_admin',
  'branch_admin',
  'accountant',
  'hr_manager',
];

export const FEE_WRITE_ROLES: readonly UserRole[] = ['school_admin', 'accountant'];

/** True when this role may raise challans, take payments or grant concessions. */
export function canManageFees(role: UserRole): boolean {
  return FEE_WRITE_ROLES.includes(role);
}
