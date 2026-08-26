import type { PortalNavItem, PortalNavSection } from '@/components/school/PortalSidebar';

import { HITS_PER_GROUP, type SearchGroup, type SearchHit } from './search-types';

/**
 * "Screens" as a search category.
 *
 * ── Why this is not padding ──────────────────────────────────────────────
 * It is the single most-used category in every CRM that ships one, and the
 * reason is the same everywhere: a person who knows the product knows the
 * *word* for what they want ("defaulters", "payslips", "grading") and does not
 * know which of five sidebar groups it was filed under. This turns thirty
 * navigation items into thirty keyboard shortcuts.
 *
 * ── It is built from the caller's own navigation, and that is the guard ──
 * `schoolNav` has already removed every screen this person's permissions and
 * this school's modules do not allow — that is what it is for. Feeding its
 * output in means the page search can never name a screen the guard would
 * bounce, without this module knowing what a permission is. A hardcoded list of
 * routes here would be a second copy of the sidebar, and the copy that goes
 * stale is always the one nobody renders.
 *
 * Placeholders are dropped. A dimmed nav item is a promise, not a destination,
 * and a search result that lands on "this arrives in a later sprint" is the
 * dead end §SuperAdminSidebar removed the Settings link for.
 */

/** Matches a nav item on its own label and on the group it sits in. */
function matches(needle: string, label: string, sectionLabel?: string): boolean {
  const haystack = sectionLabel === undefined ? label : `${sectionLabel} ${label}`;
  return haystack.toLowerCase().includes(needle);
}

function toHit(item: PortalNavItem, sectionLabel?: string): SearchHit {
  return {
    key: `page:${item.href}`,
    title: item.label,
    subtitle: sectionLabel ?? null,
    href: item.href,
    page: 'Screen',
  };
}

export function searchPages(
  query: string,
  items: readonly PortalNavItem[],
  sections: readonly PortalNavSection[] = [],
): SearchGroup | null {
  const needle = query.trim().toLowerCase();
  if (needle === '') return null;

  const hits: SearchHit[] = [];

  for (const item of items) {
    if (item.placeholder === true) continue;
    if (matches(needle, item.label)) hits.push(toHit(item));
  }

  for (const section of sections) {
    for (const item of section.items) {
      if (item.placeholder === true) continue;
      // The section label counts as part of the name, so "fees reports" finds
      // Fees → Reports even though the item is called only "Reports".
      if (matches(needle, item.label, section.label)) hits.push(toHit(item, section.label));
    }
  }

  if (hits.length === 0) return null;

  const truncated = hits.length > HITS_PER_GROUP;

  return {
    key: 'pages',
    label: 'Screens',
    icon: 'dashboard',
    hits: truncated ? hits.slice(0, HITS_PER_GROUP) : hits,
    truncated,
  };
}
