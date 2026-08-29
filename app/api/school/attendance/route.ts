import { and, eq } from 'drizzle-orm';

import {
  attendanceRecords,
  isAttendanceStatus,
  studentEnrollments,
  type AttendanceStatus,
} from '@/db/schema';
import { withSchoolAuth, type SchoolAuthContext } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { listSectionRegister, teacherTeachesSection } from '@/lib/academics-queries';
import { batch, db, type Tx } from '@/lib/drizzle';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { isIsoDate, isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/attendance
 *
 * GET  the register for one section on one day
 * POST mark the whole class at once
 *
 * Marking is a bulk upsert through `batch()`, which runs every row in one
 * transaction. A register is taken as a class, not a student at a time: forty
 * separate requests would leave a half-marked day if the tab were closed
 * partway, and the unique key on (location, date, student) means saving twice
 * corrects the same rows instead of duplicating them.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A teacher may only touch a section they are timetabled into. Admins are not
 * narrowed — running the school's registers is their job.
 */
async function teacherMayUseSection(
  auth: SchoolAuthContext,
  sectionId: string,
  academicYearId: string,
): Promise<boolean> {
  if (auth.role !== 'teacher') return true;

  const teacher = await getSchoolUserByUid(auth.locationId, auth.uid);
  if (teacher === null) return false;

  return teacherTeachesSection(auth.locationId, teacher.id, sectionId, academicYearId);
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const sectionId = url.searchParams.get('sectionId') ?? '';
      const academicYearId = url.searchParams.get('academicYearId') ?? '';
      const date = url.searchParams.get('date') ?? '';

      if (!isUuid(sectionId) || !isUuid(academicYearId)) {
        return apiFailure('invalid_query', 'Choose a section and an academic year.', 400);
      }
      if (!isIsoDate(date)) {
        return apiFailure('invalid_query', 'Choose a date.', 400);
      }

      if (!(await teacherMayUseSection(auth, sectionId, academicYearId))) {
        return apiFailure('forbidden', 'You do not teach that section.', 403);
      }

      const students = await listSectionRegister(auth.locationId, {
        sectionId,
        academicYearId,
        date,
      });

      return apiSuccess({
        students,
        // "Already marked" is what tells a teacher they are correcting rather
        // than taking the register — one student marked is enough for that.
        alreadyMarked: students.some((student) => student.record !== null),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.read' },
);

interface MarkRecordBody {
  studentProfileId?: unknown;
  enrollmentId?: unknown;
  status?: unknown;
  notes?: unknown;
}

interface MarkAttendanceBody {
  academicYearId?: unknown;
  sectionId?: unknown;
  date?: unknown;
  records?: unknown;
}

interface ParsedRecord {
  studentProfileId: string;
  enrollmentId: string;
  status: AttendanceStatus;
  notes: string | null;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<MarkAttendanceBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const { academicYearId, sectionId, date } = body;

      if (!isUuid(academicYearId) || !isUuid(sectionId)) {
        return apiFailure('invalid_body', 'Choose a section and an academic year.', 400);
      }
      if (!isIsoDate(date)) {
        return apiFailure('invalid_body', 'Choose a date.', 400);
      }
      if (!Array.isArray(body.records) || body.records.length === 0) {
        return apiFailure('invalid_body', 'There is nothing to mark.', 400);
      }
      if (body.records.length > 300) {
        return apiFailure('invalid_body', 'Mark at most 300 students at a time.', 400);
      }

      if (!(await teacherMayUseSection(auth, sectionId, academicYearId))) {
        return apiFailure('forbidden', 'You do not teach that section.', 403);
      }

      // The register the client posted is checked against the section's real
      // enrollment list. A student id from another class would otherwise be
      // marked here, in this section's name.
      const enrolled = await db
        .select({
          id: studentEnrollments.id,
          studentProfileId: studentEnrollments.studentProfileId,
        })
        .from(studentEnrollments)
        .where(
          and(
            eq(studentEnrollments.locationId, auth.locationId),
            eq(studentEnrollments.sectionId, sectionId),
            eq(studentEnrollments.academicYearId, academicYearId),
            eq(studentEnrollments.status, 'active'),
          ),
        );

      const enrolmentByStudent = new Map(
        enrolled.map((row) => [row.studentProfileId, row.id]),
      );

      const parsed: ParsedRecord[] = [];

      for (const raw of body.records as MarkRecordBody[]) {
        const studentProfileId = raw.studentProfileId;
        const enrollmentId = raw.enrollmentId;

        if (!isUuid(studentProfileId) || !isUuid(enrollmentId)) {
          return apiFailure('invalid_body', 'A student in the register is malformed.', 400);
        }
        if (!isAttendanceStatus(raw.status)) {
          return apiFailure(
            'invalid_body',
            'Every student must be marked present, absent, late, excused or holiday.',
            400,
          );
        }

        const known = enrolmentByStudent.get(studentProfileId);
        if (known === undefined || known !== enrollmentId) {
          return apiFailure(
            'invalid_body',
            'That student is not enrolled in this section for this year.',
            400,
          );
        }

        parsed.push({
          studentProfileId,
          enrollmentId,
          status: raw.status,
          notes: readOptionalString(raw.notes),
        });
      }

      // Who took the register, resolved from the verified session rather than
      // from the body — a disputed absence has to be answerable.
      const marker = await getSchoolUserByUid(auth.locationId, auth.uid);

      // Deferred until `batch()` opens the transaction: a Drizzle builder is
      // bound to the session that created it, so these must be built on `tx`.
      const statements = parsed.map((record) => (tx: Tx) =>
        tx
          .insert(attendanceRecords)
          .values({
            // Tenant comes from the verified session, never from the body.
            locationId: auth.locationId,
            academicYearId,
            date,
            studentProfileId: record.studentProfileId,
            enrollmentId: record.enrollmentId,
            status: record.status,
            markedBy: marker?.id ?? null,
            notes: record.notes,
          })
          .onConflictDoUpdate({
            target: [
              attendanceRecords.locationId,
              attendanceRecords.date,
              attendanceRecords.studentProfileId,
            ],
            set: {
              status: record.status,
              notes: record.notes,
              enrollmentId: record.enrollmentId,
              academicYearId,
              markedBy: marker?.id ?? null,
            },
          }),
      );

      await batch(db, (tx) => statements.map((statement) => statement(tx)));

      return apiSuccess({ marked: parsed.length, date });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'attendance.mark' },
);
