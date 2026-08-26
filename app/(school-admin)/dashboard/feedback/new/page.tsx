import type { Metadata } from 'next';

import { FeedbackForm } from '@/components/feedback/FeedbackForm';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Send feedback',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The form.
 *
 * `force-dynamic` and an `await` on the guard, so this carries a loader like
 * every other route — the guard is a session verification and a database read,
 * and it is the wait between the click and this form appearing.
 */
export default async function NewFeedbackPage() {
  await requireSchoolRole(ADMIN_PORTAL_ROLES);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Send feedback"
        description="This goes straight to the people who build this product."
        breadcrumbs={[
          { label: 'Feedback', href: '/dashboard/feedback' },
          { label: 'Send feedback' },
        ]}
      />

      <Card className="max-w-3xl">
        <FeedbackForm listHref="/dashboard/feedback" />
      </Card>
    </div>
  );
}
