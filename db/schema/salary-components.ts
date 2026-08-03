import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { schools } from './schools';

export const COMPONENT_KINDS = ['earning', 'deduction'] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const COMPONENT_KIND_LABELS: Record<ComponentKind, string> = {
  earning: 'Earning',
  deduction: 'Deduction',
};

/**
 * How a component's amount is arrived at.
 *
 * `fixed` is a rupee figure taken straight from the staff member's structure.
 * `percent_of_basic` is a share of the Basic Salary component, which is how
 * Pakistani schools express House Rent (typically 45%) and Medical (10%) — a
 * school that raises a teacher's basic expects those to move with it, and
 * storing them as rupees would silently leave them behind.
 */
export const COMPONENT_CALCULATIONS = ['fixed', 'percent_of_basic'] as const;
export type ComponentCalculation = (typeof COMPONENT_CALCULATIONS)[number];

export const COMPONENT_CALCULATION_LABELS: Record<ComponentCalculation, string> = {
  fixed: 'Fixed amount',
  percent_of_basic: '% of basic salary',
};

/**
 * salary_components — the heads a school pays and deducts under.
 *
 * Deliberately the same shape as `fee_types`: a per-school catalogue, unique on
 * name, retired rather than deleted. The reasoning is the same too — a
 * component that has ever appeared on a payslip is referenced by that payslip's
 * line items, and deleting it would make a payslip already handed to a teacher
 * unexplainable.
 *
 * `is_basic` marks the one component every other percentage is computed
 * against. Exactly one per school should carry it; the API enforces that by
 * clearing the flag elsewhere when it is set.
 */
export const salaryComponents = pgTable(
  'salary_components',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind').notNull().$type<ComponentKind>(),
    calculation: text('calculation')
      .notNull()
      .default('fixed')
      .$type<ComponentCalculation>(),
    /**
     * The percentage used when `calculation` is `percent_of_basic`, as a whole
     * number of hundredths of a percent (4500 = 45.00%). Integer rather than
     * NUMERIC for the same reason money is paise: a rate that is 44.999999 in a
     * double pays the wrong allowance.
     */
    defaultPercentBasisPoints: integer('default_percent_basis_points'),
    /** The component all `percent_of_basic` heads are measured against. */
    isBasic: boolean('is_basic').notNull().default(false),
    /**
     * Whether unpaid-leave days reduce this head. True for basic and most
     * allowances; false for a fixed reimbursement a school pays regardless.
     */
    proratedByAttendance: boolean('prorated_by_attendance').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    /** Position on the payslip. */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('salary_components_location_id_idx').on(table.locationId),
    // Seeding upserts on this, so re-running it cannot duplicate a head.
    uniqueIndex('salary_components_location_id_name_idx').on(
      table.locationId,
      table.name,
    ),
    check('salary_components_kind_check', sql`${table.kind} IN ('earning', 'deduction')`),
    check(
      'salary_components_calculation_check',
      sql`${table.calculation} IN ('fixed', 'percent_of_basic')`,
    ),
    check(
      'salary_components_percent_check',
      sql`${table.defaultPercentBasisPoints} IS NULL OR (${table.defaultPercentBasisPoints} >= 0 AND ${table.defaultPercentBasisPoints} <= 100000)`,
    ),
  ],
);

export type SalaryComponent = typeof salaryComponents.$inferSelect;
export type NewSalaryComponent = typeof salaryComponents.$inferInsert;

export function isComponentKind(value: unknown): value is ComponentKind {
  return typeof value === 'string' && (COMPONENT_KINDS as readonly string[]).includes(value);
}

export function isComponentCalculation(value: unknown): value is ComponentCalculation {
  return (
    typeof value === 'string' &&
    (COMPONENT_CALCULATIONS as readonly string[]).includes(value)
  );
}

/**
 * The heads a Pakistani school's payslip normally carries, seeded on first
 * setup so a school is not asked to invent a payroll structure from an empty
 * screen.
 *
 * The percentages are the conventional split: basic, then house rent at 45% and
 * medical at 10% of it. EOBI is the employee's statutory contribution and is a
 * deduction; income tax is left at zero because it is per-person and per-slab.
 */
export const DEFAULT_SALARY_COMPONENTS: ReadonlyArray<{
  name: string;
  kind: ComponentKind;
  calculation: ComponentCalculation;
  defaultPercentBasisPoints: number | null;
  isBasic: boolean;
  proratedByAttendance: boolean;
  description: string;
  sortOrder: number;
}> = [
  {
    name: 'Basic Salary',
    kind: 'earning',
    calculation: 'fixed',
    defaultPercentBasisPoints: null,
    isBasic: true,
    proratedByAttendance: true,
    description: 'The contracted monthly base. Every percentage head is measured against it.',
    sortOrder: 1,
  },
  {
    name: 'House Rent Allowance',
    kind: 'earning',
    calculation: 'percent_of_basic',
    defaultPercentBasisPoints: 4500,
    isBasic: false,
    proratedByAttendance: true,
    description: 'Conventionally 45% of basic salary.',
    sortOrder: 2,
  },
  {
    name: 'Medical Allowance',
    kind: 'earning',
    calculation: 'percent_of_basic',
    defaultPercentBasisPoints: 1000,
    isBasic: false,
    proratedByAttendance: true,
    description: 'Conventionally 10% of basic salary.',
    sortOrder: 3,
  },
  {
    name: 'Conveyance Allowance',
    kind: 'earning',
    calculation: 'fixed',
    defaultPercentBasisPoints: null,
    isBasic: false,
    proratedByAttendance: true,
    description: 'Travel allowance, set per staff member.',
    sortOrder: 4,
  },
  {
    name: 'EOBI Contribution',
    kind: 'deduction',
    calculation: 'fixed',
    defaultPercentBasisPoints: null,
    isBasic: false,
    proratedByAttendance: false,
    description: "The employee's statutory old-age benefits contribution.",
    sortOrder: 10,
  },
  {
    name: 'Income Tax',
    kind: 'deduction',
    calculation: 'fixed',
    defaultPercentBasisPoints: null,
    isBasic: false,
    proratedByAttendance: false,
    description: 'Withheld per the applicable slab. Set per staff member.',
    sortOrder: 11,
  },
  {
    name: 'Provident Fund',
    kind: 'deduction',
    calculation: 'percent_of_basic',
    defaultPercentBasisPoints: 500,
    isBasic: false,
    proratedByAttendance: false,
    description: "The employee's share, conventionally 5% of basic salary.",
    sortOrder: 12,
  },
];
