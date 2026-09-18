import { and, eq, isNull } from 'drizzle-orm';

import {
  gradeLabel,
  grades,
  isSchoolDay,
  schoolUsers,
  sections,
  subjects,
  timetableEntries,
  WEEKDAY_NAMES,
} from '@/db/schema';
import { formatTimeOfDay, slotsOverlap } from '@/db/schema/timetable-slots';
import { withSchoolAuth } from '@/lib/api-auth';
import { sectionLabel } from '@/lib/class-labels';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  getTimetableSlot,
  listTeacherBusySlots,
  listTimetableEntries,
  listSlotsForSection,
  resolveStructureForSection,
} from '@/lib/academics-queries';
import { batch, db } from '@/lib/drizzle';
import {
  liveTimetableEntries,
  supersededOn,
  timetableToday,
} from '@/lib/timetable-history';
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
 *
 * ── Sprint 33c: the upsert became a supersede ────────────────────────────
 * It was one `INSERT … ON CONFLICT DO UPDATE`, and that single statement is
 * what rewrote history: putting one teacher into another's Tuesday period
 * changed who had taken it every Tuesday since September, on every screen, with
 * nothing anywhere recording that it had ever been otherwise. The product owner
 * asked for that to stop, and decision 9 says there is to be no history *view*
 * — so nothing new is shown and the past simply stops being edited.
 *
 * A save is therefore one of three things, decided by reading the version in
 * force today:
 *
 *   · no live row              insert one, effective from today;
 *   · same teacher, same       update it in place — a room or a typo is a
 *     subject                  correction to one lesson, not a new one;
 *   · a different teacher or   **close** the live row (`effective_to` =
 *     a different subject      yesterday) and **open** a new one from today,
 *                              in one transaction. Nothing is updated in
 *                              place and nothing is deleted.
 *
 * The one exception is a version that has not yet survived a day —
 * `effective_from >= today`, which is the clerk who placed the wrong teacher
 * ten minutes ago. That is updated in place too: superseding it would record a
 * version that was never in force for a single school day, and a history made
 * of ten-minute versions is a history nobody can read.
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
        /*
         * The grade's name comes back with the section's, and it is not
         * decoration. Part A's QA found the cross-schedule 409 named the class
         * the teacher was *already* in and not the one being edited, while the
         * spec asks for "both classes" — so a clerk placing Year 1 A was told
         * about Nursery A and had to work out which of their two tabs it meant.
         * One extra join on a statement that already runs, and the refusal
         * names both ends of the clash.
         */
        db
          .select({
            id: sections.id,
            sectionName: sections.name,
            gradeName: grades.name,
            gradeDisplayName: grades.displayName,
          })
          .from(sections)
          .innerJoin(grades, eq(grades.id, sections.gradeId))
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

      /*
       * A teacher cannot be in two rooms at once.
       *
       * ── What this used to test, and why it let an overlap through ───────
       * Until Sprint 33a the condition was `slot_id = :slotId` and nothing
       * else. Two lessons in **different `period_structures`** never share a
       * slot id, so Nursery period 2 (08:40–09:20) and Year 1 period 3
       * (09:05–09:45) were both legal writes and the teacher portal drew the
       * overlap correctly from two correct rows. Nothing compared the minutes.
       *
       * So the test is now the minutes, across every schedule the teacher
       * teaches in: read their other lessons on this day and ask
       * `slotsOverlap` — the same function `TimetableBuilder` asks before it
       * sends, so the browser and the server cannot come to different answers.
       *
       * The same-slot equality is kept as the first disjunct. It is the fast
       * path in the literal sense — it is what catches the ordinary
       * one-schedule school without any arithmetic at all — and it costs
       * nothing to keep beside the test that subsumes it.
       *
       * A teacher has at most a day's worth of lessons, so this is a handful
       * of rows off the `(location, section, teacher)` index rather than a
       * time predicate the planner would have to reason about.
       *
       * It is `listTeacherBusySlots` — the *same* read the builder makes — so
       * the two sides cannot diverge in what they compare, and so
       * `check-sprint33a` can execute the statement this refusal rests on.
       */
      const busy = await listTeacherBusySlots(auth.locationId, teacherId, academicYearId);

      const conflicting = busy.find(
        (row) =>
          row.dayOfWeek === dayOfWeek &&
          row.sectionId !== sectionId &&
          (row.slotId === slotId ||
            slotsOverlap(row.startTime, row.endTime, slot.startTime, slot.endTime)),
      );

      if (conflicting !== undefined) {
        const day = WEEKDAY_NAMES[dayOfWeek] ?? 'that day';

        /*
         * Both classes, both periods and both clocks — Sprint 33b, from Part
         * A's QA. "That teacher is busy" is not something a clerk can act on;
         * neither, quite, is naming only the class they are *not* looking at.
         * The sentence now reads from the lesson being placed to the one that
         * refuses it, which is the order the person is thinking in.
         */
        const placing = sectionLabel(
          gradeLabel({ name: section[0].gradeName, displayName: section[0].gradeDisplayName }),
          section[0].sectionName,
        );

        return apiFailure(
          'teacher_busy',
          conflicting.slotId === slotId
            ? `That teacher cannot take ${placing} in ${slot.name} on ${day}: they already take ${conflicting.sectionLabel} in that period.`
            : `That teacher cannot take ${placing} in ${slot.name} (${formatTimeOfDay(slot.startTime)} – ${formatTimeOfDay(slot.endTime)}) on ${day}: they already take ${conflicting.sectionLabel} in ${conflicting.slotName} (${formatTimeOfDay(conflicting.startTime)} – ${formatTimeOfDay(conflicting.endTime)}), and the two overlap.`,
          409,
        );
      }

      /*
       * Sprint 33c. Which version of this cell is in force, if any.
       *
       * Read before the write rather than folded into an `ON CONFLICT`: the
       * three outcomes in the docblock are not one statement — closing one row
       * and opening another cannot be expressed as an upsert — and choosing
       * between them needs the standing row's teacher, subject and start date.
       */
      const today = timetableToday();

      const standingRows = await db
        .select({
          id: timetableEntries.id,
          teacherId: timetableEntries.teacherId,
          subjectId: timetableEntries.subjectId,
          effectiveFrom: timetableEntries.effectiveFrom,
        })
        .from(timetableEntries)
        .where(
          and(
            eq(timetableEntries.locationId, auth.locationId),
            eq(timetableEntries.sectionId, sectionId),
            eq(timetableEntries.slotId, slotId),
            eq(timetableEntries.dayOfWeek, dayOfWeek),
            eq(timetableEntries.isActive, true),
            liveTimetableEntries(today),
          ),
        )
        .limit(1);

      const standing = standingRows[0] ?? null;
      const now = new Date();

      const values = {
        // Tenant comes from the verified session, never from the body.
        locationId: auth.locationId,
        academicYearId,
        sectionId,
        subjectId,
        teacherId,
        slotId,
        dayOfWeek,
        room,
        effectiveFrom: today,
      };

      /*
       * A change of who takes the period, or of what is taught in it. Both are
       * facts about what happened in that room last Tuesday and neither may be
       * rewritten. A **room** is not: it is where the same lesson sat, and
       * correcting it is a correction.
       */
      const supersede =
        standing !== null &&
        standing.effectiveFrom < today &&
        (standing.teacherId !== teacherId || standing.subjectId !== subjectId);

      let entryId: string | undefined;

      if (standing !== null && supersede) {
        /*
         * Close, then open, in one transaction and in that order — the closing
         * `UPDATE` is what takes the old row out of the partial unique index
         * and makes room for the new one. Every statement is built on `tx`: a
         * builder made from `db` runs outside the transaction even when it is
         * awaited inside one.
         */
        const [, opened] = await batch(db, (tx) => [
          tx
            .update(timetableEntries)
            .set({ effectiveTo: supersededOn(today), updatedAt: now })
            .where(
              and(
                eq(timetableEntries.locationId, auth.locationId),
                eq(timetableEntries.id, standing.id),
              ),
            ),
          tx.insert(timetableEntries).values(values).returning({ id: timetableEntries.id }),
        ]);

        entryId = opened[0]?.id;
      } else if (standing !== null) {
        const updated = await db
          .update(timetableEntries)
          .set({
            subjectId,
            teacherId,
            academicYearId,
            room,
            isActive: true,
            updatedAt: now,
          })
          .where(
            and(
              eq(timetableEntries.locationId, auth.locationId),
              eq(timetableEntries.id, standing.id),
            ),
          )
          .returning({ id: timetableEntries.id });

        entryId = updated[0]?.id;
      } else {
        /*
         * The race, and why the insert still carries an `ON CONFLICT`.
         *
         * Two clerks on the same cell both read "no live row" and both insert,
         * and the partial unique index turns the second into a `23505` — a 500
         * on a form that has never failed. `targetWhere` is that index's own
         * predicate, which Postgres **requires** in order to infer a *partial*
         * index: without it this statement does not merely lose the fallback,
         * it fails outright, and it fails only on the path nothing tests.
         */
        const saved = await db
          .insert(timetableEntries)
          .values(values)
          .onConflictDoUpdate({
            target: [
              timetableEntries.locationId,
              timetableEntries.sectionId,
              timetableEntries.slotId,
              timetableEntries.dayOfWeek,
            ],
            targetWhere: and(
              isNull(timetableEntries.effectiveTo),
              eq(timetableEntries.isActive, true),
            ),
            set: {
              subjectId,
              teacherId,
              academicYearId,
              room,
              isActive: true,
              updatedAt: now,
            },
          })
          .returning({ id: timetableEntries.id });

        entryId = saved[0]?.id;
      }

      if (entryId === undefined) {
        return apiFailure('write_failed', 'Could not save the lesson.', 500);
      }

      return apiSuccess({ entryId });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.write' },
);
