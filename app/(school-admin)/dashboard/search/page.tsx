import type { Metadata } from 'next';

import { SearchResultsView } from '@/components/search/SearchResultsView';
import { PageHeader } from '@/components/ui/PageHeader';
import { searchForSession } from '@/lib/portal-search';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Search',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Administrative portal search results.
 *
 * ── Why the search runs here and not behind a fetch ──────────────────────
 * `searchForSession` is called directly, on the server, with the tenant and
 * role from the verified session. The header dropdown calls the same function
 * through `/api/school/search`; this page skips the round trip, which on a
 * deployment whose edge→origin hop is ~1s (§5aq) is the difference between a
 * results page and a wait.
 *
 * Sharing that one function is what guarantees the dropdown and this page
 * cannot disagree about what this person may see.
 *
 * ── `searchParams` makes this dynamic, and that is correct here ──────────
 * CLAUDE.md's rule is not to reach for `searchParams` casually — it costs a
 * prerender. A results page has nothing to prerender: its entire content is the
 * query. This is the case the rule carves out rather than a breach of it.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const { q } = await searchParams;
  const query = q ?? '';

  const results = await searchForSession(
    // `branchId` is passed rather than applied: `resolveBranchScope` turns it
    // into the campus set, which is more than this one field says once
    // `school_user_branches` has a row in it.
    { locationId, uid: claims.uid, role: claims.role, branchId: claims.branchId },
    query,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={query.trim() === '' ? 'Search' : `Results for “${query.trim()}”`}
        description={
          results.total === 0
            ? undefined
            : `${results.total} result${results.total === 1 ? '' : 's'} across ${results.groups.length} categor${
                results.groups.length === 1 ? 'y' : 'ies'
              }`
        }
      />

      <SearchResultsView results={results} rawQuery={query} action="/dashboard/search" />
    </div>
  );
}
