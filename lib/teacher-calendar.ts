import 'server-only';

import { and, asc, eq, gte, lte, notInArray } from 'drizzle-orm';

import {
  gradeLabel,
  grades,
  leaveRequests,
  leaveTypes,
  periodStructures,
  schoolUsers,
  sections,
  staff,
  subjects,
  timetableEntries,
  timetableSlots,
} from '@/db/schema';

import { db } from './drizzle';
import { expandHolidays } from './holiday-calendar';
import { listHolidays } from './holiday-queries';
import { minutesFromTime } from '@/db/schema/timetable-slots';

/**
 * One teacher's diary — the same lessons the weekly grid shows, projected onto
 * real dates so a day and a month can be asked for.
 *
 * ── Why this is a projection and not a table ─────────────────────────────
 * A timetable entry is a *rule*: "Maths, 5A, period 2, every Wednesday". There
 * is no row per Wednesday and there must not be — a school with 40 teachers and
 * a 200-day year would be writing 60,000 rows to say something 300 rules
 * already say, and every edit to the rule would have to rewrite the rest of the
 * year. So the calendar is computed from the rules on read, per date range.
 *
 * ── Holidays are subtracted here, and nowhere else ──────────────────────
 * This docblock said, from Sprint 12 until Sprint 27, that the calendar knew
 * the teaching week and nothing about the school's holidays *because no holiday
 * table existed yet*, and that when one arrived it would subtract here. One has
 * arrived and it does: a date inside a holiday yields **no lessons** and carries
 * the holiday's name instead, so a teacher opening Eid sees why the day is
 * empty rather than a blank the screen cannot explain.
 *
 * Only holidays. The Saturday roster is deliberately not applied — a timetable
 * rule's `day_of_week` is 0–4 by CHECK, so no Saturday has ever carried a
 * lesson and there is nothing to subtract. A person's Saturday duty is a rota
 * question and it is answered on `/teacher/calendar`, not here.
 *
 * What it also knows is leave. An approved leave request greys the day and says
 * who is covering the gap, because a head of department opening this screen is
 * usually asking exactly that question.
 */

/** A lesson on one real date. */
export interface CalendarLesson {
  entryId: string;
  /** `YYYY-MM-DD`, in the school's own wall-clock terms. */
  date: string;
  dayOfWeek: number;
  slotId: string;
  slotName: string;
  startTime: string;
  endTime: string;
  subjectName: string;
  subjectCode: string | null;
  subjectColor: string | null;
  sectionLabel: string;
  room: string | null;
}

/** A stretch of approved leave overlapping the range asked for. */
export interface CalendarLeave {
  id: string;
  startDate: string;
  endDate: string;
  leaveTypeName: string;
  status: string;
}

export interface TeacherCalendar {
  teacherId: string;
  teacherName: string;
  /** The bell schedules this teacher's classes run on, for the day view. */
  structureNames: string[];
  lessons: CalendarLesson[];
  leave: CalendarLeave[];
  /**
   * Dates in the range the school is closed, and what for.
   *
   * The reason a day is empty. Without it a holiday and a day whose timetable
   * has not been built yet look identical, and the second is something a
   * coordinator has to fix while the first is not.
   */
  holidays: Array<{ date: string; names: string[] }>;
}

export type CalendarView = 'day' | 'week' | 'month';

export function isCalendarView(value: unknown): value is CalendarView {
  return value === 'day' || value === 'week' || value === 'month';
}

// -----------------------------------------------------------------------------
// Dates
// -----------------------------------------------------------------------------

/**
 * Date arithmetic here is deliberately done on `YYYY-MM-DD` strings through UTC
 * midnight, never on a local `Date`.
 *
 * A timetable is wall-clock: "Monday 9am" is Monday 9am in Lahore whether the
 * server is in Frankfurt or Singapore. Constructing `new Date(y, m, d)` on the
 * server would place the day at the *server's* midnight, and a school six hours
 * ahead would see the last period of Friday land on Saturday. The same reason
 * `timetable_slots` stores times as text.
 */

const MS_PER_DAY = 86_400_000;

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function toUtc(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * MS_PER_DAY);
}

/** 0 = Monday … 6 = Sunday, for a `YYYY-MM-DD`. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

/** The Monday of the week containing `date`. */
export function startOfWeek(date: string): string {
  return addDays(date, -isoWeekday(date));
}

/** The first of the month containing `date`. */
export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** The last day of the month containing `date`. */
export function endOfMonth(date: string): string {
  const first = startOfMonth(date);
  const nextMonth = new Date(`${first}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  return fromUtc(nextMonth.getTime() - MS_PER_DAY);
}

/**
 * The inclusive date range a view covers, anchored on `date`.
 *
 * The month view runs whole weeks so the grid has no ragged first and last row
 * — the calendar every person has seen since childhood starts on a Monday and
 * shows the tail of the previous month greyed, and one that does not looks
 * broken before it is read.
 */
export function rangeFor(view: CalendarView, date: string): { from: string; to: string } {
  if (view === 'day') return { from: date, to: date };
  if (view === 'week') {
    const from = startOfWeek(date);
    return { from, to: addDays(from, 6) };
  }

  const from = startOfWeek(startOfMonth(date));
  const monthEnd = endOfMonth(date);
  const to = addDays(startOfWeek(monthEnd), 6);
  return { from, to };
}

/** Every date in an inclusive range, in order. */
export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ms = toUtc(from); ms <= toUtc(to); ms += MS_PER_DAY) {
    out.push(fromUtc(ms));
  }
  return out;
}

// -----------------------------------------------------------------------------
// The read
// -----------------------------------------------------------------------------

/**
 * Builds one teacher's calendar for a date range.
 *
 * `locationId` comes from verified session claims, as everywhere else in this
 * codebase; `teacherId` may come from a URL, which is why every join below is
 * also filtered on the tenant. A teacher id from another school resolves to an
 * empty calendar rather than to somebody else's week.
 */
export async function getTeacherCalendar(
  locationId: string,
  teacherId: string,
  academicYearId: string,
  range: { from: string; to: string },
  options: { includeLeave?: boolean } = {},
): Promise<TeacherCalendar | null> {
  const teacherRows = await db
    .select({ id: schoolUsers.id, name: schoolUsers.name })
    .from(schoolUsers)
    .where(and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.id, teacherId)))
    .limit(1);

  const teacher = teacherRows[0];
  if (teacher === undefined) return null;

  const rules = await db
    .select({
      entryId: timetableEntries.id,
      dayOfWeek: timetableEntries.dayOfWeek,
      room: timetableEntries.room,
      slotId: timetableSlots.id,
      slotName: timetableSlots.name,
      startTime: timetableSlots.startTime,
      endTime: timetableSlots.endTime,
      structureName: periodStructures.name,
      subjectName: subjects.name,
      subjectCode: subjects.code,
      subjectColor: subjects.color,
      sectionName: sections.name,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
    })
    .from(timetableEntries)
    .innerJoin(timetableSlots, eq(timetableSlots.id, timetableEntries.slotId))
    .innerJoin(
      periodStructures,
      eq(periodStructures.id, timetableSlots.periodStructureId),
    )
    .innerJoin(subjects, eq(subjects.id, timetableEntries.subjectId))
    .innerJoin(sections, eq(sections.id, timetableEntries.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(
        eq(timetableEntries.locationId, locationId),
        eq(timetableEntries.teacherId, teacherId),
        eq(timetableEntries.academicYearId, academicYearId),
        eq(timetableEntries.isActive, true),
        eq(timetableSlots.isActive, true),
      ),
    )
    .orderBy(asc(timetableEntries.dayOfWeek), asc(timetableSlots.orderIndex));

  /*
   * The school's closures over this range, read once.
   *
   * `listHolidays` is the only reader of the table and `expandHolidays` the
   * only thing that turns a row into dates — so a three-day Eid entered as one
   * row closes three days here without anybody re-deriving what a range means.
   */
  const holidayRows = await listHolidays(locationId, range.from, range.to);
  const holidaysByDate = expandHolidays(holidayRows, range.from, range.to);

  // Projection. Weekends carry no rules, so they simply produce nothing —
  // `day_of_week` is 0–4 by CHECK constraint and `isoWeekday` returns 5 and 6
  // for Saturday and Sunday, which match no rule.
  const lessons: CalendarLesson[] = [];
  for (const date of datesInRange(range.from, range.to)) {
    // A day the school is shut has no lessons, whatever the rules say. This is
    // the subtraction the docblock above promises, and it is one line because
    // it is one place.
    if (holidaysByDate.has(date)) continue;

    const weekday = isoWeekday(date);
    for (const rule of rules) {
      if (rule.dayOfWeek !== weekday) continue;

      lessons.push({
        entryId: rule.entryId,
        date,
        dayOfWeek: weekday,
        slotId: rule.slotId,
        slotName: rule.slotName,
        startTime: rule.startTime,
        endTime: rule.endTime,
        subjectName: rule.subjectName,
        subjectCode: rule.subjectCode,
        subjectColor: rule.subjectColor,
        sectionLabel: `${gradeLabel({
          name: rule.gradeName,
          displayName: rule.gradeDisplayName,
        })} — ${rule.sectionName}`,
        room: rule.room,
      });
    }
  }

  // Sorted by the clock rather than by the order the rules came back in: a
  // teacher on two different bell schedules in one day (a senior form tutor
  // taking one junior class) would otherwise read out of sequence.
  lessons.sort((left, right) => {
    if (left.date !== right.date) return left.date < right.date ? -1 : 1;
    return minutesFromTime(left.startTime) - minutesFromTime(right.startTime);
  });

  /*
   * Leave is joined through `staff`, not read off the teacher id directly.
   *
   * `leave_requests.staff_id` points at the *employment* record, while a
   * timetable entry points at the *portal account* — two different tables for
   * two different things, linked by `staff.school_user_id`. Reading the teacher
   * id straight into `staff_id` would silently match nothing, which is the
   * worst failure available here: an empty leave list is indistinguishable from
   * a teacher who took none.
   */
  /*
   * Leave is withheld unless the caller is entitled to it.
   *
   * The lessons on this calendar are not private — `academics.read` already
   * returns every teacher's name against every period through the timetable
   * routes, and reshaping that into a month view discloses nothing new. A
   * colleague's *leave* is a different thing entirely: it is an HR record, and
   * one teacher browsing to another's calendar must not learn that she was off
   * sick for a fortnight. The route decides; this function only obeys.
   */
  const leave = options.includeLeave !== true ? [] : await db
    .select({
      id: leaveRequests.id,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      status: leaveRequests.status,
      leaveTypeName: leaveTypes.name,
    })
    .from(leaveRequests)
    .innerJoin(staff, eq(staff.id, leaveRequests.staffId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        eq(leaveRequests.locationId, locationId),
        eq(staff.schoolUserId, teacherId),
        notInArray(leaveRequests.status, ['rejected', 'cancelled']),
        // Overlap, not containment: leave that began last month and runs into
        // this one still empties the days it covers here.
        lte(leaveRequests.startDate, range.to),
        gte(leaveRequests.endDate, range.from),
      ),
    );

  const structureNames = [...new Set(rules.map((rule) => rule.structureName))].sort();

  return {
    teacherId: teacher.id,
    teacherName: teacher.name,
    structureNames,
    lessons,
    leave: leave.map((row) => ({
      id: row.id,
      startDate: row.startDate,
      endDate: row.endDate,
      leaveTypeName: row.leaveTypeName,
      status: row.status,
    })),
    // Sorted, because a Map iterates in insertion order and the expansion walks
    // one holiday at a time — a two-day closure entered after a one-day one
    // would otherwise come back out of date order.
    holidays: [...holidaysByDate.entries()]
      .map(([date, rows]) => ({ date, names: rows.map((row) => row.name) }))
      .sort((left, right) => left.date.localeCompare(right.date)),
  };
}
