import type { Metadata } from 'next';

import { FeedbackListing } from '@/components/super-admin/FeedbackListing';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  getFeedbackSectionCounts,
  listFeedbackSchools,
  listPlatformFeedback,
} from '@/lib/feedback-queries';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

export const metadata: Metadata = {
  title: 'Feedback',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Every school's feedback, in one queue.
 *
 * ── Cross-tenant, and behind the platform guard for that reason ──────────
 * `listPlatformFeedback` takes no `locationId`. That is the one query in the
 * product with no tenant filter, and the guard above it is `requireSuperAdmin`
 * rather than a school session — there is no tenant in a platform session to
 * scope by, and nothing in the request could supply one safely.
 *
 * ── The first page is rendered on the server ─────────────────────────────
 * The listing is a client component because filtering, sorting and paging are
 * interactive, but its first page arrives as HTML rather than as a loading
 * state followed by a fetch. On a deployment whose edge→origin hop is ~1s
 * (§5aq) that is the difference between a queue and a wait.
 */
export default async function PlatformFeedbackPage() {
  await requireSuperAdmin();

  const [page, counts, schools] = await Promise.all([
    listPlatformFeedback({
      // The default view is Active: everything nobody has decided about, read
      // or not. That is where the work is.
      section: 'active',
      nature: null,
      status: null,
      locationId: null,
      search: '',
      sort: 'createdAt',
      direction: 'desc',
      page: 1,
      limit: 25,
    }),
    getFeedbackSectionCounts(),
    listFeedbackSchools(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Feedback"
        description="What schools have told us. Bugs are marked; changing a status emails the school."
      />

      <FeedbackListing
        initialRows={page.rows}
        initialTotal={page.total}
        initialCounts={counts}
        schools={schools}
      />
    </div>
  );
}
