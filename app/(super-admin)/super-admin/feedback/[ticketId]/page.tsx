import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AttachmentList } from '@/components/feedback/AttachmentList';
import { FeedbackThread } from '@/components/feedback/FeedbackThread';
import { FeedbackDecision } from '@/components/super-admin/FeedbackDecision';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { FEEDBACK_NATURE_LABELS, FEEDBACK_STATUS_LABELS } from '@/db/schema';
import { natureBadgeVariant, statusBadgeVariant } from '@/lib/feedback';
import { getFeedbackTicket, markFeedbackRead } from '@/lib/feedback-queries';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Feedback',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One ticket, from the platform side.
 *
 * ── Opening it marks it read, and that write is a claim ──────────────────
 * `markFeedbackRead` is a conditional `UPDATE … WHERE status = 'unread'
 * RETURNING`, not a read followed by an `if`. That is CLAUDE.md's rule for
 * background work applied to a different actor with the same shape of race: a
 * double-clicked link, or the same ticket open in two tabs, issues the
 * statement twice. Postgres decides it on one row under one lock, so the "first
 * read" timestamp is the first read rather than the last.
 *
 * It runs *before* the ticket is fetched, so the page renders the status it has
 * just set rather than the one from a moment earlier — which would show
 * "Unread" on a screen that had, by then, been read.
 *
 * ── No notification to the school on read ────────────────────────────────
 * Deliberately. "Somebody opened your message" is not news, and a school that
 * received an email for it would learn to ignore the ones that follow, which
 * are the decisions.
 */
export default async function PlatformFeedbackDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  await requireSuperAdmin();

  const { ticketId } = await params;
  if (!isUuid(ticketId)) notFound();

  await markFeedbackRead(ticketId);

  const ticket = await getFeedbackTicket(ticketId);
  if (ticket === null) notFound();

  return (
    <div className="space-y-5">
      <PageHeader
        title={ticket.title}
        description={`${ticket.schoolName} · ${ticket.submittedByName}${
          ticket.submittedByEmail === '' ? '' : ` <${ticket.submittedByEmail}>`
        } · ${ticket.createdAt.toLocaleString()}`}
        breadcrumbs={[
          { label: 'Feedback', href: '/super-admin/feedback' },
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
          <Card header={<CardTitle title="The message" />}>
            <p className="whitespace-pre-wrap text-sm text-ink">{ticket.body}</p>
          </Card>

          <Card
            header={
              <CardTitle
                title="Conversation"
                description="A reply emails the school and appears in their portal."
              />
            }
          >
            <FeedbackThread
              replies={ticket.replies}
              endpoint={`/api/super-admin/feedback/${ticket.id}/replies`}
              viewer="super_admin"
            />
          </Card>
        </div>

        <div className="space-y-5">
          <Card header={<CardTitle title="Status" />}>
            <FeedbackDecision
              ticketId={ticket.id}
              status={ticket.status}
              attachmentCount={ticket.attachments.length}
              replyCount={ticket.replies.length}
            />
          </Card>

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
              downloadBase="/api/super-admin/feedback/attachments"
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
