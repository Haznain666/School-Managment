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
  listSlotsForSection,
  resolveStructureForSection,
} from '@/lib/academics-queries';
import { db } from '@/lib/drizzle';
import { isUuid, readOptionalString } from '@/lib/validation';

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
 *
 * ── The rows a section is laid out against ───────────────────────────────
 * Not the school's whole bell schedule any more: the schedule of the structure
 * this section's *grade* is assigned to, or the school default when nobody has
 * assigned it. That is `listSlotsForSection`, and the same resolution guards
 * the write — a slot from the senior school's schedule is refused for a junior
 * section rather than quietly written into a grid that will never draw it.
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

      const [structure, slots, entries] = await Promise.all([
        resolveStructureForSection(auth.locationId, sectionId),
        listSlotsForSection(auth.locationId, sectionId),
        listTimetableEntries(auth.locationId, { sectionId, academicYearId }),
      ]);

      // The structure is returned so the builder can name it on screen. A
      // grid whose rows changed because the grade was reassigned, with nothing
      // saying which schedule it is now showing, reads as data loss.
      return apiSuccess({ slots, entries, structure });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.read' },
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

      /*
       * The period must belong to the schedule this section actually runs on.
       *
       * Without this, a stale browser tab left open across a grade
       * reassignment would post a junior lesson into a senior period. The row
       * would be written, would satisfy every constraint, and would never
       * appear in any grid — the worst kind of accepted write.
       */
      const structure = await resolveStructureForSection(auth.locationId, sectionId);
      if (structure === null || slot.periodStructureId !== structure.id) {
        return apiFailure(
          'wrong_structure',
          `${slot.name} is not part of the schedule this class runs on. Reload the page and try again.`,
          409,
        );
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
  { permission: 'academics.write' },
);
