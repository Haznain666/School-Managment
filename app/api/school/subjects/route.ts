import { isHexColor, subjects } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { listSubjects } from '@/lib/academics-queries';
import { db } from '@/lib/drizzle';
import { readOptionalString, readString } from '@/lib/validation';
import { ACADEMICS_READ_ROLES, ACADEMICS_WRITE_ROLES } from '@/types/school-auth';

/**
 * /api/school/subjects
 *
 * GET  what the school teaches, alphabetically
 * POST add a subject
 *
 * The name is unique per school, and the insert leans on that index rather than
 * checking first: two admins adding "Physics" at the same moment would both
 * pass a check, and only the constraint can actually decide.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const activeOnly = url.searchParams.get('activeOnly') === 'true';

      return apiSuccess({ subjects: await listSubjects(auth.locationId, { activeOnly }) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: ACADEMICS_READ_ROLES },
);

interface CreateSubjectBody {
  name?: unknown;
  code?: unknown;
  color?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateSubjectBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const name = readString(body.name);
      if (name === '' || name.length > 80) {
        return apiFailure(
          'invalid_body',
          'Enter a subject name of 80 characters or fewer.',
          400,
        );
      }

      const code = readOptionalString(body.code);
      if (code !== null && code.length > 12) {
        return apiFailure('invalid_body', 'Use a code of 12 characters or fewer.', 400);
      }

      const color = readOptionalString(body.color);
      if (color !== null && !isHexColor(color)) {
        return apiFailure('invalid_body', 'Choose a colour from the palette.', 400);
      }

      const created = await db
        .insert(subjects)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          name,
          code,
          color,
        })
        .onConflictDoNothing({ target: [subjects.locationId, subjects.name] })
        .returning({ id: subjects.id });

      if (created[0] === undefined) {
        return apiFailure(
          'duplicate',
          `Your school already teaches a subject called "${name}".`,
          409,
        );
      }

      return apiSuccess({ subjectId: created[0].id }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: ACADEMICS_WRITE_ROLES },
);
