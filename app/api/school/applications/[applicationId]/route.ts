import { and, eq } from 'drizzle-orm';

import {
  admissionApplications,
  applicationReference,
  isApplicationStatus,
  type ApplicationStatus,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getApplicationDetail } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { createGuardianGHLContact } from '@/lib/ghl-admissions';
import { smtpConfigured } from '@/lib/email-sender';
import { enqueueEmail } from '@/lib/email-outbox';
import { getSchoolBranding } from '@/lib/school-tenant';
import { isUuid, readBoolean, readOptionalString } from '@/lib/validation';

/**
 * /api/school/applications/[applicationId]
 *
 * GET   the full submission
 * PATCH move it through review
 *
 * `pending -> reviewing -> accepted | rejected | waitlisted`, and a decision can
 * be revisited — a waitlisted applicant who is later offered a place is a
 * normal outcome, so the statuses are not a one-way door. What is refused is
 * changing an application that has already become a student: the enrollment is
 * the record from that point on.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ applicationId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { applicationId } = await context.params;
      if (!isUuid(applicationId)) {
        return apiFailure('not_found', 'Application not found.', 404);
      }

      const application = await getApplicationDetail(auth.locationId, applicationId);
      if (application === null) {
        return apiFailure('not_found', 'Application not found.', 404);
      }

      return apiSuccess({ application });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.read' },
);

interface UpdateApplicationBody {
  status?: unknown;
  statusReason?: unknown;
  /** Email the applicant about the decision. Default: no. */
  notifyGuardian?: unknown;
}

/** What the guardian is told, per outcome. Null = nothing worth sending. */
function decisionMessage(
  status: ApplicationStatus,
  params: { schoolName: string; studentName: string; reason: string | null },
): string | null {
  const { schoolName, studentName, reason } = params;

  switch (status) {
    case 'accepted':
      return `Good news from ${schoolName}: ${studentName}'s admission application has been accepted. Our admissions team will contact you shortly with the next steps.`;
    case 'rejected':
      return (
        `Thank you for applying to ${schoolName}. We are sorry to say that ${studentName}'s application has not been successful` +
        (reason === null ? '.' : `: ${reason}`)
      );
    case 'waitlisted':
      return `Update from ${schoolName}: ${studentName}'s application has been placed on our waiting list. We will be in touch as soon as a place becomes available.`;
    case 'reviewing':
      return `Update from ${schoolName}: ${studentName}'s admission application is now under review.`;
    case 'pending':
      return null;
    default:
      return null;
  }
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { applicationId } = await context.params;
      if (!isUuid(applicationId)) {
        return apiFailure('not_found', 'Application not found.', 404);
      }

      const existing = await getApplicationDetail(auth.locationId, applicationId);
      if (existing === null) {
        return apiFailure('not_found', 'Application not found.', 404);
      }

      if (auth.branchId !== null && existing.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Application not found.', 404);
      }

      if (existing.convertedToStudentProfileId !== null) {
        return apiFailure(
          'already_converted',
          'This application has already been converted into an enrollment.',
          409,
        );
      }

      const body = await readJsonBody<UpdateApplicationBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      if (!isApplicationStatus(body.status)) {
        return apiFailure('invalid_body', 'Select a valid status.', 400);
      }

      const statusReason = readOptionalString(body.statusReason);

      // A rejection without a reason is not reviewable later and cannot be
      // explained to the family, so it is refused.
      if (body.status === 'rejected' && statusReason === null) {
        return apiFailure(
          'invalid_body',
          'Give a reason when rejecting an application.',
          400,
        );
      }

      const updated = await db
        .update(admissionApplications)
        .set({
          status: body.status,
          statusReason,
          reviewedByUid: auth.uid,
          reviewedAt: new Date(),
        })
        .where(
          and(
            eq(admissionApplications.id, applicationId),
            eq(admissionApplications.locationId, auth.locationId),
          ),
        )
        .returning({ id: admissionApplications.id });

      if (updated[0] === undefined) {
        return apiFailure('not_found', 'Application not found.', 404);
      }

      let notified = false;

      if (readBoolean(body.notifyGuardian, false)) {
        // Never blocks the decision: the status change is the record. The
        // message is a courtesy on top of it, emailed where the school holds
        // an address. `notified` says whether it was sent.
        try {
          const branding = await getSchoolBranding(auth.locationId);
          const message = decisionMessage(body.status, {
            schoolName: branding?.name ?? 'your school',
            studentName: existing.studentName,
            reason: statusReason,
          });

          if (message !== null) {
            await createGuardianGHLContact(db, auth.locationId, {
              name: existing.guardianName,
              phone: existing.guardianPhone,
              email: existing.guardianEmail ?? undefined,
            });

            // Queued, not sent — same reasoning as the public apply route.
            // A clerk working through a backlog of fifty decisions must not
            // wait on an SMTP handshake per decision, and `notified` now
            // means "accepted for delivery", which is the strongest claim
            // anything in this codebase makes about an email.
            const guardianEmail = existing.guardianEmail;
            if (guardianEmail !== null && guardianEmail !== '' && smtpConfigured()) {
              await enqueueEmail({
                locationId: auth.locationId,
                to: guardianEmail,
                subject: `Update on your application — ${branding?.name ?? 'your school'}`,
                text: message,
              });
              notified = true;
            }
          }
        } catch (error) {
          console.warn(
            `[applications] could not notify the guardian for ${applicationReference(applicationId)}:`,
            error,
          );
        }
      }

      return apiSuccess({
        application: await getApplicationDetail(auth.locationId, applicationId),
        notified,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
