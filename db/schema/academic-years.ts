import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { schools } from './schools';

/**
 * academic_years — the session a school runs, e.g. "2025-2026".
 *
 * Pakistani schools do not share one calendar: an April–March school and an
 * August–July school both exist, so the window is stored as month/year pairs
 * rather than inferred from a single year number (Sprint 4, Decision 2).
 *
 * `is_active` marks the year that new enrolments and dashboards default to.
 * Exactly one row per school should carry it; the API enforces that on write
 * rather than a partial unique index, because activating a year has to
 * deactivate the incumbent — a constraint would reject that instead of
 * resolving it.
 */
export const academicYears = pgTable(
  'academic_years',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** Display name, derived from the start and end years: `2025-2026`. */
    name: text('name').notNull(),
    /** 1–12. */
    startMonth: integer('start_month').notNull(),
    startYear: integer('start_year').notNull(),
    /** 1–12. */
    endMonth: integer('end_month').notNull(),
    endYear: integer('end_year').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('academic_years_location_id_idx').on(table.locationId),
    index('academic_years_location_id_is_active_idx').on(
      table.locationId,
      table.isActive,
    ),
    check(
      'academic_years_start_month_check',
      sql`${table.startMonth} BETWEEN 1 AND 12`,
    ),
    check('academic_years_end_month_check', sql`${table.endMonth} BETWEEN 1 AND 12`),
  ],
);

export type AcademicYear = typeof academicYears.$inferSelect;
export type NewAcademicYear = typeof academicYears.$inferInsert;

/** Month names in calendar order, for pickers and formatted labels. */
export const MONTH_NAMES: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `2025 -> 2026` becomes `2025-2026`; a single-year session stays `2025`. */
export function academicYearName(startYear: number, endYear: number): string {
  return startYear === endYear ? String(startYear) : `${startYear}-${endYear}`;
}

/** `3, 2025` -> `March 2025`. Out-of-range months degrade to the raw number. */
export function formatMonthYear(month: number, year: number): string {
  return `${MONTH_NAMES[month - 1] ?? String(month)} ${year}`;
}

/**
 * Checks that a session actually moves forwards in time.
 * Returns the reason it does not, or null when the window is valid.
 */
export function academicYearRangeProblem(range: {
  startMonth: number;
  startYear: number;
  endMonth: number;
  endYear: number;
}): string | null {
  const { startMonth, startYear, endMonth, endYear } = range;

  for (const month of [startMonth, endMonth]) {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return 'Months must be between 1 and 12.';
    }
  }

  for (const year of [startYear, endYear]) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return 'Years must be between 2000 and 2100.';
    }
  }

  if (endYear < startYear || (endYear === startYear && endMonth <= startMonth)) {
    return 'The academic year must end after it starts.';
  }

  return null;
}
