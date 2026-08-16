import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { branches } from './branches';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * principal_assignments — BR4, the school that runs two heads.
 *
 * Real for Pakistani schools running O-Levels and Matric under separate
 * principals, or a group running one head per campus. The question the product
 * has to answer is "whose school is this screen about", and until now the
 * answer was "all of it", because `principal` was one role held by one person.
 *
 * ── The role does not multiply; the assignment does ───────────────────────
 * The source document proposed a dynamic `principal_${divisionSlug}` role. That
 * is refused deliberately and `SPRINTS.md` says so: `school_users.role` is a
 * `text` column with a CHECK constraint, and a role invented per division puts
 * unbounded user-supplied values inside it. Every permission default, every
 * `allowedRoles` list and the whole Sprint 8 permission matrix are keyed on a
 * closed set of roles; opening it would make `DEFAULT_ROLE_PERMISSIONS` unable
 * to name its own keys.
 *
 * So the role stays `principal` and carries exactly the permissions it always
 * did. A row here narrows what that principal *sees*: a branch, a division, or
 * both. Two principals at one school are two rows, not two roles.
 *
 * ── Why a division is a name and not a foreign key ────────────────────────
 * "O-Levels", "Matric", "Girls' Wing" are how a school describes the split, and
 * there is no table in this schema they correspond to. Modelling them as a new
 * entity would mean a school configuring divisions before it could name one,
 * and then keeping that list in step with the grades that actually belong to
 * each. `lib/principal-resolver.ts` matches a division to grades by the grade
 * names the school assigns to it, which is a rule a head can read.
 *
 * ── Dates, because a head's tenure ends ───────────────────────────────────
 * `starts_on` is required and `ends_on` is nullable — an open assignment is the
 * common case. An expired row is kept rather than deleted: "who signed this
 * report card in 2025" is a question a school gets asked, and a deleted row
 * answers it with silence. The resolver filters on the date; nothing else does.
 */

/**
 * How many heads a school runs.
 *
 * `single` is the default and is what every existing school is. It means the
 * resolver returns an unnarrowed scope and no assignment screen appears — a
 * school with one principal must not be made to configure one.
 */
export const PRINCIPAL_MODELS = ['single', 'multiple'] as const;
export type PrincipalModel = (typeof PRINCIPAL_MODELS)[number];

export const PRINCIPAL_MODEL_LABELS: Record<PrincipalModel, string> = {
  single: 'One principal for the whole school',
  multiple: 'Separate principals by campus or division',
};

export function isPrincipalModel(value: unknown): value is PrincipalModel {
  return typeof value === 'string' && (PRINCIPAL_MODELS as readonly string[]).includes(value);
}

/** Longest a division name may be, enforced by the API as well as here. */
export const MAX_DIVISION_NAME_LENGTH = 60;

export const principalAssignments = pgTable(
  'principal_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /**
     * The principal. Cascades: an assignment to a deleted account is not a
     * record worth keeping, because the thing it scoped no longer signs in.
     */
    schoolUserId: uuid('school_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    /** The campus this head runs. Null = every campus. */
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    /**
     * The division this head runs, as the school names it. Null = the whole
     * school within `branchId`.
     *
     * Null on both columns is a legal row and means "this principal runs
     * everything" — the same scope a single-principal school has. It is allowed
     * because a group with three campus heads and one overall head is a real
     * arrangement, and refusing it would push that school back to `single`.
     */
    divisionName: text('division_name'),
    /**
     * Which grades this division covers, by grade id.
     *
     * Stored as a text array rather than a join table: it is read whole on
     * every request that resolves a principal's scope, it is never queried
     * across rows, and a join table would add a second write to every edit of
     * a list that is edited as a list. Empty means the division is named but
     * has no grades yet, which the resolver treats as reaching no grades — a
     * head who has been given an empty division sees an empty school and is
     * told why, rather than silently seeing all of it.
     */
    gradeIds: text('grade_ids').array().notNull().default(sql`ARRAY[]::text[]`),
    startsOn: date('starts_on').notNull(),
    /** Null = still in post. */
    endsOn: date('ends_on'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('principal_assignments_location_id_idx').on(table.locationId),
    // The resolver's own read: this school, this person, ordered by date.
    index('principal_assignments_location_user_idx').on(
      table.locationId,
      table.schoolUserId,
    ),
    check(
      'principal_assignments_dates_check',
      sql`${table.endsOn} IS NULL OR ${table.endsOn} >= ${table.startsOn}`,
    ),
    check(
      'principal_assignments_division_check',
      sql`${table.divisionName} IS NULL OR length(${table.divisionName}) BETWEEN 1 AND 60`,
    ),
  ],
);

export type PrincipalAssignment = typeof principalAssignments.$inferSelect;
export type NewPrincipalAssignment = typeof principalAssignments.$inferInsert;
