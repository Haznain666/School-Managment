import { and, eq, ne } from 'drizzle-orm';

import {
  studentGuardians,
  isGuardianRelationship,
  FIRST_GUARDIAN_RELATIONSHIPS,
  GUARDIAN_RELATIONSHIP_LABELS,
  SINGLETON_RELATIONSHIPS,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getStudentDetail, listGuardians } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { normalizeCnic } from '@/lib/national-id';
import { InvalidPhoneError, normalizePhone } from '@/lib/phone';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/students/[studentId]/guardians/[guardianId]
 *
 * PATCH  edit a guardian
 * DELETE remove one, unless they are the last
 *
 * The link to a portal account (`school_user_id`) is not editable here: it is
 * matched by phone number when an account exists, and letting it be set by hand
 * would let one parent be attached to another family's child.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ studentId: string; guardianId: string }> };

interface UpdateGuardianBody {
  name?: unknown;
  relationship?: unknown;
  relationshipOther?: unknown;
  phone?: unknown;
  email?: unknown;
  cnic?: unknown;
  occupation?: unknown;
  isPrimaryContact?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { studentId, guardianId } = await context.params;
      if (!isUuid(studentId) || !isUuid(guardianId)) {
        return apiFailure('not_found', 'Guardian not found.', 404);
      }

      const student = await getStudentDetail(auth.locationId, studentId);
      if (student === null) return apiFailure('not_found', 'Student not found.', 404);

      if (auth.branchId !== null && student.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      const guardians = await listGuardians(auth.locationId, studentId);
      const existing = guardians.find((guardian) => guardian.id === guardianId);
      if (existing === undefined) {
        return apiFailure('not_found', 'Guardian not found.', 404);
      }

      const body = await readJsonBody<UpdateGuardianBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof studentGuardians.$inferInsert> = {};

      if (body.name !== undefined) {
        const name = readString(body.name);
        if (name === '') {
          return apiFailure('invalid_body', 'The guardian’s name cannot be empty.', 400);
        }
        updates.name = name;
      }

      if (body.relationship !== undefined) {
        const relationship = readString(body.relationship);
        if (!isGuardianRelationship(relationship)) {
          return apiFailure('invalid_body', 'Select a valid relationship.', 400);
        }

        /*
         * The same three rules the create path enforces, applied to an edit.
         *
         * Editing is how you would otherwise get around them: add a lawful
         * second Father-less guardian, then change them to Father. The
         * comparison excludes this row so that re-saving a guardian without
         * changing their relationship is never refused as a clash with
         * themselves.
         */
        const others = guardians.filter((guardian) => guardian.id !== guardianId);

        if (
          others.length === 0 &&
          !(FIRST_GUARDIAN_RELATIONSHIPS as readonly string[]).includes(relationship)
        ) {
          return apiFailure(
            'invalid_body',
            'The only guardian on a student must be their father, mother or sibling.',
            400,
          );
        }

        if (
          (SINGLETON_RELATIONSHIPS as readonly string[]).includes(relationship) &&
          others.some((guardian) => guardian.relationship === relationship)
        ) {
          return apiFailure(
            'already_exists',
            `This student already has a guardian recorded as ${GUARDIAN_RELATIONSHIP_LABELS[relationship]}.`,
            409,
          );
        }

        const relationshipOther = readOptionalString(body.relationshipOther);
        if (relationship === 'other' && relationshipOther === null) {
          return apiFailure(
            'invalid_body',
            'Say how this guardian is related to the student.',
            400,
          );
        }

        updates.relationship = relationship;
        updates.relationshipOther = relationship === 'other' ? relationshipOther : null;
      }

      if (body.phone !== undefined) {
        try {
          updates.phone = normalizePhone(readString(body.phone));
        } catch (error) {
          if (error instanceof InvalidPhoneError) {
            return apiFailure(
              'invalid_phone',
              'Enter a valid Pakistani mobile number, for example 0300-1234567.',
              400,
            );
          }
          throw error;
        }
      }

      if (body.email !== undefined) updates.email = readOptionalString(body.email);
      if (body.cnic !== undefined) {
        // Canonicalised, never stored as typed — this column decides who is a
        // sibling. See `normalizeCnic`.
        const cnic = normalizeCnic(readOptionalString(body.cnic));

        if (
          cnic !== null &&
          guardians.some(
            (guardian) => guardian.id !== guardianId && guardian.cnic === cnic,
          )
        ) {
          return apiFailure(
            'already_exists',
            'Another guardian on this student already carries that CNIC.',
            409,
          );
        }

        updates.cnic = cnic;
      }
      if (body.occupation !== undefined) {
        updates.occupation = readOptionalString(body.occupation);
      }

      // Demoting the only primary would leave the school with no number to
      // ring, so the flag can be set here but never cleared.
      const promoting = body.isPrimaryContact === true;
      if (promoting) updates.isPrimaryContact = true;

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      await db
        .update(studentGuardians)
        .set(updates)
        .where(
          and(
            eq(studentGuardians.id, guardianId),
            eq(studentGuardians.locationId, auth.locationId),
            eq(studentGuardians.studentProfileId, studentId),
          ),
        );

      if (promoting) {
        await db
          .update(studentGuardians)
          .set({ isPrimaryContact: false })
          .where(
            and(
              eq(studentGuardians.locationId, auth.locationId),
              eq(studentGuardians.studentProfileId, studentId),
              ne(studentGuardians.id, guardianId),
            ),
          );
      }

      return apiSuccess({ guardians: await listGuardians(auth.locationId, studentId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { studentId, guardianId } = await context.params;
      if (!isUuid(studentId) || !isUuid(guardianId)) {
        return apiFailure('not_found', 'Guardian not found.', 404);
      }

      const student = await getStudentDetail(auth.locationId, studentId);
      if (student === null) return apiFailure('not_found', 'Student not found.', 404);

      if (auth.branchId !== null && student.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      const guardians = await listGuardians(auth.locationId, studentId);
      const target = guardians.find((guardian) => guardian.id === guardianId);
      if (target === undefined) {
        return apiFailure('not_found', 'Guardian not found.', 404);
      }

      if (guardians.length <= 1) {
        return apiFailure(
          'last_guardian',
          'A student must keep at least one guardian. Add another before removing this one.',
          409,
        );
      }

      await db
        .delete(studentGuardians)
        .where(
          and(
            eq(studentGuardians.id, guardianId),
            eq(studentGuardians.locationId, auth.locationId),
            eq(studentGuardians.studentProfileId, studentId),
          ),
        );

      // Removing the primary contact leaves nobody flagged, so the next
      // guardian takes over rather than the school being left with none.
      if (target.isPrimaryContact) {
        const remaining = guardians.find((guardian) => guardian.id !== guardianId);
        if (remaining !== undefined) {
          await db
            .update(studentGuardians)
            .set({ isPrimaryContact: true })
            .where(
              and(
                eq(studentGuardians.id, remaining.id),
                eq(studentGuardians.locationId, auth.locationId),
              ),
            );
        }
      }

      return apiSuccess({ guardians: await listGuardians(auth.locationId, studentId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
