import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AttachmentList } from '@/components/feedback/AttachmentList';
import { FeedbackThread } from '@/components/feedback/FeedbackThread';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { FEEDBACK_NATURE_LABELS, FEEDBACK_STATUS_LABELS } from '@/db/schema';
import { natureBadgeVariant, statusBadgeVariant } from '@/lib/feedback';
import { getFeedbackTicket } from '@/lib/feedback-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Feedback',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One of this school's own tickets, with the conversation on it.
 *
 * ── The tenant is passed, and that is the whole guard ────────────────────
 * `getFeedbackTicket(id, locationId)` resolves to null for a ticket belonging
 * to another school, so a link forwarded between two schools' administrators is
 * a 404 rather than somebody else's bug report. The platform route calls the
 * same function *without* a tenant, which is the one difference between the two
 * callers and is why the parameter is not optional by accident.
 *
 * ── Opening this does not mark anything read ─────────────────────────────
 * "Read" on a ticket means *we* have read it. A school opening its own message
 * and thereby telling itself the vendor had seen it would be the one lie this
 * screen could tell.
 */
export default async function SchoolFeedbackDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const { ticketId } = await params;

  if (!isUuid(ticketId)) notFound();

  const ticket = await getFeedbackTicket(ticketId, locationId);
  if (ticket === null) notFound();

  return (
    <div className="space-y-5">
      <PageHeader
        title={ticket.title}
        description={`Sent by ${ticket.submittedByName} on ${ticket.createdAt.toLocaleDateString()}`}
        breadcrumbs={[
          { label: 'Feedback', href: '/dashboard/feedback' },
          { label: ticket.title },
        ]}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={natureBadgeVariant(ticket.nature)}>
              {FEEDBACK_NATURE_LABELS[ticket.nature]}
            </Badge>
            <Badge variant={statusBadgeVariant(ticket.status)}>
              {FEEDBACK_STATUS_LABELS[ticket.status]}
            </Badge>
          </span>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-5">
          <Card header={<CardTitle title="What you told us" />}>
            <p className="whitespace-pre-wrap text-sm text-ink">{ticket.body}</p>
          </Card>

          <Card
            header={
              <CardTitle
                title="Conversation"
                description="Replies are emailed to you as well as shown here."
              />
            }
          >
            <FeedbackThread
              replies={ticket.replies}
              endpoint={`/api/school/feedback/${ticket.id}/replies`}
              viewer="school"
            />
          </Card>
        </div>

        <Card
          header={
            <CardTitle
              title="Attachments"
              description={`${ticket.attachments.length} file${ticket.attachments.length === 1 ? '' : 's'}`}
            />
          }
        >
          <AttachmentList
            attachments={ticket.attachments}
            downloadBase="/api/school/feedback/attachments"
          />
        </Card>
      </div>
    </div>
  );
}
