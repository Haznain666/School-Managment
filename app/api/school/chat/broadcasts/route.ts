import { MAX_BROADCAST_RECIPIENTS } from '@/db/schema/chat-broadcasts';
import { CONVERSATION_SUBJECT_MAX } from '@/db/schema/chat-conversations';
import { MESSAGE_BODY_MAX } from '@/db/schema/chat-messages';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { sendBroadcast } from '@/lib/chat-broadcast';
import { grantScopeProblem } from '@/lib/chat-grant-scope';
import { getSchoolUserByUid } from '@/lib/school-queries';

/**
 * /api/school/chat/broadcasts — one message, many private conversations.
 *
 * ── The section ids are re-derived, not trusted ──────────────────────────
 * A teacher may broadcast to a class she teaches and no other, and the picker
 * on the screen is a courtesy rather than the rule. Every section in the body
 * goes through `grantScopeProblem`, which resolves the answer from
 * `listTeacherSections` — the same function `lib/academics-queries.ts` calls
 * the teacher portal's authorisation list rather than a convenience.
 *
 * A crafted section id therefore reaches a class the sender already teaches, or
 * it is refused. Named pupils are constrained the same way inside
 * `sendBroadcast`, which only resolves pupils actively enrolled at this school
 * in this year.
 *
 * ── Why `chat.send` and not `comms.send` ─────────────────────────────────
 * This is not an announcement. An announcement is a document a school
 * publishes to a notice board; this opens thirty two-way conversations that
 * thirty people can reply into individually, and the permission that governs
 * replying to those is `chat.send`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BroadcastBody {
  sectionIds?: unknown;
  studentProfileIds?: unknown;
  includeStudents?: unknown;
  includeParents?: unknown;
  subject?: unknown;
  body?: unknown;
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const payload = await readJsonBody<BroadcastBody>(request);
      if (payload === null) return apiFailure('invalid_body', 'Send a message.', 400);

      const sectionIds = idList(payload.sectionIds);
      const studentProfileIds = idList(payload.studentProfileIds);
      const body = typeof payload.body === 'string' ? payload.body.trim() : '';
      const subjectRaw = typeof payload.subject === 'string' ? payload.subject.trim() : '';

      if (sectionIds.length === 0 && studentProfileIds.length === 0) {
        return apiFailure('invalid_body', 'Choose a class or some students.', 400);
      }
      if (body === '') return apiFailure('invalid_body', 'Write a message first.', 400);
      if (body.length > MESSAGE_BODY_MAX) {
        return apiFailure(
          'invalid_body',
          `A message can be at most ${String(MESSAGE_BODY_MAX)} characters.`,
          400,
        );
      }
      if (subjectRaw.length > CONVERSATION_SUBJECT_MAX) {
        return apiFailure('invalid_body', 'That subject is too long.', 400);
      }
      // A cheap upper bound before any query runs. The real count is checked
      // in `sendBroadcast` once parents are resolved.
      if (sectionIds.length + studentProfileIds.length > MAX_BROADCAST_RECIPIENTS) {
        return apiFailure('invalid_body', 'That is too many recipients for one message.', 400);
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      // Every section, re-derived against what this person may actually reach.
      for (const sectionId of sectionIds) {
        const problem = await grantScopeProblem(auth, me.id, 'section', sectionId);
        if (problem !== null) return apiFailure('refused', problem, 403);
      }
      for (const studentProfileId of studentProfileIds) {
        const problem = await grantScopeProblem(auth, me.id, 'student', studentProfileId);
        if (problem !== null) return apiFailure('refused', problem, 403);
      }

      const result = await sendBroadcast({
        locationId: auth.locationId,
        actor: {
          schoolUserId: me.id,
          name: me.name,
          role: auth.role,
          branchId: auth.branchId,
        },
        sectionIds,
        studentProfileIds,
        includeStudents: payload.includeStudents !== false,
        includeParents: payload.includeParents === true,
        subject: subjectRaw === '' ? null : subjectRaw,
        body,
      });

      if (!result.ok) return apiFailure('refused', result.problem, 403);

      return apiSuccess(result.outcome, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'chat.send' },
);
