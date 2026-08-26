import type { Metadata } from 'next';

import { SearchResultsView } from '@/components/search/SearchResultsView';
import { PageHeader } from '@/components/ui/PageHeader';
import { searchForPlatform } from '@/lib/portal-search';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

export const metadata: Metadata = {
  title: 'Search',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Platform search results — schools, campuses and the people in them.
 *
 * Cross-tenant, and the only search in the product that takes no `locationId`.
 * That is the surface's whole purpose, and it is why the guard here is
 * `requireSuperAdmin` rather than a school session: there is no tenant to scope
 * by and nothing in the query string could supply one safely.
 *
 * Every hit's subtitle names its school. An operator finding "Ayesha Khan"
 * needs to know which of four schools she works at before anything else about
 * the row matters.
 */
export default async function PlatformSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSuperAdmin();

  const { q } = await searchParams;
  const query = q ?? '';

  const results = await searchForPlatform(query);

  return (
    <div className="space-y-5">
      <PageHeader
        title={query.trim() === '' ? 'Search' : `Results for “${query.trim()}”`}
        description={
          results.total === 0
            ? undefined
            : `${results.total} result${results.total === 1 ? '' : 's'} across every school`
        }
      />

      <SearchResultsView results={results} rawQuery={query} action="/super-admin/search" />
    </div>
  );
}
