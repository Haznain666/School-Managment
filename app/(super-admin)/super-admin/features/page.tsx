import type { Metadata } from 'next';

import { ProductGuide } from '@/components/super-admin/ProductGuide';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Everything this platform does today, by pillar, with the roles that reach each part.',
};

/**
 * What the product does, today.
 *
 * ── Prerendered, and therefore without a `loading.tsx` ───────────────────
 * There is no query here, no tenant and no session: the whole page is
 * `lib/product-catalogue.ts`, which is static TypeScript. So this segment gets
 * **no** `loading.tsx` — `npm run check-loaders` runs in both directions, and
 * a skeleton in front of content that had already arrived is a flash of fake
 * layout rather than a loader. `CLAUDE.md` says why at length.
 *
 * ── Which is also why the filters live in the hash ───────────────────────
 * `ProductGuide` keeps its search, pillar and role filters in the URL hash.
 * Reading a `searchParams` here instead would opt this page out of
 * prerendering and cost roughly a second per request, for a screen that has
 * nothing per-request in it.
 *
 * ── Nothing is on this page that is not in the code ──────────────────────
 * Every entry names the routes, the module flag or the permission keys it
 * rests on, and the per-role matrix is derived from `DEFAULT_ROLE_PERMISSIONS`
 * rather than written down. The five module flags with no screen behind them —
 * LMS, Events, Transport, Library, Hostel — are on the Roadmap tab, because a
 * Features tab that lists Library as shipped is one that loses a deal in the
 * room.
 */
export default function PlatformFeaturesPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Features"
        description="What the platform does today, grouped into three pillars plus the operator-only surface. Each entry says which module switches it on, which permissions gate it, and what every role can reach by default."
      />

      <ProductGuide mode="features" />
    </div>
  );
}
