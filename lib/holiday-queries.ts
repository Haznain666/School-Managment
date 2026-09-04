import 'server-only';

import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';

import {
  holidays,
  saturdayDutyPolicies,
  schoolUsers,
  staff,
  type Holiday,
  type HolidayType,
} from '@/db/schema';

import { db } from './drizzle';
import {
  effectiveSaturdayOrdinals,
  expandHolidays,
  workingDaysInMonth,
  type HolidayRange,
} from './holiday-calendar';
import { pakistanHolidaysFor, type SeedHoliday } from './pakistan-holidays';

import { USER_ROLES, type UserRole } from '@/types/school-auth';

/**
 * Reading and writing the school's calendar.
 *
 * ── Tenancy ──────────────────────────────────────────────────────────────
 * Every statement here filters on `location_id` from the verified session.
 * `branch_id` is a *narrowing within* that, never a substitute for it — a
 * holiday with a null campus belongs to every campus of the school and to no
 * other school.
 *
 * ── Reading needs no permission key ──────────────────────────────────────
 * Every portal user sees the calendar; that is the requirement, and a parent
 * being told when the school is shut is the whole point of publishing one.
 * `calendar.manage` gates the *writes*, and only the writes.
 */

/** Whether a `text` role column holds a role this build knows about. */
function isUserRole(value: string | null): value is UserRole {
  return value !== null && (USER_ROLES as readonly string[]).includes(value);
}

export interface HolidayRow {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  holidayType: HolidayType;
  isTentative: boolean;
  source: string;
  notes: string | null;
  branchId: string | null;
}

/**
 * Holidays overlapping a date window, school-wide plus one campus.
 *
 * ── The overlap test, and why it is not `startsOn BETWEEN` ───────────────
 * A three-day Eid beginning on 30 October is a holiday *in November* as far as
 * anybody looking at November's grid is concerned. `starts_on <= to AND ends_on
 * >= from` is the range-overlap test and it is the only one that finds it; the
 * obvious `starts_on BETWEEN from AND to` drops the first two days of every
 * month for every holiday that straddles a boundary.
 *
 * `lte` and `gte`, not a raw `sql` template. CLAUDE.md's rule, and the reason
 * is the same one that kept scheduled announcements from ever releasing: an
 * operator maps the value for the driver, a template hands it over raw.
 */
export async function listHolidays(
  locationId: string,
  from: string,
  to: string,
  branchId: string | null = null,
): Promise<HolidayRow[]> {
  return db
    .select({
      id: holidays.id,
      name: holidays.name,
      startsOn: holidays.startsOn,
      endsOn: holidays.endsOn,
      holidayType: holidays.holidayType,
      isTentative: holidays.isTentative,
      source: holidays.source,
      notes: holidays.notes,
      branchId: holidays.branchId,
    })
    .from(holidays)
    .where(
      and(
        eq(holidays.locationId, locationId),
        lte(holidays.startsOn, to),
        gte(holidays.endsOn, from),
        // Null campus means every campus. A caller narrowed to one branch sees
        // the school's own holidays as well as its campus's — a national
        // holiday closes every site, and omitting it would show a campus open
        // on 14 August.
        branchId === null
          ? undefined
          : or(isNull(holidays.branchId), eq(holidays.branchId, branchId)),
      ),
    )
    .orderBy(asc(holidays.startsOn), asc(holidays.name));
}

/** One holiday, scoped to the school. Null when it is somebody else's. */
export async function getHoliday(
  locationId: string,
  holidayId: string,
): Promise<Holiday | null> {
  const rows = await db
    .select()
    .from(holidays)
    .where(and(eq(holidays.locationId, locationId), eq(holidays.id, holidayId)))
    .limit(1);

  return rows[0] ?? null;
}

/** Every role policy this school has set, as a map. */
export async function saturdayPolicies(
  locationId: string,
): Promise<Map<string, number[]>> {
  const rows = await db
    .select({ role: saturdayDutyPolicies.role, ordinals: saturdayDutyPolicies.ordinals })
    .from(saturdayDutyPolicies)
    .where(eq(saturdayDutyPolicies.locationId, locationId));

  return new Map(rows.map((row) => [row.role, row.ordinals]));
}

/**
 * The Saturdays one signed-in person works.
 *
 * Resolved from their `staff` row when they have one and from their role's
 * policy otherwise. A parent or a pupil has neither, and gets `[]` — which is
 * correct rather than a fallback: the roster is a staff rota, and a parent
 * looking at the calendar is looking at whether the school is open.
 */
export async function saturdayOrdinalsForUser(
  locationId: string,
  schoolUserId: string | null,
  role: UserRole,
): Promise<number[]> {
  const policies = await saturdayPolicies(locationId);
  const rolePolicy = policies.get(role) ?? null;

  if (schoolUserId === null) return effectiveSaturdayOrdinals(null, rolePolicy);

  const rows = await db
    .select({ saturdayOrdinals: staff.saturdayOrdinals })
    .from(staff)
    .where(and(eq(staff.locationId, locationId), eq(staff.schoolUserId, schoolUserId)))
    .limit(1);

  return effectiveSaturdayOrdinals(rows[0]?.saturdayOrdinals ?? null, rolePolicy);
}

/** Every staff member's effective Saturday set, for the payroll and the roster. */
export async function saturdayOrdinalsByStaff(
  locationId: string,
): Promise<Map<string, number[]>> {
  const policies = await saturdayPolicies(locationId);

  const rows = await db
    .select({
      staffId: staff.id,
      own: staff.saturdayOrdinals,
      role: schoolUsers.role,
    })
    .from(staff)
    .leftJoin(schoolUsers, eq(schoolUsers.id, staff.schoolUserId))
    .where(eq(staff.locationId, locationId));

  return new Map(
    rows.map((row) => [
      row.staffId,
      effectiveSaturdayOrdinals(
        row.own,
        row.role === null ? null : (policies.get(row.role) ?? null),
      ),
    ]),
  );
}

/**
 * The dates a school is closed in a window, as a set.
 *
 * The shape every caller that asks "was the school open" actually wants, and
 * the one `isWorkingDay` and `workingDaysInMonth` take.
 */
export async function holidayDatesIn(
  locationId: string,
  from: string,
  to: string,
  branchId: string | null = null,
): Promise<Set<string>> {
  const rows = await listHolidays(locationId, from, to, branchId);
  return new Set(expandHolidays(rows as HolidayRange[], from, to).keys());
}

/**
 * Working days in a payroll month, from the school's own calendar.
 *
 * ── Which Saturdays count, and why it is the union ───────────────────────
 * `payroll_runs.working_days` is **one number for the whole run** — it is the
 * denominator every payslip in it divides by — while the Saturday roster is per
 * role and per person. There is no single true answer, so this counts a
 * Saturday as a working day when **anybody at the school is rostered on it**.
 *
 * That is the safe direction, deliberately. A denominator one day too large
 * under-docks a teacher by a fraction of a day; one too small docks somebody
 * for a Saturday nobody told them about. The first is an argument about pennies
 * and the second is an argument about trust — and the register itself is
 * already exact, because `attendanceTallyByStaff` excludes each person's own
 * non-working days per person, with the date still in hand.
 *
 * The number is still the school's to override. It simply arrives correct
 * instead of arriving as 26.
 */
export async function calendarWorkingDays(
  locationId: string,
  month: number,
  year: number,
  branchId: string | null = null,
): Promise<number> {
  const first = `${String(year)}-${String(month).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  const [holidayDates, policies, overrides] = await Promise.all([
    holidayDatesIn(locationId, first, last, branchId),
    saturdayPolicies(locationId),
    db
      .select({ saturdayOrdinals: staff.saturdayOrdinals })
      .from(staff)
      .where(and(eq(staff.locationId, locationId), eq(staff.status, 'active'))),
  ]);

  const rostered = new Set<number>();

  for (const ordinals of policies.values()) {
    for (const value of ordinals) rostered.add(value);
  }

  for (const row of overrides) {
    // Null means *no override* and contributes nothing; so does an override of
    // `[]`, which is exactly what a union of "somebody is in" should do with a
    // person who is never in.
    for (const value of row.saturdayOrdinals ?? []) rostered.add(value);
  }

  return workingDaysInMonth(year, month, holidayDates, [...rostered]);
}

export interface SeedResult {
  created: number;
  alreadyPresent: number;
  rows: SeedHoliday[];
}

/**
 * Writes a year's public holidays, skipping anything already there.
 *
 * ── Never refuses the whole run because one row exists ───────────────────
 * `lib/academic-year-runs.ts` gives the reason at length and it holds here: a
 * school that added Independence Day by hand in January and then presses *Load
 * public holidays* in February must get the other eleven, not an error naming
 * the one it already had. So the write is `onConflictDoNothing` against the two
 * partial unique indexes, and the answer says how many of each.
 *
 * ── And never overwrites a row a school has edited ───────────────────────
 * Which is the same statement, seen from the other side. A school that moved
 * Eid to the day the moon was actually sighted has a row whose `starts_on` no
 * longer matches what this function would compute — so the conflict does not
 * fire, a *second* Eid is written on the computed date, and the school has two.
 * That is why the duplicate check below is by **name and year** rather than by
 * the index's key: the index stops an exact repeat, and this stops a
 * near-repeat, which is the one a person would have to clean up.
 */
export async function seedPakistanHolidays(params: {
  locationId: string;
  year: number;
  branchId: string | null;
  actorUserId: string | null;
}): Promise<SeedResult> {
  const rows = pakistanHolidaysFor(params.year);

  const existing = await db
    .select({ name: holidays.name, startsOn: holidays.startsOn })
    .from(holidays)
    .where(
      and(
        eq(holidays.locationId, params.locationId),
        gte(holidays.startsOn, `${String(params.year)}-01-01`),
        lte(holidays.startsOn, `${String(params.year)}-12-31`),
        params.branchId === null
          ? isNull(holidays.branchId)
          : eq(holidays.branchId, params.branchId),
      ),
    );

  // Keyed on the **name**, not the date. A school that has moved Eid still has
  // an Eid; writing the computed date beside it would give them two.
  const held = new Set(existing.map((row) => row.name));
  const missing = rows.filter((row) => !held.has(row.name));

  if (missing.length > 0) {
    await db
      .insert(holidays)
      .values(
        missing.map((row) => ({
          locationId: params.locationId,
          branchId: params.branchId,
          name: row.name,
          startsOn: row.startsOn,
          endsOn: row.endsOn,
          holidayType: row.holidayType,
          isTentative: row.isTentative,
          source: 'seed' as const,
          createdBy: params.actorUserId,
        })),
      )
      // The indexes are the backstop for two people pressing the button at
      // once; the read above is what produces the count a person is shown.
      .onConflictDoNothing();
  }

  return {
    created: missing.length,
    alreadyPresent: rows.length - missing.length,
    rows,
  };
}

/** Deletes a holiday. Scoped to the school, so an id from elsewhere finds nothing. */
export async function deleteHoliday(
  locationId: string,
  holidayId: string,
): Promise<boolean> {
  const removed = await db
    .delete(holidays)
    .where(and(eq(holidays.locationId, locationId), eq(holidays.id, holidayId)))
    .returning({ id: holidays.id });

  return removed.length > 0;
}

/** Replaces every role policy this school has, in one transaction. */
export async function saveSaturdayPolicies(
  locationId: string,
  policies: ReadonlyArray<{ role: string; ordinals: number[] }>,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const policy of policies) {
      await tx
        .insert(saturdayDutyPolicies)
        .values({
          locationId,
          role: policy.role,
          ordinals: policy.ordinals,
        })
        .onConflictDoUpdate({
          target: [saturdayDutyPolicies.locationId, saturdayDutyPolicies.role],
          set: { ordinals: policy.ordinals, updatedAt: new Date() },
        });
    }
  });
}

/** Sets or clears one person's override. `null` restores the role policy. */
export async function setStaffSaturdayOrdinals(
  locationId: string,
  staffId: string,
  ordinals: number[] | null,
): Promise<boolean> {
  const updated = await db
    .update(staff)
    .set({ saturdayOrdinals: ordinals, updatedAt: new Date() })
    .where(and(eq(staff.locationId, locationId), eq(staff.id, staffId)))
    .returning({ id: staff.id });

  return updated.length > 0;
}

/** Every staff member with their own and their role's Saturday answer. */
export interface StaffSaturdayRow {
  staffId: string;
  name: string;
  employeeCode: string;
  /**
   * `school_users.role` is a plain `text` column with a CHECK, so it arrives
   * here as a string. Narrowed on the way out rather than cast, because a role
   * this build does not know about must read as "no role" — which resolves to
   * no Saturdays — rather than as a `UserRole` nothing can look up.
   */
  role: UserRole | null;
  designation: string | null;
  /** Null means "use the role policy" — see `db/schema/staff.ts`. */
  own: number[] | null;
  rolePolicy: number[] | null;
  effective: number[];
}

export async function listStaffSaturdayDuty(
  locationId: string,
  staffIds?: readonly string[],
): Promise<StaffSaturdayRow[]> {
  const policies = await saturdayPolicies(locationId);

  const rows = await db
    .select({
      staffId: staff.id,
      firstName: staff.firstName,
      lastName: staff.lastName,
      employeeCode: staff.employeeCode,
      designation: staff.designation,
      own: staff.saturdayOrdinals,
      role: schoolUsers.role,
    })
    .from(staff)
    .leftJoin(schoolUsers, eq(schoolUsers.id, staff.schoolUserId))
    .where(
      and(
        eq(staff.locationId, locationId),
        eq(staff.status, 'active'),
        staffIds === undefined ? undefined : inArray(staff.id, [...staffIds]),
      ),
    )
    .orderBy(asc(staff.firstName), asc(staff.lastName));

  return rows.map((row) => {
    const role = isUserRole(row.role) ? row.role : null;
    const rolePolicy = role === null ? null : (policies.get(role) ?? null);

    return {
      staffId: row.staffId,
      name: `${row.firstName} ${row.lastName}`.trim(),
      employeeCode: row.employeeCode,
      role,
      designation: row.designation,
      own: row.own,
      rolePolicy,
      effective: effectiveSaturdayOrdinals(row.own, rolePolicy),
    };
  });
}
