import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import {
  branches,
  calendarCategoryForRole,
  holidays,
  staffCalendarOverrides,
  staffCalendars,
  STAFF_CALENDAR_CATEGORIES,
  STAFF_CALENDAR_CATEGORY_LABELS,
  type StaffCalendarCategory,
} from '@/db/schema';
import type { UserRole } from '@/types/school-auth';

import { db } from './drizzle';
import { expandHolidays, type HolidayRange } from './holiday-calendar';
import { listHolidays } from './holiday-queries';

/**
 * `lib/staff-calendar-queries.ts` — the two staff calendars. Sprint 33b.
 *
 * ── A calendar is a filter, not a second holiday list ────────────────────
 * `holidays` remains the one list of days the school is shut — the gazetted
 * ones from `lib/pakistan-holidays.ts`, the seed that loads them, and whatever
 * the school has added. A staff calendar says which of them apply to which
 * people, and on what dates.
 *
 * The alternative — a holiday row per calendar — doubles every gazetted
 * holiday, and the day a school corrects a tentative Eid date on one of them it
 * has two calendars disagreeing about whether it is open, with nothing to say
 * which is right. `db/schema/staff-calendars.ts` states the decision; this is
 * where it is read.
 *
 * ── Every read is tenant-scoped and campus-aware ─────────────────────────
 * A calendar with a null `branch_id` is the school's own and is used by every
 * campus that has not made one. That is also every school on the day this
 * deploys, which is what makes the feature inert until somebody uses it.
 */

export interface StaffCalendarRow {
  id: string;
  branchId: string | null;
  branchName: string | null;
  category: StaffCalendarCategory;
  name: string;
  overrideCount: number;
}

/** Every calendar a caller may see, school-wide ones first. */
export async function listStaffCalendars(
  locationId: string,
  branchIds: string[] | null = null,
): Promise<StaffCalendarRow[]> {
  const rows = await db
    .select({
      id: staffCalendars.id,
      branchId: staffCalendars.branchId,
      branchName: branches.name,
      category: staffCalendars.category,
      name: staffCalendars.name,
    })
    .from(staffCalendars)
    .leftJoin(branches, eq(branches.id, staffCalendars.branchId))
    .where(eq(staffCalendars.locationId, locationId))
    .orderBy(asc(staffCalendars.branchId), asc(staffCalendars.category));

  const visible =
    branchIds === null
      ? rows
      : // A null campus means "the whole school", so it stays visible to a
        // campus-bound reader exactly as a school-wide holiday does.
        rows.filter((row) => row.branchId === null || branchIds.includes(row.branchId));

  if (visible.length === 0) return [];

  const overrides = await db
    .select({ calendarId: staffCalendarOverrides.calendarId })
    .from(staffCalendarOverrides)
    .where(
      and(
        eq(staffCalendarOverrides.locationId, locationId),
        inArray(
          staffCalendarOverrides.calendarId,
          visible.map((row) => row.id),
        ),
      ),
    );

  const counts = new Map<string, number>();
  for (const row of overrides) {
    counts.set(row.calendarId, (counts.get(row.calendarId) ?? 0) + 1);
  }

  return visible.map((row) => ({ ...row, overrideCount: counts.get(row.id) ?? 0 }));
}

/**
 * Creates whichever of the two calendars a campus is missing, and returns them
 * all.
 *
 * Idempotent through the two partial unique indexes: pressing the button twice
 * writes nothing the second time, which is the same contract the leave-type and
 * holiday seeds have. A school that has tuned the names keeps them.
 */
export async function ensureStaffCalendars(
  locationId: string,
  branchId: string | null,
  createdBy: string | null,
): Promise<StaffCalendarRow[]> {
  await db
    .insert(staffCalendars)
    .values(
      STAFF_CALENDAR_CATEGORIES.map((category) => ({
        locationId,
        branchId,
        category,
        name: STAFF_CALENDAR_CATEGORY_LABELS[category],
        createdBy,
      })),
    )
    .onConflictDoNothing();

  return listStaffCalendars(locationId);
}

/** One calendar, scoped to the school. Null when it belongs to somebody else. */
export async function getStaffCalendar(
  locationId: string,
  calendarId: string,
): Promise<{
  id: string;
  branchId: string | null;
  category: StaffCalendarCategory;
  name: string;
} | null> {
  const rows = await db
    .select({
      id: staffCalendars.id,
      branchId: staffCalendars.branchId,
      category: staffCalendars.category,
      name: staffCalendars.name,
    })
    .from(staffCalendars)
    .where(and(eq(staffCalendars.locationId, locationId), eq(staffCalendars.id, calendarId)))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * The calendar one person is on: their campus's, or the school's.
 *
 * Null when the school has never created one, and that is a supported state
 * rather than an error — `staffHolidayDates` then answers with the plain
 * holiday list, which is exactly what the product did before this table
 * existed.
 */
export async function resolveCalendarFor(
  locationId: string,
  branchId: string | null,
  category: StaffCalendarCategory,
): Promise<{ id: string; branchId: string | null } | null> {
  const rows = await db
    .select({ id: staffCalendars.id, branchId: staffCalendars.branchId })
    .from(staffCalendars)
    .where(
      and(eq(staffCalendars.locationId, locationId), eq(staffCalendars.category, category)),
    );

  // The campus's own beats the school's. `asc(branchId)` would put nulls
  // wherever the collation felt like, so the choice is made here in the open.
  return (
    rows.find((row) => branchId !== null && row.branchId === branchId) ??
    rows.find((row) => row.branchId === null) ??
    null
  );
}

export interface CalendarOverrideRow {
  id: string;
  holidayId: string;
  holidayName: string;
  startsOn: string;
  endsOn: string;
  appliesToRoles: string[];
  isCancelled: boolean;
  movedStartsOn: string | null;
  movedEndsOn: string | null;
  notify: boolean;
  notifiedAt: Date | null;
}

/** Every override on one calendar, with the holiday each one is about. */
export async function listCalendarOverrides(
  locationId: string,
  calendarId: string,
): Promise<CalendarOverrideRow[]> {
  return db
    .select({
      id: staffCalendarOverrides.id,
      holidayId: staffCalendarOverrides.holidayId,
      holidayName: holidays.name,
      startsOn: holidays.startsOn,
      endsOn: holidays.endsOn,
      appliesToRoles: staffCalendarOverrides.appliesToRoles,
      isCancelled: staffCalendarOverrides.isCancelled,
      movedStartsOn: staffCalendarOverrides.movedStartsOn,
      movedEndsOn: staffCalendarOverrides.movedEndsOn,
      notify: staffCalendarOverrides.notify,
      notifiedAt: staffCalendarOverrides.notifiedAt,
    })
    .from(staffCalendarOverrides)
    .innerJoin(holidays, eq(holidays.id, staffCalendarOverrides.holidayId))
    .where(
      and(
        eq(staffCalendarOverrides.locationId, locationId),
        eq(staffCalendarOverrides.calendarId, calendarId),
      ),
    )
    .orderBy(asc(holidays.startsOn), asc(holidays.name));
}

export interface StaffHolidayWindow {
  /** Every date the school is closed **to this person**. */
  dates: Set<string>;
  /** What it is called, for the refusal sentence. */
  nameFor: Map<string, string>;
}

/**
 * The days one person is not expected in, between two dates.
 *
 * ── The three steps, in order ────────────────────────────────────────────
 *   1. the school's holidays for their campus — `listHolidays`, unchanged,
 *      which already admits school-wide rows for a campus reader;
 *   2. their calendar's overrides, narrowed to the ones naming their role (an
 *      empty `applies_to_roles` names everybody on that calendar);
 *   3. cancelled holidays dropped, moved ones replaced by their new dates —
 *      including a holiday that has been moved **into** this window from
 *      outside it, which is why the overrides are read for the calendar rather
 *      than for the holidays the first step happened to find.
 *
 * `role` is nullable for the junior teacher of decision 6, who has no account.
 * They are on the teaching calendar, which is the only sensible reading of a
 * person whose job title is "teacher" and who has no login.
 */
export async function staffHolidayDates(
  locationId: string,
  params: { branchId: string | null; role: UserRole | null; from: string; to: string },
): Promise<StaffHolidayWindow> {
  const role: UserRole = params.role ?? 'teacher';
  const category = calendarCategoryForRole(role);

  const [rows, calendar] = await Promise.all([
    listHolidays(locationId, params.from, params.to, params.branchId),
    resolveCalendarFor(locationId, params.branchId, category),
  ]);

  let ranges: HolidayRange[] = rows.map((row) => ({
    name: row.name,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
  }));

  if (calendar !== null) {
    const overrides = await listCalendarOverrides(locationId, calendar.id);
    const mine = overrides.filter(
      (override) =>
        override.appliesToRoles.length === 0 || override.appliesToRoles.includes(role),
    );

    const byHoliday = new Map(mine.map((override) => [override.holidayId, override]));

    ranges = rows.flatMap((row) => {
      const override = byHoliday.get(row.id);
      if (override === undefined) {
        return [{ name: row.name, startsOn: row.startsOn, endsOn: row.endsOn }];
      }
      if (override.isCancelled) return [];
      if (override.movedStartsOn !== null && override.movedEndsOn !== null) {
        return [
          { name: row.name, startsOn: override.movedStartsOn, endsOn: override.movedEndsOn },
        ];
      }
      return [{ name: row.name, startsOn: row.startsOn, endsOn: row.endsOn }];
    });

    // A holiday moved into this window from outside it. The first step never
    // saw the row, so without this the school would be open on a day HR had
    // deliberately moved the closure to.
    const seen = new Set(rows.map((row) => row.id));
    for (const override of mine) {
      if (seen.has(override.holidayId)) continue;
      if (override.isCancelled) continue;
      if (override.movedStartsOn === null || override.movedEndsOn === null) continue;
      if (override.movedStartsOn > params.to || override.movedEndsOn < params.from) continue;

      ranges.push({
        name: override.holidayName,
        startsOn: override.movedStartsOn,
        endsOn: override.movedEndsOn,
      });
    }
  }

  const expanded = expandHolidays(ranges, params.from, params.to);
  const nameFor = new Map<string, string>();
  for (const [date, holidaysOnDate] of expanded) {
    const first = holidaysOnDate[0];
    if (first !== undefined) nameFor.set(date, first.name);
  }

  return { dates: new Set(expanded.keys()), nameFor };
}
