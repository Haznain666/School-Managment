import type { Metadata } from 'next';
import Link from 'next/link';
import { MessageSquareText } from 'lucide-react';

import { SchoolFeedbackTable } from '@/components/feedback/SchoolFeedbackTable';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { listSchoolFeedback } from '@/lib/feedback-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Feedback',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * What this school has told us, and what we said back.
 *
 * ── Not gated on a permission ────────────────────────────────────────────
 * Every other screen in this portal is behind the read permission its own
 * route enforces. This one is behind the portal's role list alone, because a
 * `feedback.read` toggle is a switch no administrator has a reason to move and
 * the only thing it could do is stop somebody reporting a bug. It is the same
 * judgement `/dashboard/settings` and `/dashboard/branches` already make.
 *
 * ── The list is this school's, and the tenant comes from the session ─────
 * `listSchoolFeedback` takes a `locationId` it cannot do without, so there is
 * no shape of this call that reads another school's tickets.
 */
export default async function FeedbackPage() {
  const { locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);

  const tickets = await listSchoolFeedback(locationId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Feedback"
        description="Tell us about a bug, or ask for something. We reply here and by email."
        actions={
          <Link href="/dashboard/feedback/new">
            <Button icon={MessageSquareText}>Send feedback</Button>
          </Link>
        }
      />

      <SchoolFeedbackTable rows={tickets} />
    </div>
  );
}
