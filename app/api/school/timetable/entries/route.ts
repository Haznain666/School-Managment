import { and, eq, ne } from 'drizzle-orm';

import {
  isSchoolDay,
  schoolUsers,
  sections,
  subjects,
  timetableEntries,
  WEEKDAY_NAMES,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  getTimetableSlot,
  listTimetableEntries,
  listTimetableSlots,
} from '@/lib/academics-queries';
import { db } from '@/lib/drizzle';
import { isUuid, readOptionalString } from '@/lib/validation';
import { ACADEMICS_READ_ROLES, ACADEMICS_WRITE_ROLES } from '@/types/school-auth';

/**
 * /api/school/timetable/entries
 *
 * GET  one section's week — the bell schedule and the lessons in it
 * POST place a lesson in a cell
 *
 * POST is an upsert on (location, section, slot, day), not an insert. Saving a
 * cell that already holds a lesson replaces it, and a delete-then-insert could
 * leave the cell empty if the second half failed — the unique index is what
 * makes the single statement possible.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const sectionId = url.searchParams.get('sectionId') ?? '';
      const academicYearId = url.searchParams.get('academicYearId') ?? '';

      if (!isUuid(sectionId) || !isUuid(academicYearId)) {
        return apiFailure(
          'invalid_query',
          'Choose a section and an academic year.',
          400,
        );
      }

      const [slots, entries] = await Promise.all([
        listTimetableSlots(auth.locationId, { activeOnly: true }),
        listTimetableEntries(auth.locationId, { sectionId, academicYearId }),
      ]);

      return apiSuccess({ slots, entries });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: ACADEMICS_READ_ROLES },
);

interface UpsertEntryBody {
  academicYearId?: unknown;
  sectionId?: unknown;
  subjectId?: unknown;
  teacherId?: unknown;
  slotId?: unknown;
  dayOfWeek?: unknown;
  room?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<UpsertEntryBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const { academicYearId, sectionId, subjectId, teacherId, slotId } = body;

      if (
        !isUuid(academicYearId) ||
        !isUuid(sectionId) ||
        !isUuid(subjectId) ||
        !isUuid(teacherId) ||
        !isUuid(slotId)
      ) {
        return apiFailure(
          'invalid_body',
          'Choose a section, period, subject and teacher.',
          400,
        );
      }

      const dayOfWeek = Number(body.dayOfWeek);
      if (!isSchoolDay(dayOfWeek)) {
        return apiFailure(
          'invalid_body',
          'Lessons can only be placed from Monday to Friday.',
          400,
        );
      }

      const room = readOptionalString(body.room);
      if (room !== null && room.length > 40) {
        return apiFailure('invalid_body', 'Use a room name of 40 characters or fewer.', 400);
      }

      // Every id is re-checked against this tenant. They came from the client,
      // so an id belonging to another school must resolve to nothing rather
      // than be written into this school's timetable.
      const [section, subject, teacher, slot] = await Promise.all([
        db
          .select({ id: sections.id })
          .from(sections)
          .where(
            and(
              eq(sections.locationId, auth.locationId),
              eq(sections.id, sectionId),
              eq(sections.academicYearId, academicYearId),
            ),
          )
          .limit(1),
        db
          .select({ id: subjects.id })
          .from(subjects)
          .where(
            and(
              eq(subjects.locationId, auth.locationId),
              eq(subjects.id, subjectId),
              eq(subjects.isActive, true),
            ),
          )
          .limit(1),
        db
          .select({ id: schoolUsers.id })
          .from(schoolUsers)
          .where(
            and(
              eq(schoolUsers.locationId, auth.locationId),
              eq(schoolUsers.id, teacherId),
              eq(schoolUsers.isActive, true),
            ),
          )
          .limit(1),
        getTimetableSlot(auth.locationId, slotId),
      ]);

      if (section[0] === undefined) {
        return apiFailure('not_found', 'That section is not in this academic year.', 404);
      }
      if (subject[0] === undefined) {
        return apiFailure('not_found', 'That subject is not available.', 404);
      }
      if (teacher[0] === undefined) {
        return apiFailure('not_found', 'That teacher is not available.', 404);
      }
      if (slot === null) {
        return apiFailure('not_found', 'That period does not exist.', 404);
      }

      // A break is a row in the grid so the day reads correctly, but nothing is
      // taught in it — 422 rather than 400: the request is well formed, the
      // school's own schedule is what refuses it.
      if (slot.isBreak) {
        return apiFailure(
          'slot_is_break',
          `${slot.name} is a break. Lessons cannot be scheduled in it.`,
          422,
        );
      }

      // A teacher cannot be in two rooms at once. The unique index only protects
      // the section's own cell, so the clash across sections is checked here.
      const clash = await db
        .select({ sectionName: sections.name })
        .from(timetableEntries)
        .innerJoin(sections, eq(sections.id, timetableEntries.sectionId))
        .where(
          and(
            eq(timetableEntries.locationId, auth.locationId),
            eq(timetableEntries.academicYearId, academicYearId),
            eq(timetableEntries.teacherId, teacherId),
            eq(timetableEntries.slotId, slotId),
            eq(timetableEntries.dayOfWeek, dayOfWeek),
            eq(timetableEntries.isActive, true),
            ne(timetableEntries.sectionId, sectionId),
          ),
        )
        .limit(1);

      const conflicting = clash[0];
      if (conflicting !== undefined) {
        return apiFailure(
          'teacher_busy',
          `That teacher already takes section ${conflicting.sectionName} in ${slot.name} on ${WEEKDAY_NAMES[dayOfWeek] ?? 'that day'}.`,
          409,
        );
      }

      const saved = await db
        .insert(timetableEntries)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          academicYearId,
          sectionId,
          subjectId,
          teacherId,
          slotId,
          dayOfWeek,
          room,
        })
        .onConflictDoUpdate({
          target: [
            timetableEntries.locationId,
            timetableEntries.sectionId,
            timetableEntries.slotId,
            timetableEntries.dayOfWeek,
          ],
          set: {
            subjectId,
            teacherId,
            academicYearId,
            room,
            isActive: true,
            updatedAt: new Date(),
          },
        })
        .returning({ id: timetableEntries.id });

      if (saved[0] === undefined) {
        return apiFailure('write_failed', 'Could not save the lesson.', 500);
      }

      return apiSuccess({ entryId: saved[0].id });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: ACADEMICS_WRITE_ROLES },
);
