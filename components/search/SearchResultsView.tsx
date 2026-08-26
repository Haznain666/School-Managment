import { Search, SearchX } from 'lucide-react';
import Link from 'next/link';

import { NAV_ICONS, type NavIconName } from '@/components/school/nav-icons';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { MIN_QUERY_LENGTH, type SearchResults } from '@/lib/search-types';

/**
 * The results page's body, shared by all five portals.
 *
 * A server component with no state: the page it sits on has already run the
 * search, so there is nothing here to fetch and nothing to hydrate. That is
 * what keeps a results screen off the ~1s client round trip on a deployment
 * whose edge→origin hop is the dominant cost (§5aq).
 *
 * ── Grouped by category, and every hit names its screen ──────────────────
 * The product owner's requirement, and it is also what every CRM worth copying
 * does. A flat list of forty rows sorted by relevance is a list nobody scans; a
 * short list per category, each row saying which screen it lives on, is one
 * somebody reads in a second. The category headings carry the same glyph the
 * sidebar uses for that destination, so the eye finds "Students" without
 * reading the word.
 *
 * ── Three empty states, not one ──────────────────────────────────────────
 * "Type something", "keep typing" and "nothing matched" are three different
 * facts and the reader can act on each of them differently. Collapsing them
 * into "No results" tells somebody who typed one letter that their student does
 * not exist.
 */

export interface SearchResultsViewProps {
  results: SearchResults;
  /** The raw text from the URL, which may be shorter than the minimum. */
  rawQuery: string;
  /** This page's own path, for the search box below the heading. */
  action: string;
}

export function SearchResultsView({ results, rawQuery, action }: SearchResultsViewProps) {
  const trimmed = rawQuery.trim();

  return (
    <div className="space-y-5">
      <SearchAgainForm action={action} value={rawQuery} />
      <ResultsBody results={results} trimmed={trimmed} />
    </div>
  );
}

/**
 * A plain GET form, with no client JavaScript behind it.
 *
 * The header's `GlobalSearch` is a combobox and needs to be; this is the box a
 * phone lands on, where the header shows only an icon. Written as a `<form
 * method="get">` so it works before hydration and without JavaScript at all —
 * which is not a purity argument: this deployment serves parents on Pakistani
 * mobile networks, and a search box that needs a bundle to submit is a search
 * box that does nothing for the first second.
 */
function SearchAgainForm({ action, value }: { action: string; value: string }) {
  return (
    <form method="get" action={action} role="search" className="relative max-w-xl">
      <label htmlFor="global-search-again" className="sr-only">
        Search
      </label>

      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
      >
        <Icon as={Search} size="sm" />
      </span>

      <input
        id="global-search-again"
        type="search"
        name="q"
        defaultValue={value}
        placeholder="Search…"
        autoComplete="off"
        className="w-full rounded-control border border-line-strong bg-surface-raised py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted focus:border-brand-primary focus:outline-none"
      />
    </form>
  );
}

function ResultsBody({
  results,
  trimmed,
}: {
  results: SearchResults;
  trimmed: string;
}) {
  if (trimmed === '') {
    return (
      <EmptyState
        icon={SearchX}
        tone="empty"
        title="Search this portal"
        description="Names, numbers, classes and screens. Press / anywhere to come back here."
      />
    );
  }

  if (trimmed.length < MIN_QUERY_LENGTH) {
    return (
      <EmptyState
        icon={SearchX}
        tone="no-result"
        title="Keep typing"
        description={`Searching needs at least ${MIN_QUERY_LENGTH} characters — one letter matches most of a school.`}
      />
    );
  }

  if (results.groups.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        tone="no-result"
        title={`Nothing matches “${trimmed}”`}
        description="Check the spelling, or try part of a name, an admission number or a challan number."
      />
    );
  }

  return (
    <div className="space-y-5">
      {results.groups.map((group) => {
        const glyph = NAV_ICONS[group.icon as NavIconName] ?? NAV_ICONS.dashboard;

        return (
          <Card
            key={group.key}
            header={
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <Icon as={glyph} size="md" className="text-ink-muted" />
                  <CardTitle
                    title={group.label}
                    description={
                      /*
                       * Truncation is stated, never silent. A search that
                       * quietly drops results is worse than one that finds
                       * nothing: the reader concludes the record is not there.
                       */
                      group.truncated
                        ? `Showing the first ${group.hits.length}. There are more.`
                        : `${group.hits.length} result${group.hits.length === 1 ? '' : 's'}`
                    }
                  />
                </span>

                {group.moreHref === undefined ? null : (
                  <Link
                    href={group.moreHref}
                    className="text-sm font-medium text-brand-primaryInk hover:underline"
                  >
                    Open {group.label.toLowerCase()}
                  </Link>
                )}
              </div>
            }
            className="[&>div:last-child]:p-0"
          >
            <ul className="divide-y divide-line">
              {group.hits.map((hit) => (
                <li key={hit.key}>
                  <Link
                    href={hit.href}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3 transition-colors duration-fast hover:bg-surface-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium text-ink">{hit.title}</span>
                        {hit.badge === undefined ? null : (
                          <Badge variant="neutral">{hit.badge}</Badge>
                        )}
                      </span>
                      {hit.subtitle === null ? null : (
                        <span className="mt-0.5 block text-sm text-ink-muted">
                          {hit.subtitle}
                        </span>
                      )}
                    </span>

                    {/*
                      Which screen this opens. The requirement asked for it by
                      name, and it is the difference between a list of matches
                      and a list of answers.
                    */}
                    <span className="shrink-0 text-xs text-ink-faint">{hit.page}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
