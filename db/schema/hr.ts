/**
 * Sprint 7 — HR & Payroll barrel.
 *
 * The tables the module owns, in one import. `staff` itself is not re-exported
 * here: it predates this sprint and is exported from `./staff` by the schema
 * index, and exporting it twice would collide.
 *
 * Reading order, which is also the dependency order:
 *   salary_components        the heads a school pays and deducts under
 *   staff_salary_structures  what one person earns under each head
 *   leave_types              the leave a school grants, and whether it is paid
 *   leave_requests           one application, approved or not
 *   staff_attendance         the daily register for staff
 *   payroll_runs             one month of payroll
 *   payslips                 what one person was paid in that month
 *   payslip_items            the lines that make up that figure
 *   payslip_sequences        the atomic counter behind payslip numbers
 */
export * from './salary-components';
export * from './staff-salary-structures';
export * from './leave-types';
export * from './leave-requests';
export * from './staff-attendance';
export * from './payroll-runs';
export * from './payslips';
export * from './payslip-items';
export * from './payslip-sequences';
