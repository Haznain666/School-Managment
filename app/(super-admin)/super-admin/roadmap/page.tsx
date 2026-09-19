import type { Metadata } from 'next';

import { ProductGuide } from '@/components/super-admin/ProductGuide';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = {
  title: 'Roadmap',
  description: 'What is not built yet, what it does, and who it is for.',
};

/**
 * What is coming, with no date on it.
 *
 * ── No dates, no sprint numbers, no order ────────────────────────────────
 * This product has no release dates and none may be stated or implied — the
 * product owner's standing instruction. A numbered or ordered list is a set of
 * dates as far as the person reading it over somebody's shoulder is concerned,
 * so `ROADMAP_ITEMS` carries the name, what it does and who it is for, and
 * nothing else.
 *
 * ── Five of these already have a switch ──────────────────────────────────
 * `lms`, `event_mgmt`, `transport`, `library` and `hostel` exist in
 * `school_modules` and can be toggled on a school today. The switch is the
 * whole of what exists: there is no screen behind any of them. Those entries
 * say so on the card rather than letting the toggle imply a product.
 *
 * No data of its own, so no `loading.tsx` — and served dynamically anyway,
 * because the group layout is `force-dynamic`. See the Features page for the
 * whole of that reasoning.
 */
export default function PlatformRoadmapPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Roadmap"
        description="What is not built yet. Names, what each one does and who it is for — deliberately without dates or an order, because neither has been committed to."
      />

      <ProductGuide mode="roadmap" />
    </div>
  );
}
