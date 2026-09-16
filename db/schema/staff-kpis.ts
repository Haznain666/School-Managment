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

import { academicYears } from './academic-years';
import { branches } from './branches';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * Sprint 32 — staff KPIs and performance. Migration `0045`. STATE.md §5ca is
 * the requirement; `lib/kpi-access.ts` is where every rule is enforced.
 *
 * ── Named `staff_kpis`, not `kpis` ───────────────────────────────────────
 * "KPI" already means two unrelated things in this product: the setup panel's
 * per-fee-head figures and the dashboard's stat tiles. A grep for `kpi` should
 * not return three features, so the tables and the screen say *staff*.
 */

/** The two cadences. Both are rated on the same 1–10 scale. */
export const STAFF_KPI_PERIODS = ['monthly', 'annual'] as const;
export type StaffKpiPeriod = (typeof STAFF_KPI_PERIODS)[number];

/**
 * The roles a KPI can be written for. A KPI belongs to a **role**, never to a
 * person. `school_admin` is absent: there is nobody senior to rate them.
 */
export const STAFF_KPI_TARGET_ROLES = [
  'principal',
  'vice_principal',
  'branch_admin',
  // Sprint 33b. A Section Head is rated by the heads above them, which is why
  // they join this list and why `0047` rewrites `staff_kpis_target_role_check`
  // — a KPI written for the new role would otherwise be a 23514 on the first
  // save. `kpis.rate.section_head` is the key that permits it.
  'section_head',
  'coordinator',
  'teacher',
  'hr_manager',
  'accountant',
  'marketing',
] as const;
export type StaffKpiTargetRole = (typeof STAFF_KPI_TARGET_ROLES)[number];

/** How a teacher's one principal was reached (rule 7b). */
export const TEACHER_PRINCIPAL_SOURCES = ['derived', 'transferred', 'assigned'] as const;
export type TeacherPrincipalSource = (typeof TEACHER_PRINCIPAL_SOURCES)[number];

export const PRINCIPAL_TRANSFER_STATUSES = [
  'requested',
  'accepted',
  'declined',
  'cancelled',
] as const;
export type PrincipalTransferStatus = (typeof PRINCIPAL_TRANSFER_STATUSES)[number];

/**
 * staff_kpis — one expectation, for one role.
 *
 * ── Deleted is a timestamp, not a missing row ────────────────────────────
 * A KPI that has been rated has ratings pointing at it, and a rating is an
 * audit record (see below). Deleting the KPI would either cascade those away
 * or be refused forever. `deleted_at` hides it from every screen and every
 * score while keeping what was said about somebody in March answerable in May.
 *
 * ── `branch_id` is nullable and means shared ─────────────────────────────
 * The same convention as the catalogue tables of decision D1: null is a KPI
 * the whole school uses, and a campus id is one a branch administrator wrote
 * for their own campus. Read with `sharedOrOwnedBy`, never `eq`.
 */
export const staffKpis = pgTable(
  'staff_kpis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    targetRole: text('target_role').notNull().$type<StaffKpiTargetRole>(),
    name: text('name').notNull(),
    description: text('description'),
    period: text('period').notNull().$type<StaffKpiPeriod>(),
    createdBy: uuid('created_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('staff_kpis_location_role_idx').on(table.locationId, table.targetRole),
    check(
      'staff_kpis_target_role_check',
      sql.raw(
        `target_role IN (${STAFF_KPI_TARGET_ROLES.map((role) => `'${role}'`).join(', ')})`,
      ),
    ),
    check('staff_kpis_period_check', sql`${table.period} IN ('monthly', 'annual')`),
    check('staff_kpis_name_check', sql`length(${table.name}) BETWEEN 1 AND 80`),
  ],
);

/**
 * staff_kpi_ratings — every score anybody has entered. **Append-only.**
 *
 * ── Why a change is a new row ────────────────────────────────────────────
 * A disputed appraisal is asked about months later, and "it says 6 now" is not
 * an answer — the same argument the ledger rule makes. So changing a rating
 * inserts a row and the *latest row per rater* is that rater's current answer.
 * A trigger in `0045` refuses `UPDATE` outright.
 *
 * ── Why a junior rating is stored and then ignored ───────────────────────
 * Rule 5: when two people rate the same KPI for the same person and period,
 * the senior rater's score counts. That is resolved when the score is *read*
 * (`countingRating` in `lib/kpis.ts`). Overwriting the coordinator's row when
 * the principal rates would destroy the record rule 5 says to keep.
 *
 * ── The rater is snapshotted ─────────────────────────────────────────────
 * `rater_role` decides seniority, and a person's role can change. The rating
 * counts as whatever its author was when they entered it. `rater_name` survives
 * the account being deleted, which sets `rater_user_id` null.
 *
 * `period_month` is the first day of the month for a monthly KPI and null for
 * an annual one; `academic_year_id` is set on both, and is what the yearly
 * overall averages over.
 */
export const staffKpiRatings = pgTable(
  'staff_kpi_ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    kpiId: uuid('kpi_id')
      .notNull()
      .references(() => staffKpis.id, { onDelete: 'cascade' }),
    ratedUserId: uuid('rated_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    periodMonth: date('period_month'),
    score: integer('score').notNull(),
    comment: text('comment'),
    raterUserId: uuid('rater_user_id').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    raterRole: text('rater_role').notNull(),
    raterName: text('rater_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('staff_kpi_ratings_person_year_idx').on(
      table.locationId,
      table.ratedUserId,
      table.academicYearId,
    ),
    index('staff_kpi_ratings_location_year_idx').on(table.locationId, table.academicYearId),
    index('staff_kpi_ratings_kpi_idx').on(table.kpiId),
    check('staff_kpi_ratings_score_check', sql`${table.score} BETWEEN 1 AND 10`),
    check(
      'staff_kpi_ratings_month_check',
      sql`${table.periodMonth} IS NULL OR extract(day from ${table.periodMonth}) = 1`,
    ),
  ],
);

/**
 * staff_kpi_settings — rule 7's two School Admin settings, one row per school.
 *
 * No row means the defaults: nobody marks principals or branch admins, and
 * the rater lists hold only `school_admin`. With *No*, that role's KPIs are
 * hidden from rating screens, never deleted — switching it back on loses
 * nothing.
 *
 * A table of its own rather than four columns on `schools`, because `schools`
 * is read on every request and `lib/principal-resolver.ts` records what a new
 * column there costs in the window between deploy and migration.
 */
export const staffKpiSettings = pgTable(
  'staff_kpi_settings',
  {
    locationId: text('location_id')
      .primaryKey()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    ratePrincipals: boolean('rate_principals').notNull().default(false),
    /** Any of `school_admin`, `self`, `branch_admin`. */
    principalRaters: text('principal_raters')
      .array()
      .notNull()
      .default(sql`ARRAY['school_admin']::text[]`),
    rateBranchAdmins: boolean('rate_branch_admins').notNull().default(false),
    /** Any of `school_admin`, `self`, `principal`. */
    branchAdminRaters: text('branch_admin_raters')
      .array()
      .notNull()
      .default(sql`ARRAY['school_admin']::text[]`),
    updatedBy: uuid('updated_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'staff_kpi_settings_principal_raters_check',
      sql`${table.principalRaters} <@ ARRAY['school_admin', 'self', 'branch_admin']::text[]`,
    ),
    check(
      'staff_kpi_settings_branch_admin_raters_check',
      sql`${table.branchAdminRaters} <@ ARRAY['school_admin', 'self', 'principal']::text[]`,
    ),
  ],
);

/**
 * coordinator_teachers — which teachers a coordinator supervises (rule 8).
 *
 * Teacher by teacher, at the coordinator's own campus. School policy decides
 * who a Prep coordinator oversees, so what is stored is the people, never a
 * grade; a form may offer "every Nursery teacher" as a shortcut that fills the
 * list. Made by a Principal only.
 */
export const coordinatorTeachers = pgTable(
  'coordinator_teachers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    coordinatorUserId: uuid('coordinator_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    teacherUserId: uuid('teacher_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    assignedBy: uuid('assigned_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('coordinator_teachers_pair_idx').on(
      table.coordinatorUserId,
      table.teacherUserId,
    ),
    index('coordinator_teachers_location_teacher_idx').on(
      table.locationId,
      table.teacherUserId,
    ),
    check(
      'coordinator_teachers_distinct_check',
      sql`${table.coordinatorUserId} <> ${table.teacherUserId}`,
    ),
  ],
);

/**
 * vice_principal_principals — which principal a vice principal serves.
 *
 * Only consulted at a school running several principals, where rule 7c says a
 * deputy reaches "the teachers of the principal they serve". Nothing else in
 * the schema records that, and guessing it from a campus would hand a deputy
 * two heads' staff at a campus running O-Levels and Matric side by side.
 */
export const vicePrincipalPrincipals = pgTable(
  'vice_principal_principals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    vicePrincipalUserId: uuid('vice_principal_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    principalUserId: uuid('principal_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    setBy: uuid('set_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('vice_principal_principals_deputy_idx').on(table.vicePrincipalUserId),
    index('vice_principal_principals_location_idx').on(table.locationId),
  ],
);

/**
 * teacher_principals — every teacher's one principal (rule 7b), and its history.
 *
 * ── One current row per teacher, enforced ────────────────────────────────
 * A partial unique index on `(location_id, teacher_user_id) WHERE ended_at IS
 * NULL` is what makes "one teacher, one principal" a fact and not a habit.
 * Payroll approval still unions campus and grades, so the two can disagree
 * about a teacher timetabled across two divisions; that is recorded in §5ca.
 *
 * ── Derived rows move; transferred rows stay ─────────────────────────────
 * `derived` is recomputed from the timetable whenever the KPI screens resolve
 * it. `transferred` (a principal's accepted request) and `assigned` (the
 * School Admin settling a tie) are not: a later timetable change does not undo
 * a transfer. Ended rows are kept — "who was her head in March" is a question.
 */
export const teacherPrincipals = pgTable(
  'teacher_principals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    teacherUserId: uuid('teacher_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    principalUserId: uuid('principal_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    source: text('source').notNull().$type<TeacherPrincipalSource>(),
    /** The periods behind a derivation; null for a transfer or an assignment. */
    periods: integer('periods'),
    requestedBy: uuid('requested_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('teacher_principals_current_idx')
      .on(table.locationId, table.teacherUserId)
      .where(sql`${table.endedAt} IS NULL`),
    index('teacher_principals_location_principal_idx').on(
      table.locationId,
      table.principalUserId,
    ),
    check(
      'teacher_principals_source_check',
      sql`${table.source} IN ('derived', 'transferred', 'assigned')`,
    ),
  ],
);

/**
 * teacher_principal_transfers — a principal asking for a teacher to move.
 *
 * A request has a state because the other principal has to accept it (fourth
 * pass, confirmation 3). One open request per teacher; decided requests are
 * kept, for the same reason ratings are.
 */
export const teacherPrincipalTransfers = pgTable(
  'teacher_principal_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    teacherUserId: uuid('teacher_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    fromPrincipalUserId: uuid('from_principal_user_id').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    toPrincipalUserId: uuid('to_principal_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default('requested').$type<PrincipalTransferStatus>(),
    note: text('note'),
    decidedBy: uuid('decided_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('teacher_principal_transfers_open_idx')
      .on(table.locationId, table.teacherUserId)
      .where(sql`${table.status} = 'requested'`),
    check(
      'teacher_principal_transfers_status_check',
      sql`${table.status} IN ('requested', 'accepted', 'declined', 'cancelled')`,
    ),
  ],
);

export type StaffKpi = typeof staffKpis.$inferSelect;
export type StaffKpiRating = typeof staffKpiRatings.$inferSelect;
export type TeacherPrincipal = typeof teacherPrincipals.$inferSelect;
export type TeacherPrincipalTransfer = typeof teacherPrincipalTransfers.$inferSelect;
