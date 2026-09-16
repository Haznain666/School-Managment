import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { branches } from './branches';
import { schoolUsers } from './school-users';
import { schools } from './schools';
// Staff and students share one gender vocabulary; defining a second would let
// the two drift apart for no reason anyone could name.
import { GENDERS, type Gender } from './student-profiles';
import { users } from './users';

export const STAFF_STATUSES = ['active', 'on_leave', 'resigned'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const STAFF_STATUS_LABELS: Record<StaffStatus, string> = {
  active: 'Active',
  on_leave: 'On leave',
  resigned: 'Resigned',
};

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'visiting',
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
  visiting: 'Visiting',
};

/**
 * staff — the employment record behind a member of school staff.
 *
 * ── On the two user links ────────────────────────────────────────────────
 * `user_id` points at Sprint 1's `users` table and `school_user_id` at the
 * `school_users` table the portal actually signs people in against. Both are
 * nullable, because an employment record has to exist for people who do not
 * sign in at all: a driver or a cleaner is on the payroll and never opens the
 * portal, and requiring a login account before HR could record them would push
 * a school back onto a spreadsheet for half its staff.
 *
 * `school_user_id` is the one Sprint 7 writes and reads. Linking it lets the
 * same person's portal role and their employment record stay one record rather
 * than two that drift.
 */
export const staff = pgTable(
  'staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    /** Sprint 1's user directory. Null for staff with no login. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** The portal account, when this person signs in. Null otherwise. */
    schoolUserId: uuid('school_user_id').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    /** School-assigned employee code. Unique within a school. */
    employeeCode: text('employee_code').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    /** Job title as printed on the contract, e.g. "Senior Physics Teacher". */
    designation: text('designation'),
    department: text('department'),
    employmentType: text('employment_type').$type<EmploymentType>(),
    joinedOn: date('joined_on'),
    status: text('status').notNull().default('active').$type<StaffStatus>(),
    /**
     * Whether this person is eligible to be a class teacher (home room).
     *
     * A flag on the *person*, not an assignment: `sections.class_teacher_id` is
     * the assignment, and this is what decides who a section's picker may
     * offer. Two columns because the two are different facts — a school has
     * more class teachers than it has sections at any moment, and a teacher who
     * hands over their class in February has not stopped being one.
     *
     * It is also what gates `/teacher/promotions`: the override of a promotion
     * status belongs to the class teacher of that section and to nobody else,
     * including a subject teacher timetabled to it.
     */
    isClassTeacher: boolean('is_class_teacher').notNull().default(false),

    // -- Personal detail, added in Sprint 7 for HR ---------------------------
    phone: text('phone'),
    email: text('email'),
    /** National identity number. Payroll and statutory filings need it. */
    cnic: text('cnic'),
    dateOfBirth: date('date_of_birth'),
    gender: text('gender').$type<Gender>(),
    address: text('address'),
    qualification: text('qualification'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    /**
     * The personnel photograph (Sprint 23, item 5). Migration `0039`.
     *
     * The public download URL of an object the *server* uploaded, at a path
     * derived from verified claims — the same posture, byte for byte, as
     * `student_profiles.photo_url`. A second posture would be a second place
     * for the tenant prefix to be got wrong.
     *
     * Null is the ordinary case and stays it: the list and the profile fall
     * back to the initials `Avatar` that is already there, and there is no
     * placeholder silhouette.
     *
     * Deliberately not `school_users.avatar_url`. That is the sign-in account's
     * picture; conflating the two would mean an HR clerk filing a personnel
     * photograph and changing somebody's login identity.
     */
    photoUrl: text('photo_url'),

    // -- Where the salary is sent -------------------------------------------
    bankAccountTitle: text('bank_account_title'),
    bankAccountNumber: text('bank_account_number'),
    bankName: text('bank_name'),

    /**
     * Which Saturdays this person is called in on, overriding their role's
     * policy (Sprint 27).
     *
     * ⚠ **Null and `{}` are one character apart and opposite.**
     *
     *   · `null` — no override. Use `saturday_duty_policies` for their role,
     *     which is what almost every member of staff carries.
     *   · `{}`   — an override that says **no Saturdays**, for the person whose
     *     role is called in every week and who is not.
     *
     * Collapsing the two would make it impossible to excuse one teacher from a
     * Saturday rota without excusing every teacher, and impossible to say so on
     * a screen. Every reader goes through `effectiveSaturdayOrdinals` in
     * `lib/holiday-calendar.ts`, which is where the `??` lives — not `||`,
     * which would treat the empty array as absent and hand the person their
     * role's Saturdays back.
     *
     * Values are 1–5: which Saturday of its own month.
     */
    saturdayOrdinals: integer('saturday_ordinals').array(),

    /**
     * The date this person became permanent (Sprint 33b, decision 5).
     *
     * ── It is the date leave starts accruing, and nothing else ───────────
     * Entitlement is **pro-rated from here** against the school's academic year
     * and **lapses** at the end of it — no carry-forward (decision 10). Somebody
     * made permanent in January at a school running August–July gets seven
     * twelfths of each head's annual quota for that year, and a fresh whole
     * one in August.
     *
     * Null is the ordinary state for a school that has not started using
     * probation, and it means **the whole year's quota**. That is deliberate:
     * treating null as "not permanent, no leave" would take every existing
     * teacher's entitlement away on the day this deploys, silently, on a screen
     * that had always shown a number. `lib/leave-quota.ts` is the one place
     * that decides it.
     *
     * Deliberately separate from `joined_on`. A person joins on probation and
     * becomes permanent later; conflating the two grants six months of leave
     * that was never earned.
     */
    permanentFrom: date('permanent_from'),

    /*
     * Probation (Sprint 33b, decision 4).
     *
     * ── 180 calendar days is a ceiling, holidays included ────────────────
     * `probation_days + probation_extended_days <= 180`, enforced by a CHECK
     * below *and* by the API, and counted in plain calendar days rather than
     * working ones — that is what the product owner said and it is the number a
     * labour contract is written in. An extension may not push past it.
     *
     * `probation_ends_on` is computed on write rather than by a trigger or a
     * generated column: extending probation is a decision somebody makes with a
     * date in front of them, and a column the database recomputes behind them
     * would move a person's end date the next time an unrelated field was
     * saved.
     *
     * `probation_notified_at` is a **claim**, not a log line. The sweep in
     * `lib/probation-notifier.ts` moves it with a conditional
     * `UPDATE … RETURNING` before it emails HR, because production runs seven
     * scheduler processes and a read-then-`if` would send seven emails.
     */
    isOnProbation: boolean('is_on_probation').notNull().default(false),
    probationDays: integer('probation_days'),
    probationStartedOn: date('probation_started_on'),
    probationEndsOn: date('probation_ends_on'),
    probationExtendedDays: integer('probation_extended_days').notNull().default(0),
    probationNotifiedAt: timestamp('probation_notified_at', { withTimezone: true }),

    /** Set when the person leaves. Payroll skips them from this date. */
    resignedOn: date('resigned_on'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('staff_location_id_idx').on(table.locationId),
    index('staff_location_id_branch_id_idx').on(table.locationId, table.branchId),
    index('staff_location_id_status_idx').on(table.locationId, table.status),
    index('staff_school_user_id_idx').on(table.schoolUserId),
    uniqueIndex('staff_location_id_employee_code_idx').on(
      table.locationId,
      table.employeeCode,
    ),
    check(
      'staff_status_check',
      sql`${table.status} IN ('active', 'on_leave', 'resigned')`,
    ),
    check(
      'staff_employment_type_check',
      sql`${table.employmentType} IS NULL OR ${table.employmentType} IN ('full_time', 'part_time', 'contract', 'visiting')`,
    ),
    check(
      'staff_gender_check',
      sql.raw(
        `gender IS NULL OR gender IN (${GENDERS.map((value) => `'${value}'`).join(', ')})`,
      ),
    ),
    // Sprint 33b. The 180-day ceiling, in the database as well as in the API.
    // A ceiling enforced only by a route is a ceiling the next route forgets.
    check(
      'staff_probation_days_check',
      sql`${table.probationDays} IS NULL
          OR (${table.probationDays} BETWEEN 1 AND 180
              AND ${table.probationDays} + ${table.probationExtendedDays} <= 180)`,
    ),
    check('staff_probation_extended_check', sql`${table.probationExtendedDays} >= 0`),
  ],
);

/** The longest anybody may be kept on probation, in calendar days. */
export const MAX_PROBATION_DAYS = 180;

export type { Gender };

export type Staff = typeof staff.$inferSelect;
export type NewStaff = typeof staff.$inferInsert;

export function isStaffStatus(value: unknown): value is StaffStatus {
  return typeof value === 'string' && (STAFF_STATUSES as readonly string[]).includes(value);
}

export function isEmploymentType(value: unknown): value is EmploymentType {
  return (
    typeof value === 'string' && (EMPLOYMENT_TYPES as readonly string[]).includes(value)
  );
}

/** "Ayesha Khan" from the two name columns. */
export function staffFullName(row: { firstName: string; lastName: string }): string {
  return `${row.firstName} ${row.lastName}`.trim();
}
