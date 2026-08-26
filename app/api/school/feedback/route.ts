import { randomUUID } from 'node:crypto';

import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import {
  attachmentProblem,
  feedbackProblem,
  MAX_ATTACHMENTS,
  resolveContentType,
} from '@/lib/feedback';
import { createFeedbackTicket, listSchoolFeedback } from '@/lib/feedback-queries';
import { isFeedbackNature } from '@/db/schema';
import { notify, platformOwnerEmail } from '@/lib/notifications';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { getSchoolBranding } from '@/lib/school-tenant';
import { buildStoragePath, deleteObject, uploadBuffer } from '@/lib/storage';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

/**
 * GET  /api/school/feedback — this school's own tickets.
 * POST /api/school/feedback — send one, with up to five files.
 *
 * ── Why `allowedRoles` and not a permission ──────────────────────────────
 * Feedback is a person telling the vendor something, not a school resource one
 * colleague may be allowed to touch and another not. A `feedback.write` toggle
 * on the permissions screen would be a switch no administrator has a reason to
 * move, and the one thing it could do is stop a school reporting a bug — which
 * is the opposite of what this feature is for. It is therefore the same
 * judgement `/me`, `/settings` and `/branches` already make: any signed-in
 * member of the administrative portal.
 *
 * Adding a permission key would also have needed a migration to widen the
 * `role_permissions` CHECK. §5o records what happens when that is forgotten:
 * Sprint 9 shipped five keys the database refused.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      return apiSuccess({ tickets: await listSchoolFeedback(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: ADMIN_PORTAL_ROLES },
);

export const POST = withSchoolAuth(
  async (request, auth) => {
    // Written to as each upload succeeds, so a failure part-way through can
    // remove what has already landed. Without this a refused sixth file would
    // leave five orphans in the bucket that nothing ever references.
    const uploaded: string[] = [];

    try {
      const form = await request.formData();

      const title = String(form.get('title') ?? '');
      const body = String(form.get('body') ?? '');
      const natureRaw = form.get('nature');

      // The product owner's default, applied on the server as well as in the
      // form: a POST from anywhere else that names no nature is a suggestion.
      const nature = isFeedbackNature(natureRaw) ? natureRaw : 'suggestion';

      const problem = feedbackProblem({ title, body, nature });
      if (problem !== null) {
        return apiFailure('invalid_body', problem, 400);
      }

      const files = form.getAll('attachments').filter((entry): entry is File => {
        return entry instanceof File && entry.size > 0;
      });

      if (files.length > MAX_ATTACHMENTS) {
        return apiFailure(
          'too_many_attachments',
          `Attach at most ${MAX_ATTACHMENTS} files.`,
          400,
        );
      }

      for (const file of files) {
        const fileProblem = attachmentProblem(file);
        if (fileProblem !== null) {
          return apiFailure('unsupported_attachment', fileProblem, 415);
        }
      }

      const [me, branding] = await Promise.all([
        getSchoolUserByUid(auth.locationId, auth.uid),
        getSchoolBranding(auth.locationId),
      ]);

      const schoolName = branding?.name ?? 'A school';

      const attachments = [];

      for (const file of files) {
        const contentType = resolveContentType(file);

        /*
         * The stored name is a fresh uuid, and the name the person chose is
         * kept in the row instead. Two reasons, and the second is the one that
         * bites: a school uploading `screenshot.png` twice would overwrite
         * itself, because `uploadBuffer` sets `x-upsert` — and a filename off a
         * desktop carries whatever characters that desktop allows.
         *
         * The tenant segment comes from the verified session, so a school can
         * only ever write inside its own prefix.
         */
        const extension =
          contentType === 'application/pdf'
            ? 'pdf'
            : contentType === 'image/png'
              ? 'png'
              : 'jpg';

        const storagePath = buildStoragePath({
          locationId: auth.locationId,
          branchId: null,
          type: 'feedback',
          filename: `${randomUUID()}.${extension}`,
        });

        await uploadBuffer({
          storagePath,
          buffer: Buffer.from(await file.arrayBuffer()),
          contentType,
        });

        uploaded.push(storagePath);

        attachments.push({
          storagePath,
          fileName: file.name,
          contentType,
          sizeBytes: file.size,
        });
      }

      const ticket = await createFeedbackTicket({
        locationId: auth.locationId,
        submittedBy: me?.id ?? null,
        /*
         * The operator reading this in six months needs a name even if the
         * account has gone, which is why it is copied onto the row at all.
         *
         * The fallback was `auth.uid`, and QA caught what that renders as: the
         * listing showed a raw uuid where a person's name belongs. A profile is
         * absent for exactly one caller — the platform operator inside a
         * school's portal, who has no `school_users` row by design — so naming
         * that is both shorter and true.
         */
        submittedByName: me?.name ?? 'Platform operator',
        submittedByEmail: me?.email ?? '',
        title: title.trim(),
        body: body.trim(),
        nature,
        attachments,
      });

      /*
       * The notification is awaited, and it cannot fail this request: `notify`
       * logs and returns rather than throwing. The school has sent its feedback
       * the moment the ticket row exists, and refusing the whole submission
       * because a bell row could not be written would lose what they typed.
       */
      await notify({
        audience: 'super_admin',
        locationId: auth.locationId,
        kind: 'feedback_submitted',
        title: `${nature === 'bug' ? 'Bug' : 'Suggestion'}: ${title.trim()}`,
        body: `${schoolName} — sent by ${me?.name ?? 'a school administrator'}.`,
        href: `/super-admin/feedback/${ticket.id}`,
        email: platformOwnerEmail(),
        emailSubject: `New ${nature === 'bug' ? 'bug report' : 'suggestion'} from ${schoolName}`,
        emailText:
          `${schoolName} has sent feedback.\n\n` +
          `Title:   ${title.trim()}\n` +
          `Nature:  ${nature === 'bug' ? 'Bug' : 'Suggestion'}\n` +
          `From:    ${me?.name ?? 'A school administrator'}` +
          `${me === null || me.email === null || me.email === '' ? '' : ` <${me.email}>`}\n` +
          `Files:   ${attachments.length}\n\n` +
          `${body.trim()}\n`,
      });

      return apiSuccess({ id: ticket.id }, 201);
    } catch (error) {
      for (const storagePath of uploaded) {
        try {
          await deleteObject(storagePath);
        } catch {
          // Already logged by the caller's error; an orphan costs kilobytes.
        }
      }

      return handleApiError(error);
    }
  },
  { allowedRoles: ADMIN_PORTAL_ROLES },
);
