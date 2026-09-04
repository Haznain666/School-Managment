import { and, eq } from 'drizzle-orm';

import {
  isStaffAttendanceStatus,
  schoolUsers,
  staffAttendance,
  type StaffAttendanceStatus,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { batch, db, type Tx } from '@/lib/drizzle';
import {
  expandHolidays,
  isWorkingDay,
  saturdayOrdinal,
} from '@/lib/holiday-calendar';
import { listHolidays, saturdayOrdinalsByStaff } from '@/lib/holiday-queries';
import { getStaffAttendanceForDate, listStaff } from '@/lib/hr-queries';
import { isIsoDate, isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/hr/attendance
 *
 * GET  the staff register for one day, with everyone who should be on it
 * POST mark it
 *
 * ── On idempotence ───────────────────────────────────────────────────────
 * Marking is a bulk upsert onto the unique (location, date, staff) index,
 * through `batch()` so every row lands in one transaction. An administrator who
 * saves the register twice, or corrects it an hour later, updates the same rows
 * — so a day can never hold two contradictory answers for one person, which is
 * exactly what payroll would trip over when it counts absences.
 *
 * The GET returns the staff list alongside the marks so the screen can render
 * a full register on a day nobody has marked yet, rather than an empty table.
 *
 * ── `dayOff`, added in Sprint 27 ─────────────────────────────────────────
 * It also says whether the date is a holiday or a Saturday nobody is rostered
 * on, **and for whom**. The register could always mark a past date and always
 * had a `holiday` status; what it could not do was say the day was one, so a
 * person marking Eid saw forty rows defaulted to `present` and had to remember
 * to change every one of them.
 *
 * Per staff member rather than per date, because a Saturday is: two teachers
 * can legitimately disagree about whether the third Saturday was a working day,
 * and that is what the roster exists to record.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const date = url.searchParams.get('date') ?? '';

      if (!isIsoDate(date)) {
        return apiFailure('invalid_body', 'Provide a date as YYYY-MM-DD.', 400);
      }

      // The caller's own branch wins over the parameter. Never the other way.
      const requested = url.searchParams.get('branchId');
      const branchId =
        auth.branchId ?? (requested === null || requested === '' ? null : requested);

      const [roster, marks, holidayRows, saturdays] = await Promise.all([
        listStaff(auth.locationId, {
          status: 'active',
          branchId: branchId ?? undefined,
        }),
        getStaffAttendanceForDate(auth.locationId, date, branchId),
        // One day's window. The overlap test in `listHolidays` is what makes a
        // three-day Eid entered as one row answer for its middle day.
        listHolidays(auth.locationId, date, date, branchId),
        saturdayOrdinalsByStaff(auth.locationId),
      ]);

      /*
       * Whether this date is a day off, and for whom — Sprint 27, item B6.
       *
       * The requirement is that HR and a head can record who actually came in
       * on a day the school was shut, and the register already can: past dates
       * are markable and `holiday` has been in `STAFF_ATTENDANCE_STATUSES`
       * since Sprint 12. What it could not do was **say** the day was a day
       * off, so a person marking Eid saw forty rows defaulted to `present` and
       * had to know, from memory, to change every one of them.
       *
       * Answered per staff member because a Saturday is: two teachers can
       * disagree about whether the third Saturday was a working day, and the
       * whole point of the roster is that they are allowed to.
       */
      const holidayDates = new Set(
        expandHolidays(holidayRows, date, date).keys(),
      );

      const dayOffStaffIds = roster
        .filter(
          (row) => !isWorkingDay(date, holidayDates, saturdays.get(row.id) ?? []),
        )
        .map((row) => row.id);

      return apiSuccess({
        date,
        staff: roster,
        attendance: marks,
        dayOff: {
          holidayNames: holidayRows.map((row) => row.name),
          /** 1–5 when the date is a Saturday, 0 when it is not. */
          saturdayOrdinal: saturdayOrdinal(date),
          /** Whom the school was shut for. Empty on an ordinary working day. */
          staffIds: dayOffStaffIds,
        },
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.read' },
);

interface MarkInput {
  staffId?: unknown;
  status?: unknown;
  notes?: unknown;
}

interface MarkAttendanceBody {
  date?: unknown;
  marks?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<MarkAttendanceBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const date = readOptionalString(body.date);
      if (date === null || !isIsoDate(date)) {
        return apiFailure('invalid_body', 'Provide a date as YYYY-MM-DD.', 400);
      }

      // A register cannot be taken for a day that has not happened.
      const today = new Date().toISOString().slice(0, 10);
      if (date > today) {
        return apiFailure('invalid_body', 'That date is in the future.', 400);
      }

      if (!Array.isArray(body.marks) || body.marks.length === 0) {
        return apiFailure('invalid_body', 'Nothing to mark.', 400);
      }

      // Every id must be a staff member of this school — and of this branch,
      // when the caller is confined to one. Membership of the roster is the
      // tenant check; an id from another school is simply not in the set.
      const roster = await listStaff(auth.locationId, {
        branchId: auth.branchId ?? undefined,
      });
      const rosterIds = new Set(roster.map((row) => row.id));

      const parsed: Array<{
        staffId: string;
        status: StaffAttendanceStatus;
        notes: string | null;
      }> = [];

      for (const raw of body.marks as MarkInput[]) {
        const staffId = raw.staffId;
        if (typeof staffId !== 'string' || !isUuid(staffId) || !rosterIds.has(staffId)) {
          return apiFailure('invalid_body', 'One of the staff members is not yours.', 400);
        }

        if (!isStaffAttendanceStatus(raw.status)) {
          return apiFailure('invalid_body', 'One of the statuses is not valid.', 400);
        }

        parsed.push({
          staffId,
          status: raw.status,
          notes: readOptionalString(raw.notes),
        });
      }

      // Who took the register, resolved from the verified uid rather than the
      // body — a disputed absence has to be answerable.
      const markers = await db
        .select({ id: schoolUsers.id })
        .from(schoolUsers)
        .where(
          and(
            eq(schoolUsers.locationId, auth.locationId),
            eq(schoolUsers.authUserId, auth.uid),
          ),
        )
        .limit(1);

      const markedBy = markers[0]?.id ?? null;

      // Deferred until `batch()` opens the transaction: a Drizzle builder is
      // bound to the session that created it, so these must be built on `tx`.
      const statements = parsed.map((mark) => (tx: Tx) =>
        tx
          .insert(staffAttendance)
          .values({
            locationId: auth.locationId,
            staffId: mark.staffId,
            date,
            status: mark.status,
            notes: mark.notes,
            markedBy,
          })
          .onConflictDoUpdate({
            target: [staffAttendance.locationId, staffAttendance.date, staffAttendance.staffId],
            set: {
              status: mark.status,
              notes: mark.notes,
              markedBy,
            },
          }),
      );

      await batch(db, (tx) => statements.map((statement) => statement(tx)));

      return apiSuccess({ date, marked: parsed.length });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.write' },
);
