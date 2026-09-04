import { randomUUID } from 'node:crypto';

import { chatAttachments } from '@/db/schema/chat-attachments';
import { MESSAGE_BODY_MAX } from '@/db/schema/chat-messages';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { oversightAdmits, resolveOversightScope } from '@/lib/chat-oversight';
import { containsLink } from '@/lib/chat-permissions';
import {
  isModeratableConversation,
  isParticipant,
  listMessages,
  postMessage,
  sendProblem,
} from '@/lib/chat-queries';
import {
  escalate,
  SAFEGUARDING_ACKNOWLEDGEMENT,
  safeguardingProblem,
  schoolName,
} from '@/lib/chat-safeguarding';
import { attachmentProblem, attachmentsForMessages, staffOnlyProblem } from '@/lib/chat-attachments';
import { db } from '@/lib/drizzle';
import { hasPermission } from '@/lib/permission-queries';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { buildStoragePath, uploadBuffer } from '@/lib/storage';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/chat/conversations/[id]/messages — the transcript, and posting.
 *
 * ── This is the route the Realtime design rests on ───────────────────────
 * The socket delivers `{conversationId, messageId}` and nothing readable; the
 * client then comes here for the content, and `withSchoolAuth` →
 * `membershipFor()` re-resolves who the caller is from `school_users` on *this*
 * request. That is the whole reason the signal carries no body — see
 * `db/schema/chat-signals.ts`. A conversation id in the URL is untrusted, and
 * `isParticipant` is what makes it safe.
 *
 * `?since=` is an ISO instant, so a client that has been disconnected asks for
 * what it missed rather than re-fetching two hundred messages it already has.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ conversationId: string }> };

interface PostBody {
  body?: unknown;
}

export const GET = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { conversationId } = await context.params;

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      /*
       * Seated, or a moderator reading a pupil's thread.
       *
       * The second is what `ROADMAP.md` agreed and every pupil thread's banner
       * already promises: administrators may review conversations involving a
       * student. It is narrow — `isModeratableConversation` is true only for
       * threads *about a pupil*, so a staff-to-staff thread and a parent's fee
       * query stay unreadable to somebody who is not in them.
       *
       * Without it a head investigating a report saw the one reported sentence
       * and none of the conversation around it, which is the one thing a
       * safeguarding investigation cannot work from.
       */
      const seated = await isParticipant(auth.locationId, conversationId, me.id);

      if (!seated) {
        const mayModerate =
          (await hasPermission(auth.locationId, auth.role, 'chat.moderate')) &&
          (await isModeratableConversation(auth.locationId, conversationId));

        /*
         * Sprint 26's second door, and it is wider than the first on purpose.
         *
         * Moderation admits a pupil thread because somebody reported a message
         * in it. Oversight admits the correspondence a person is accountable
         * for — the whole school for an administrator, their own campuses for a
         * head, their own grades' pupil threads for a head given grades. Both
         * are read-only: posting goes through `sendProblem`, which requires a
         * seat, so neither of these can write into a thread.
         *
         * The scope is re-derived here rather than trusted from the list the
         * screen was drawn from. `oversightAdmits` runs the same `WHERE` the
         * list ran, against the one id in this URL.
         */
        const mayOversee =
          !mayModerate &&
          (await hasPermission(auth.locationId, auth.role, 'chat.oversight')) &&
          (await oversightAdmits(
            auth.locationId,
            await resolveOversightScope(auth.locationId, auth.role, auth.uid),
            conversationId,
          ));

        if (!mayModerate && !mayOversee) {
          // 404 rather than 403: whether a conversation exists is itself
          // something a non-participant should not learn.
          return apiFailure('not_found', 'No such conversation.', 404);
        }
      }

      const sinceRaw = new URL(request.url).searchParams.get('since');
      const since = sinceRaw === null ? null : new Date(sinceRaw);
      if (since !== null && Number.isNaN(since.getTime())) {
        return apiFailure('invalid_query', 'since must be an ISO timestamp.', 400);
      }

      const messages = await listMessages(auth.locationId, conversationId, since);

      // One extra read rather than a join: the transcript query is already four
      // tables and most conversations have no attachments at all, so this
      // returns nothing for nearly every call.
      const attachments = await attachmentsForMessages(
        auth.locationId,
        messages.map((message) => message.id),
      );

      return apiSuccess({ messages, attachments });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { conversationId } = await context.params;

      /*
       * One send path, two content types. A message with a file arrives as
       * `multipart/form-data` and one without as JSON, and both land here —
       * deliberately, because every window, quota, turn-taking and safeguarding
       * check below applies to both. A second upload route would be a second
       * place for a pupil's reply window to be forgotten.
       */
      const contentType = request.headers.get('content-type') ?? '';
      const isMultipart = contentType.includes('multipart/form-data');

      let body = '';
      let file: File | null = null;

      if (isMultipart) {
        const form = await request.formData();
        const raw = form.get('body');
        body = typeof raw === 'string' ? raw.trim() : '';

        const candidate = form.get('attachment');
        file = candidate instanceof File && candidate.size > 0 ? candidate : null;
      } else {
        const payload = await readJsonBody<PostBody>(request);
        body = typeof payload?.body === 'string' ? payload.body.trim() : '';
      }

      // A file on its own is a message. A message with neither is not.
      if (body === '' && file === null) {
        return apiFailure('invalid_body', 'Write a message first.', 400);
      }
      if (body.length > MESSAGE_BODY_MAX) {
        return apiFailure(
          'invalid_body',
          `A message can be at most ${String(MESSAGE_BODY_MAX)} characters.`,
          400,
        );
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      // One read that is both the membership check and every window, quota and
      // turn-taking rule. A refusal here is a sentence the sender can act on.
      const problem = await sendProblem(auth.locationId, me.id, conversationId);
      if (problem !== null) return apiFailure('refused', problem, 403);

      /*
       * The file, validated before anything is written.
       *
       * `staffOnlyProblem` is the control this whole feature rests on: every
       * uploader is a known adult accountable to the school, which is what
       * removes the need for a content scanner. It is checked here rather than
       * by hiding a button, because a hidden button is not a rule.
       */
      let upload: { storagePath: string; fileName: string; contentType: string; size: number } | null =
        null;

      if (file !== null) {
        const staffProblem = staffOnlyProblem(auth.role);
        if (staffProblem !== null) return apiFailure('refused', staffProblem, 403);

        const bytes = new Uint8Array(await file.arrayBuffer());
        const verdict = attachmentProblem(bytes, file.name);

        if ('problem' in verdict) {
          return apiFailure('invalid_body', verdict.problem, 400);
        }

        // A fresh name, never the sender's. `uploadBuffer` sets `x-upsert`, so
        // two people sending `photo.jpg` would otherwise overwrite each other —
        // the reason the feedback route does the same thing.
        const storagePath = buildStoragePath({
          locationId: auth.locationId,
          branchId: auth.branchId,
          type: 'chat',
          filename: `${randomUUID()}.${verdict.contentType === 'application/pdf' ? 'pdf' : verdict.contentType === 'image/png' ? 'png' : 'jpg'}`,
        });

        await uploadBuffer({
          storagePath,
          buffer: Buffer.from(bytes),
          contentType: verdict.contentType,
        });

        upload = {
          storagePath,
          fileName: file.name.slice(0, 200),
          contentType: verdict.contentType,
          size: bytes.byteLength,
        };
      }

      const flaggedReason = safeguardingProblem(body);

      // `chat_messages.body` is `length BETWEEN 1 AND 2000`, so a file sent with
      // no words still needs a sentence. Saying what happened beats an empty
      // bubble somebody has to hover to understand.
      const storedBody = body === '' ? 'Sent a file.' : body;

      const posted = await postMessage({
        locationId: auth.locationId,
        conversationId,
        senderSchoolUserId: me.id,
        senderName: me.name,
        senderRole: auth.role,
        body: storedBody,
        flaggedReason,
      });

      if (upload !== null) {
        await db.insert(chatAttachments).values({
          locationId: auth.locationId,
          messageId: posted.id,
          storagePath: upload.storagePath,
          fileName: upload.fileName,
          contentType: upload.contentType,
          sizeBytes: upload.size,
        });
      }

      // The message is stored first and escalated second, and never the other
      // way round: a pupil's words must survive a failing mail queue. `escalate`
      // never throws, and the acknowledgement is posted whatever it did — a
      // child who has just said the hardest thing they will type should not be
      // met with silence because an SMTP host was slow.
      if (flaggedReason !== null) {
        await escalate({
          locationId: auth.locationId,
          conversationId,
          messageId: posted.id,
          reason: flaggedReason,
        });

        await postMessage({
          locationId: auth.locationId,
          conversationId,
          senderSchoolUserId: null,
          senderName: await schoolName(auth.locationId),
          senderRole: 'system',
          kind: 'system',
          body: SAFEGUARDING_ACKNOWLEDGEMENT,
        });
      }

      return apiSuccess(
        {
          message: {
            id: posted.id,
            createdAt: posted.createdAt,
            // The client renders a pupil's links as inert text. Deciding it
            // here means the same answer reaches every portal rather than four
            // regexes drifting apart.
            linksInert: auth.role === 'student' && containsLink(body),
          },
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
