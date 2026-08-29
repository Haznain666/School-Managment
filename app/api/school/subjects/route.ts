import { isHexColor, subjects } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { listSubjects } from '@/lib/academics-queries';
import {
  branchForWrite,
  effectiveBranchIds,
  readBranchParam,
  resolveBranchScope,
} from '@/lib/branch-scope';
import { db } from '@/lib/drizzle';
import { readOptionalString, readString } from '@/lib/validation';

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

      // Shared subjects plus the campuses this caller reaches. `?branch=`
      // narrows further and is validated by the resolver, never here.
      const scope = await resolveBranchScope(auth.locationId, auth, readBranchParam(url));

      return apiSuccess({
        subjects: await listSubjects(auth.locationId, {
          activeOnly,
          branchIds: effectiveBranchIds(scope),
        }),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.read' },
);

interface CreateSubjectBody {
  name?: unknown;
  code?: unknown;
  color?: unknown;
  /** Null or absent = shared by every campus. Item 2e validates it. */
  branchId?: unknown;
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
        return apiFailure('invalid_body', 'Enter a colour as a six-digit hex code, for example #2563eb.', 400);
      }

      // Item 2e. A campus in the body is checked against the caller's own
      // scope before anything is written — a stale tab left open across a
      // reassignment would otherwise post a row that satisfies every
      // constraint and then appears in no listing.
      const scope = await resolveBranchScope(auth.locationId, auth);
      const campus = branchForWrite(scope, readOptionalString(body.branchId));
      if (!campus.ok) return apiFailure('forbidden', campus.message, 403);

      const created = await db
        .insert(subjects)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          branchId: campus.branchId,
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
  { permission: 'academics.write' },
);
