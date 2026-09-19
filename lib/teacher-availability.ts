import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import {
  branches,
  gradeLabel,
  grades,
  schoolUsers,
  sections,
  subjects,
  timetableEntries,
  timetableSlots,
  timetableSubstitutions,
} from '@/db/schema';
import { schoolDayOfWeek, WEEKDAY_NAMES } from '@/db/schema/timetable-entries';
import { formatTimeOfDay, slotsOverlap } from '@/db/schema/timetable-slots';

import {
  loadChainIndex,
  reachableStaffIds,
  type ChainDecider,
} from './approval-chain';
import { ownedBy } from './branch-scope';
import { db } from './drizzle';
import { isWorkingDay } from './holiday-calendar';
import { saturdayOrdinalsByStaff } from './holiday-queries';
import { listFileableStaff, listLeaveForSchool } from './leave-queries';
import { staffHolidayDates } from './staff-calendar-queries';
import { liveTimetableEntries } from './timetable-history';

/**
 * `lib/teacher-availability.ts` — who is free to take a period, on one date.
 *
 * Sprint 33c, C4. The read behind the substitutes panel on the administrative
 * dashboard, and behind the write that arranges cover.
 *
 * ── Four subtractions, and every one of them reuses its own module ───────
 * Every teacher in reach, minus:
 *
 *   1. **a timetabled lesson that overlaps** — `slotsOverlap`, Sprint 33a's
 *      helper, so the builder, the clash guard on the write and this all ask
 *      one function. Comparing `slot_id` would miss exactly the case that
 *      helper was written for: two periods in different `period_structures`
 *      are never the same slot and are very often the same half hour;
 *   2. **cover they have already been given** on that date, by the same
 *      overlap test. A person arranged into two rooms at nine is the original
 *      defect with an extra table in it;
 *   3. **approved leave** covering the date;
 *   4. **a day they are not in** — a gazetted holiday on their campus's
 *      calendar, a Sunday, or a Saturday their roster does not name.
 *
 * ── Why not `getTeacherCalendar` for the leave half ──────────────────────
 * It is per teacher and makes three reads each; forty teachers on one date is
 * a hundred and twenty round trips for a panel. `listLeaveForSchool` is the
 * existing bulk reader over the same table with the same window semantics
 * (`end_date >= from AND start_date <= to`), so no second reader is written
 * either way — which was the requirement.
 *
 * ── The scope is the chain of command, not a role list ───────────────────
 * *A Coordinator sees their own teachers, a Section Head their coordinators'
 * teachers, a head their branch.* That is the question `lib/approval-chain.ts`
 * was built for in Part B, so `reachableStaffIds` answers it here rather than a
 * second resolver drifting away from the first. The permission
 * (`timetable.substitute`) is the door; the chain is the room.
 *
 * ⚠ It follows that the caller is **not** in their own candidate list —
 * `decisionRefusal` refuses a person over themselves, by design, and that rule
 * is not weakened here for one screen. A coordinator who wants to take the
 * period themselves is not arranging cover, they are teaching it.
 */

/** Somebody who could be asked. */
export interface AvailabilityCandidate {
  /** `school_users.id` — what a timetable entry and a chat message address. */
  schoolUserId: string;
  /** `staff.id` — what leave and the Saturday roster are keyed on. */
  staffId: string;
  name: string;
  branchId: string | null;
  branchName: string | null;
}

export interface TeacherAvailability extends AvailabilityCandidate {
  free: boolean;
  /** Why not, in the words the panel prints. Null when they are free. */
  reason: string | null;
}

export interface SubstituteSlotAnswer {
  date: string;
  dayOfWeek: number;
  slot: {
    id: string;
    name: string;
    startTime: string;
    endTime: string;
  };
  free: TeacherAvailability[];
  busy: TeacherAvailability[];
}

/**
 * The teachers this caller may arrange cover from.
 *
 * `branchIds` is the caller's own campus scope — null means every campus,
 * which is what a school-wide account has. It narrows the pool before the chain
 * narrows it again; both are needed, because the chain admits a Principal to
 * everybody at their campus and says nothing about another campus's.
 */
export async function reachableTeachers(
  locationId: string,
  decider: ChainDecider,
  branchIds: string[] | null,
): Promise<AvailabilityCandidate[]> {
  const [staffRows, index] = await Promise.all([
    listFileableStaff(locationId, branchIds),
    loadChainIndex(locationId),
  ]);

  // Only people who can be put in front of a class and can be told about it.
  // A junior teacher (decision 6) has no `school_users` row, so there is
  // nothing to address a timetable entry or a chat message to; HR files their
  // leave for them and somebody else is asked to cover.
  const teachers = staffRows.filter(
    (row) => row.role === 'teacher' && row.schoolUserId !== null,
  );

  const reachable = reachableStaffIds(index, teachers, decider);

  return teachers
    .filter((row) => reachable.has(row.staffId))
    .map((row) => ({
      // Narrowed above; the assertion is here rather than a second filter.
      schoolUserId: row.schoolUserId as string,
      staffId: row.staffId,
      name: row.name,
      branchId: row.branchId,
      branchName: row.branchName,
    }));
}

/** A class the panel can pick a period from. */
export interface SubstituteSectionOption {
  id: string;
  gradeId: string;
  branchId: string | null;
  /** The campus that owns this class, or null at a school with one site. */
  branchName: string | null;
  label: string;
}

/**
 * The classes this caller may arrange cover in, for one year.
 *
 * `gradeIds` is `visibleScopeFor`'s answer — null for everybody who is not a
 * scoped head, and an **empty list is a scope** rather than a missing filter:
 * a head assigned to no grades sees no classes, which is the same convention
 * `listTeacherOverlaps` already carries.
 */
export async function listSubstituteSections(
  locationId: string,
  academicYearId: string,
  gradeIds: readonly string[] | null,
  branchIds: string[] | null = null,
): Promise<SubstituteSectionOption[]> {
  if (gradeIds !== null && gradeIds.length === 0) return [];

  const rows = await db
    .select({
      id: sections.id,
      gradeId: sections.gradeId,
      branchId: grades.branchId,
      branchName: branches.name,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionName: sections.name,
    })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    // Left, not inner: a school with one campus has `grades.branch_id` null on
    // every row, and an inner join would empty this list at exactly the schools
    // that never think about campuses at all.
    .leftJoin(branches, eq(branches.id, grades.branchId))
    .where(
      and(
        eq(sections.locationId, locationId),
        eq(sections.academicYearId, academicYearId),
        eq(sections.isActive, true),
        ...(gradeIds === null ? [] : [inArray(sections.gradeId, [...gradeIds])]),
        /*
         * QA F3. Two different scope mechanisms used to meet in this handler:
         * the teacher pool was branch-scoped through `resolveBranchScope` while
         * the class list was scoped only by `visibleScopeFor`, which
         * short-circuits to UNSCOPED for **every role except `principal`**. So
         * a campus-bound Vice Principal, Section Head or Coordinator was handed
         * all 29 of Askari's sections and could read the other campus's whole
         * day. `ownedBy` and not `sharedOrOwnedBy`: on `grades` a null
         * `branch_id` is a row that predates the column, not a shared row, and
         * admitting it here would put another campus's classes back in the list.
         */
        ownedBy(grades.branchId, branchIds),
      ),
    )
    .orderBy(asc(branches.name), asc(grades.name), asc(sections.name));

  return rows.map((row) => ({
    id: row.id,
    gradeId: row.gradeId,
    branchId: row.branchId,
    branchName: row.branchName,
    /*
     * QA F4. The campus belongs in the label, not only in the payload.
     * Askari runs six pairs of grades whose names collide across its two
     * campuses — Nursery A, Pre-Nursery A, Prep A, Year 1 A, Year 2 A,
     * Year 2 B — and ordering by grade then section lands each pair adjacent.
     * A school-wide head picked one of two identical options, saw a day of
     * lessons and named a teacher, with no way of knowing which site they had
     * just committed. Suffixed only where there is a campus to name, so a
     * single-campus school's list is unchanged.
     */
    label:
      row.branchName === null
        ? `${gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName })} — ${row.sectionName}`
        : `${gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName })} — ${row.sectionName} · ${row.branchName}`,
  }));
}

/** One lesson in a section's day, with whatever cover has been arranged. */
export interface SubstituteLessonRow {
  entryId: string | null;
  slotId: string;
  slotName: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  subjectName: string | null;
  teacherId: string | null;
  teacherName: string | null;
  /** The cover already arranged for this cell on this date, if any. */
  coverTeacherId: string | null;
  coverTeacherName: string | null;
  substitutionId: string | null;
}

/**
 * One section's lessons on one date, with any cover already arranged.
 *
 * The lesson is read as it stands **on the cover date**, not as it stands
 * today: `liveTimetableEntries(date)`. Arranging cover for next Tuesday against
 * a version that is being superseded this Friday would name the wrong teacher
 * as the person being covered for, which is the whole class of defect `0049`
 * exists to close.
 */
export async function listSectionDay(
  locationId: string,
  params: { sectionId: string; academicYearId: string; date: string },
): Promise<SubstituteLessonRow[] | null> {
  const dayOfWeek = schoolDayOfWeek(new Date(`${params.date}T00:00:00Z`));
  if (dayOfWeek === null) return null;

  const [lessons, cover] = await Promise.all([
    db
      .select({
        entryId: timetableEntries.id,
        slotId: timetableSlots.id,
        slotName: timetableSlots.name,
        startTime: timetableSlots.startTime,
        endTime: timetableSlots.endTime,
        isBreak: timetableSlots.isBreak,
        subjectName: subjects.name,
        teacherId: schoolUsers.id,
        teacherName: schoolUsers.name,
      })
      .from(timetableEntries)
      .innerJoin(timetableSlots, eq(timetableSlots.id, timetableEntries.slotId))
      .innerJoin(subjects, eq(subjects.id, timetableEntries.subjectId))
      .innerJoin(schoolUsers, eq(schoolUsers.id, timetableEntries.teacherId))
      .where(
        and(
          eq(timetableEntries.locationId, locationId),
          eq(timetableEntries.sectionId, params.sectionId),
          eq(timetableEntries.academicYearId, params.academicYearId),
          eq(timetableEntries.dayOfWeek, dayOfWeek),
          eq(timetableEntries.isActive, true),
          liveTimetableEntries(params.date),
        ),
      )
      .orderBy(asc(timetableSlots.startTime)),
    db
      .select({
        id: timetableSubstitutions.id,
        slotId: timetableSubstitutions.slotId,
        coverTeacherId: timetableSubstitutions.coverTeacherId,
        coverTeacherName: schoolUsers.name,
      })
      .from(timetableSubstitutions)
      .innerJoin(schoolUsers, eq(schoolUsers.id, timetableSubstitutions.coverTeacherId))
      .where(
        and(
          eq(timetableSubstitutions.locationId, locationId),
          eq(timetableSubstitutions.sectionId, params.sectionId),
          eq(timetableSubstitutions.coverDate, params.date),
        ),
      ),
  ]);

  const coverBySlot = new Map(cover.map((row) => [row.slotId, row]));

  return lessons.map((row) => {
    const arranged = coverBySlot.get(row.slotId) ?? null;
    return {
      ...row,
      coverTeacherId: arranged?.coverTeacherId ?? null,
      coverTeacherName: arranged?.coverTeacherName ?? null,
      substitutionId: arranged?.id ?? null,
    };
  });
}

/**
 * Who is free for one period on one date, and who is not and why.
 *
 * Returns null when the date is a weekend — `day_of_week` is 0–4 by CHECK on
 * both tables, so there is no period to arrange cover for and the honest answer
 * is that the question does not apply, not an empty list.
 */
export async function listFreeTeachers(
  locationId: string,
  params: {
    date: string;
    slotId: string;
    academicYearId: string;
    candidates: readonly AvailabilityCandidate[];
  },
): Promise<SubstituteSlotAnswer | null> {
  const dayOfWeek = schoolDayOfWeek(new Date(`${params.date}T00:00:00Z`));
  if (dayOfWeek === null) return null;

  const slotRows = await db
    .select({
      id: timetableSlots.id,
      name: timetableSlots.name,
      startTime: timetableSlots.startTime,
      endTime: timetableSlots.endTime,
    })
    .from(timetableSlots)
    .where(
      and(eq(timetableSlots.locationId, locationId), eq(timetableSlots.id, params.slotId)),
    )
    .limit(1);

  const slot = slotRows[0];
  if (slot === undefined) return null;

  if (params.candidates.length === 0) {
    return { date: params.date, dayOfWeek, slot, free: [], busy: [] };
  }

  const teacherIds = params.candidates.map((row) => row.schoolUserId);
  const staffIds = new Set(params.candidates.map((row) => row.staffId));

  const [lessons, covering, leave, rosters] = await Promise.all([
    // 1 — what they are already timetabled into that day, with the minutes.
    db
      .select({
        teacherId: timetableEntries.teacherId,
        startTime: timetableSlots.startTime,
        endTime: timetableSlots.endTime,
        slotName: timetableSlots.name,
        sectionName: sections.name,
        gradeName: grades.name,
        gradeDisplayName: grades.displayName,
      })
      .from(timetableEntries)
      .innerJoin(timetableSlots, eq(timetableSlots.id, timetableEntries.slotId))
      .innerJoin(sections, eq(sections.id, timetableEntries.sectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .where(
        and(
          eq(timetableEntries.locationId, locationId),
          eq(timetableEntries.academicYearId, params.academicYearId),
          eq(timetableEntries.dayOfWeek, dayOfWeek),
          eq(timetableEntries.isActive, true),
          liveTimetableEntries(params.date),
          inArray(timetableEntries.teacherId, teacherIds),
        ),
      ),
    // 2 — cover they have already been given on this date.
    db
      .select({
        teacherId: timetableSubstitutions.coverTeacherId,
        startTime: timetableSlots.startTime,
        endTime: timetableSlots.endTime,
        slotName: timetableSlots.name,
        sectionName: sections.name,
        gradeName: grades.name,
        gradeDisplayName: grades.displayName,
      })
      .from(timetableSubstitutions)
      .innerJoin(timetableSlots, eq(timetableSlots.id, timetableSubstitutions.slotId))
      .innerJoin(sections, eq(sections.id, timetableSubstitutions.sectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .where(
        and(
          eq(timetableSubstitutions.locationId, locationId),
          eq(timetableSubstitutions.coverDate, params.date),
          inArray(timetableSubstitutions.coverTeacherId, teacherIds),
        ),
      ),
    // 3 — approved leave covering the date, for the whole school in one read.
    listLeaveForSchool(locationId, {
      status: 'approved',
      from: params.date,
      to: params.date,
    }),
    // 4a — the Saturday rota, per person, resolved against their role's policy.
    saturdayOrdinalsByStaff(locationId),
  ]);

  /*
   * 4b — the campus calendars. One read per distinct campus in the pool rather
   * than one per teacher: `staffHolidayDates` already resolves the calendar,
   * its overrides and the moved and cancelled holidays for a (campus, role)
   * pair, and every candidate here is a teacher.
   */
  const campuses = [...new Set(params.candidates.map((row) => row.branchId))];
  const closedByCampus = new Map<string, Set<string>>();
  const closureNameByCampus = new Map<string, string>();

  for (const branchId of campuses) {
    const window = await staffHolidayDates(locationId, {
      branchId,
      role: 'teacher',
      from: params.date,
      to: params.date,
    });
    closedByCampus.set(branchId ?? '', window.dates);
    const name = window.nameFor.get(params.date);
    if (name !== undefined) closureNameByCampus.set(branchId ?? '', name);
  }

  const onLeave = new Map<string, string>();
  for (const row of leave) {
    if (!staffIds.has(row.staffId)) continue;
    onLeave.set(row.staffId, row.leaveTypeName);
  }

  const label = (row: {
    gradeName: string;
    gradeDisplayName: string | null;
    sectionName: string;
    slotName: string;
    startTime: string;
    endTime: string;
  }): string =>
    `${gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName })} — ${row.sectionName}, ${row.slotName} (${formatTimeOfDay(row.startTime)} – ${formatTimeOfDay(row.endTime)})`;

  const clashing = new Map<string, string>();

  for (const row of lessons) {
    if (!slotsOverlap(row.startTime, row.endTime, slot.startTime, slot.endTime)) continue;
    clashing.set(row.teacherId, `Teaching ${label(row)}`);
  }

  for (const row of covering) {
    if (!slotsOverlap(row.startTime, row.endTime, slot.startTime, slot.endTime)) continue;
    clashing.set(row.teacherId, `Already covering ${label(row)}`);
  }

  const free: TeacherAvailability[] = [];
  const busy: TeacherAvailability[] = [];

  for (const candidate of params.candidates) {
    const closed = closedByCampus.get(candidate.branchId ?? '') ?? new Set<string>();
    const ordinals = rosters.get(candidate.staffId) ?? [];

    /*
     * ── The order of these three is the answer, not a detail (QA F6) ──────
     * A person who is not in at all is not "teaching Year 4 — A": the timetable
     * says what they would be doing on an ordinary Monday, and Iqbal Day is not
     * one. Asked first, the clash won, and on a gazetted holiday 26 of Askari's
     * 42 teachers were reported as teaching a lesson on a day the school was
     * shut. Nobody could be selected either way, so it produced no wrong cover
     * — it printed a sentence that was untrue, on a panel whose entire job is
     * telling a head where people are.
     *
     * So: **not in** beats **on leave** beats **already booked**. Each answers
     * a strictly narrower question than the one before it.
     */
    const closure = !isWorkingDay(params.date, closed, ordinals)
      ? (closureNameByCampus.get(candidate.branchId ?? '') ??
        `Not a working day for them (${WEEKDAY_NAMES[dayOfWeek] ?? 'that day'})`)
      : null;

    const reason =
      closure ??
      (onLeave.has(candidate.staffId)
        ? `On ${onLeave.get(candidate.staffId) ?? 'leave'}`
        : (clashing.get(candidate.schoolUserId) ?? null));

    if (reason === null) free.push({ ...candidate, free: true, reason: null });
    else busy.push({ ...candidate, free: false, reason });
  }

  free.sort((left, right) => left.name.localeCompare(right.name));
  busy.sort((left, right) => left.name.localeCompare(right.name));

  return { date: params.date, dayOfWeek, slot, free, busy };
}

/**
 * Why this person may not take this period — or null.
 *
 * Called again on the write. The panel uses the lists above to decide what to
 * offer; the POST re-derives, because a target id in a request body is
 * untrusted and because a lesson can be placed, leave approved or a holiday
 * declared between the panel rendering and the button being pressed. The same
 * separation `decisionRefusal` draws for leave, for the same reason.
 */
export function substituteRefusal(
  answer: SubstituteSlotAnswer,
  coverTeacherId: string,
): string | null {
  if (answer.free.some((row) => row.schoolUserId === coverTeacherId)) return null;

  const busy = answer.busy.find((row) => row.schoolUserId === coverTeacherId);
  if (busy !== undefined) {
    return `${busy.name} is not free in ${answer.slot.name} on that date. ${busy.reason ?? ''}`.trim();
  }

  return 'That teacher is not one you can arrange cover from.';
}
