import { and, eq } from 'drizzle-orm';

import { schoolUsers, timetableEntries, timetableSubstitutions } from '@/db/schema';
import { schoolDayOfWeek } from '@/db/schema/timetable-entries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { effectiveBranchIds, resolveBranchScope } from '@/lib/branch-scope';
import { db } from '@/lib/drizzle';
import { notifySubstitute } from '@/lib/substitute-notifier';
import { visibleScopeFor } from '@/lib/principal-visibility';
import { getSchoolUserByUid } from '@/lib/school-queries';
import {
  listFreeTeachers,
  listSectionDay,
  listSubstituteSections,
  reachableTeachers,
  substituteRefusal,
} from '@/lib/teacher-availability';
import { liveTimetableEntries } from '@/lib/timetable-history';
import { isIsoDate, isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/timetable/substitutes — Sprint 33c, C4.
 *
 * GET  the classes in reach, one class's lessons on a date, and who is free
 * POST arrange cover for one period on one date, and tell the teacher
 *
 * ── One route, three answers, because the screen asks in three steps ─────
 * The panel picks a date, then a class, then a period, and each step needs the
 * next list. Three endpoints would mean three permission surfaces and three
 * places to get the scope right; the scope is resolved once here and the
 * parameters say how far the caller has got.
 *
 * ── `timetable.substitute`, not `academics.write` ────────────────────────
 * Building a grid is a plan; arranging cover commits a named colleague's
 * afternoon and sends them a message saying so. §0 of the spec: every
 * approval-type or access setting is a permission key, never a hard-coded role
 * list. The spec's four roles are the *default* in `DEFAULT_ROLE_PERMISSIONS`
 * and a school can move it on the matrix.
 *
 * ── The key is the door; the chain of command is the room ────────────────
 * `reachableTeachers` resolves *whose* through `lib/approval-chain.ts` — a
 * coordinator reaches their own teachers, a section head their coordinators',
 * a head their campus. That is Part B's answer to exactly this question and
 * there is deliberately no second resolver.
 *
 * ── The list is not the authorisation ────────────────────────────────────
 * `substituteRefusal` re-derives availability on the POST. A lesson can be
 * placed, leave approved or a holiday declared between the panel rendering and
 * the button being pressed, and a target id in a request body is untrusted
 * however it was obtained. The same separation `decisionRefusal` draws for
 * leave.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const date = url.searchParams.get('date') ?? '';
      const sectionId = url.searchParams.get('sectionId');
      const slotId = url.searchParams.get('slotId');

      if (!isIsoDate(date)) {
        return apiFailure('invalid_query', 'Choose a date.', 400);
      }

      const [me, activeYear, branchScope, visible] = await Promise.all([
        getSchoolUserByUid(auth.locationId, auth.uid),
        getActiveAcademicYear(auth.locationId),
        resolveBranchScope(auth.locationId, auth),
        visibleScopeFor(auth),
      ]);

      if (activeYear === null) {
        return apiFailure(
          'no_active_year',
          'Your school has not opened an academic year yet, so there is no timetable to cover.',
          422,
        );
      }

      /*
       * A weekend. `day_of_week` is 0–4 by CHECK on both tables, so there is no
       * period to cover and the honest answer is that the question does not
       * apply — not an empty list, which reads as "nobody is free".
       */
      if (schoolDayOfWeek(new Date(`${date}T00:00:00Z`)) === null) {
        return apiFailure(
          'not_a_school_day',
          'Nothing is timetabled at the weekend, so there is no period to arrange cover for.',
          422,
        );
      }

      const sections = await listSubstituteSections(
        auth.locationId,
        activeYear.id,
        visible.gradeIds,
      );

      if (sectionId === null) {
        return apiSuccess({ date, academicYearId: activeYear.id, sections });
      }

      if (!isUuid(sectionId) || !sections.some((row) => row.id === sectionId)) {
        return apiFailure('not_found', 'That class is not one you can see.', 404);
      }

      const lessons = await listSectionDay(auth.locationId, {
        sectionId,
        academicYearId: activeYear.id,
        date,
      });

      if (slotId === null) {
        return apiSuccess({
          date,
          academicYearId: activeYear.id,
          sections,
          lessons: lessons ?? [],
        });
      }

      if (!isUuid(slotId)) {
        return apiFailure('invalid_query', 'Choose a period.', 400);
      }

      const candidates = await reachableTeachers(
        auth.locationId,
        { schoolUserId: me?.id ?? null, role: auth.role },
        effectiveBranchIds(branchScope),
      );

      const availability = await listFreeTeachers(auth.locationId, {
        date,
        slotId,
        academicYearId: activeYear.id,
        candidates,
      });

      if (availability === null) {
        return apiFailure('not_found', 'That period does not exist.', 404);
      }

      return apiSuccess({
        date,
        academicYearId: activeYear.id,
        sections,
        lessons: lessons ?? [],
        availability,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'timetable.substitute' },
);

interface ArrangeBody {
  date?: unknown;
  sectionId?: unknown;
  slotId?: unknown;
  coverTeacherId?: unknown;
  note?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<ArrangeBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const { date, sectionId, slotId, coverTeacherId } = body;

      if (
        typeof date !== 'string' ||
        !isIsoDate(date) ||
        !isUuid(sectionId) ||
        !isUuid(slotId) ||
        !isUuid(coverTeacherId)
      ) {
        return apiFailure(
          'invalid_body',
          'Choose a date, a class, a period and the teacher who will cover it.',
          400,
        );
      }

      const note = readOptionalString(body.note);
      if (note !== null && note.length > 280) {
        return apiFailure('invalid_body', 'Keep the note to 280 characters or fewer.', 400);
      }

      const dayOfWeek = schoolDayOfWeek(new Date(`${date}T00:00:00Z`));
      if (dayOfWeek === null) {
        return apiFailure(
          'not_a_school_day',
          'Nothing is timetabled at the weekend, so there is no period to arrange cover for.',
          422,
        );
      }

      const [me, activeYear, branchScope, visible] = await Promise.all([
        getSchoolUserByUid(auth.locationId, auth.uid),
        getActiveAcademicYear(auth.locationId),
        resolveBranchScope(auth.locationId, auth),
        visibleScopeFor(auth),
      ]);

      if (activeYear === null) {
        return apiFailure('no_active_year', 'There is no active academic year.', 422);
      }

      // The class has to be one this caller can see at all, re-derived rather
      // than taken from whatever the browser sent.
      const sections = await listSubstituteSections(
        auth.locationId,
        activeYear.id,
        visible.gradeIds,
      );
      if (!sections.some((row) => row.id === sectionId)) {
        return apiFailure('not_found', 'That class is not one you can see.', 404);
      }

      const candidates = await reachableTeachers(
        auth.locationId,
        { schoolUserId: me?.id ?? null, role: auth.role },
        effectiveBranchIds(branchScope),
      );

      const availability = await listFreeTeachers(auth.locationId, {
        date,
        slotId,
        academicYearId: activeYear.id,
        candidates,
      });

      if (availability === null) {
        return apiFailure('not_found', 'That period does not exist.', 404);
      }

      const refusal = substituteRefusal(availability, coverTeacherId);
      if (refusal !== null) return apiFailure('not_free', refusal, 409);

      /*
       * The lesson as it stands **on the cover date**, which is what decides
       * who is being covered for. Reading it as it stands today would name the
       * wrong teacher for a date on the far side of a supersede — the class of
       * defect `0049` exists to close, reappearing in the table built on top
       * of it.
       */
      const standingRows = await db
        .select({ id: timetableEntries.id, teacherId: timetableEntries.teacherId })
        .from(timetableEntries)
        .where(
          and(
            eq(timetableEntries.locationId, auth.locationId),
            eq(timetableEntries.sectionId, sectionId),
            eq(timetableEntries.slotId, slotId),
            eq(timetableEntries.dayOfWeek, dayOfWeek),
            eq(timetableEntries.academicYearId, activeYear.id),
            eq(timetableEntries.isActive, true),
            liveTimetableEntries(date),
          ),
        )
        .limit(1);

      const standing = standingRows[0] ?? null;

      if (standing !== null && standing.teacherId === coverTeacherId) {
        return apiFailure(
          'already_theirs',
          'That period is already theirs, so there is nothing to cover.',
          422,
        );
      }

      /*
       * `onConflictDoUpdate` on (location, section, slot, date) rather than an
       * insert that can fail: two heads arranging cover for the same period
       * within a minute of each other is an ordinary Monday, and the second one
       * meeting a 500 would leave them unsure which teacher had been told. The
       * last arrangement wins and the newly named teacher is the one notified.
       */
      const saved = await db
        .insert(timetableSubstitutions)
        .values({
          // The tenant is the session's, never the body's.
          locationId: auth.locationId,
          academicYearId: activeYear.id,
          entryId: standing?.id ?? null,
          sectionId,
          slotId,
          dayOfWeek,
          coverDate: date,
          originalTeacherId: standing?.teacherId ?? null,
          coverTeacherId,
          arrangedBy: me?.id ?? null,
          note,
        })
        .onConflictDoUpdate({
          target: [
            timetableSubstitutions.locationId,
            timetableSubstitutions.sectionId,
            timetableSubstitutions.slotId,
            timetableSubstitutions.coverDate,
          ],
          set: {
            entryId: standing?.id ?? null,
            academicYearId: activeYear.id,
            dayOfWeek,
            originalTeacherId: standing?.teacherId ?? null,
            coverTeacherId,
            arrangedBy: me?.id ?? null,
            note,
            updatedAt: new Date(),
          },
        })
        .returning({ id: timetableSubstitutions.id });

      if (saved[0] === undefined) {
        return apiFailure('write_failed', 'The cover could not be arranged.', 500);
      }

      const teacherRows = await db
        .select({ id: schoolUsers.id, name: schoolUsers.name })
        .from(schoolUsers)
        .where(
          and(
            eq(schoolUsers.locationId, auth.locationId),
            eq(schoolUsers.id, coverTeacherId),
          ),
        )
        .limit(1);

      const section = sections.find((row) => row.id === sectionId);

      /*
       * The teacher is told through the two paths that already exist — the bell
       * and, where the school runs chat, a message from the person who arranged
       * it. Awaited, because a cover nobody was told about is worse than no
       * cover; it swallows its own failures, because a notification that could
       * not be written must not turn an arranged substitution into a 500 the
       * head reads as "it did not save".
       */
      await notifySubstitute({
        locationId: auth.locationId,
        arrangedBy:
          me === null
            ? null
            : {
                schoolUserId: me.id,
                name: me.name,
                role: auth.role,
                branchId: me.branchId,
              },
        coverTeacher: {
          schoolUserId: coverTeacherId,
          name: teacherRows[0]?.name ?? 'the teacher',
        },
        date,
        sectionLabel: section?.label ?? 'a class',
        slotName: availability.slot.name,
        startTime: availability.slot.startTime,
        endTime: availability.slot.endTime,
        note,
      });

      return apiSuccess({ substitutionId: saved[0].id });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'timetable.substitute' },
);
