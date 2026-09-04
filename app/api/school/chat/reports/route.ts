import { and, desc, eq } from 'drizzle-orm';

import { chatMessages } from '@/db/schema/chat-messages';
import {
  chatReports,
  REPORT_REASON_MAX,
  REPORT_STATUSES,
} from '@/db/schema/chat-reports';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { isParticipant } from '@/lib/chat-queries';
import { db } from '@/lib/drizzle';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/chat/reports — reporting a message, and the moderation queue.
 *
 * The two verbs are gated differently on purpose, and it is the one asymmetry
 * in this module worth stating twice.
 *
 * **POST is open to every role.** A pupil or a parent who cannot report a
 * message has no way to raise anything at all, and a "report" button that only
 * staff can press protects the wrong people. The write is safe because it names
 * a message the caller can already see: `isParticipant` runs first, so a
 * crafted message id from a conversation they are not in reports nothing.
 *
 * **GET needs `chat.moderate`.** The queue is a list of things people said in
 * confidence to a school, and reading it is what a safeguarding complaint comes
 * back to.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReportBody {
  messageId?: unknown;
  reason?: unknown;
}

interface ResolveBody {
  reportId?: unknown;
  status?: unknown;
  resolutionNote?: unknown;
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const status = new URL(request.url).searchParams.get('status') ?? 'open';
      if (!(REPORT_STATUSES as readonly string[]).includes(status)) {
        return apiFailure('invalid_query', 'That is not a report status.', 400);
      }

      const reports = await db
        .select({
          id: chatReports.id,
          conversationId: chatReports.conversationId,
          messageId: chatReports.messageId,
          source: chatReports.source,
          severity: chatReports.severity,
          reason: chatReports.reason,
          status: chatReports.status,
          escalatedAt: chatReports.escalatedAt,
          createdAt: chatReports.createdAt,
          messageBody: chatMessages.body,
          messageSender: chatMessages.senderName,
          messageSenderRole: chatMessages.senderRole,
          messageRedactedAt: chatMessages.redactedAt,
        })
        .from(chatReports)
        .innerJoin(chatMessages, eq(chatMessages.id, chatReports.messageId))
        .where(
          and(eq(chatReports.locationId, auth.locationId), eq(chatReports.status, status)),
        )
        // Safeguarding first, then oldest — a queue sorted only by age buries
        // the one report that should never have been in a queue.
        .orderBy(desc(chatReports.severity), desc(chatReports.createdAt))
        .limit(200);

      return apiSuccess({ reports });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'chat.moderate' },
);

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<ReportBody>(request);
      const messageId = body?.messageId;
      const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

      if (typeof messageId !== 'string' || messageId === '') {
        return apiFailure('invalid_body', 'Say which message.', 400);
      }
      if (reason === '') {
        return apiFailure('invalid_body', 'Say what is wrong with it.', 400);
      }
      if (reason.length > REPORT_REASON_MAX) {
        return apiFailure(
          'invalid_body',
          `A reason can be at most ${String(REPORT_REASON_MAX)} characters.`,
          400,
        );
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      const rows = await db
        .select({ conversationId: chatMessages.conversationId })
        .from(chatMessages)
        .where(
          and(eq(chatMessages.locationId, auth.locationId), eq(chatMessages.id, messageId)),
        )
        .limit(1);

      const conversationId = rows[0]?.conversationId;
      if (conversationId === undefined) {
        return apiFailure('not_found', 'No such message.', 404);
      }

      // You may only report what you can see. Without this, a message id is a
      // way to learn that a conversation exists.
      if (!(await isParticipant(auth.locationId, conversationId, me.id))) {
        return apiFailure('not_found', 'No such message.', 404);
      }

      const created = await db
        .insert(chatReports)
        .values({
          locationId: auth.locationId,
          messageId,
          conversationId,
          reportedBy: me.id,
          source: 'user',
          severity: 'abuse',
          reason,
          status: 'open',
        })
        .returning({ id: chatReports.id });

      return apiSuccess({ report: created[0] }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);

export const PATCH = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<ResolveBody>(request);
      const reportId = body?.reportId;
      const status = body?.status;
      const note = typeof body?.resolutionNote === 'string' ? body.resolutionNote.trim() : '';

      if (typeof reportId !== 'string' || reportId === '') {
        return apiFailure('invalid_body', 'Say which report.', 400);
      }
      if (
        typeof status !== 'string' ||
        !(REPORT_STATUSES as readonly string[]).includes(status) ||
        status === 'open'
      ) {
        return apiFailure('invalid_body', 'Say how it was resolved.', 400);
      }
      if (note === '') {
        return apiFailure(
          'invalid_body',
          'Say what you decided. Closing a report with no reason is what makes people stop reporting.',
          400,
        );
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      const updated = await db
        .update(chatReports)
        .set({
          status,
          reviewedBy: me.id,
          reviewedAt: new Date(),
          resolutionNote: note,
        })
        .where(
          and(
            eq(chatReports.locationId, auth.locationId),
            eq(chatReports.id, reportId),
            eq(chatReports.status, 'open'),
          ),
        )
        .returning({ id: chatReports.id });

      if (updated.length === 0) {
        return apiFailure('not_found', 'That report is already closed.', 404);
      }

      return apiSuccess({ resolved: true });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'chat.moderate' },
);
