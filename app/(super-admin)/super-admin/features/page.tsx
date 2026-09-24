import type { Metadata } from 'next';

import { ProductGuide } from '@/components/super-admin/ProductGuide';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSuperAdminPage } from '@/lib/super-admin-guard';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Everything this platform does today, by pillar, with the roles that reach each part.',
};

/**
 * What the product does, today.
 *
 * ── Sprint 35: it now has a `loading.tsx`, and why ───────────────────────
 * With more than one super admin, this tab is an area — `catalogue` — that the
 * owner can grant or withhold (§9), and the spec enforces permissions on the
 * page as well as in the sidebar. That is one `await`, and `check-loaders`
 * rightly asks for a loader beside any page with one. It costs no query: the
 * layout above has already resolved the operator through the same
 * request-memoised `readSuperAdminActor`. The paragraph below is the history
 * of why it had none; it stays because the reasoning about static content is
 * still right for everything *under* the guard.
 *
 * ── No data of its own, and therefore no `loading.tsx` ───────────────────
 * There is no query here, no tenant and no session: the whole page is
 * `lib/product-catalogue.ts`, which is static TypeScript. So this segment gets
 * **no** `loading.tsx` — `npm run check-loaders` runs in both directions and
 * reads *this file*, which has no `await` and no `dynamic` export; a skeleton
 * in front of content that had already arrived is a flash of fake layout
 * rather than a loader. `CLAUDE.md` says why at length. The gap between the
 * click and the render is `components/ui/RouteProgress.tsx`, mounted once in
 * the root layout.
 *
 * ⚠ **This page is nonetheless served dynamically, and that is not this
 * file's doing.** `app/(super-admin)/layout.tsx` carries
 * `export const dynamic = 'force-dynamic'` — it reads the operator's session
 * and the unread notification count — and a `force-dynamic` layout makes every
 * route beneath it dynamic. `.next/prerender-manifest.json` lists exactly one
 * prerendered route in this group, `/super-admin/login`. So do not read the
 * paragraph above as a claim about the build output: it is a claim about what
 * *this segment* costs, which is nothing beyond the layout's own read that
 * every Super Admin page already pays.
 *
 * ── Which is still why the filters live in the hash ──────────────────────
 * `ProductGuide` keeps its search, pillar and role filters in the URL hash.
 * A `searchParams` read here would add a per-request input to a screen that
 * has none, and would keep this page dynamic even if the layout above it ever
 * stopped being — which is the direction that file should move, not the one
 * this one should follow it in.
 *
 * ── Nothing is on this page that is not in the code ──────────────────────
 * Every entry names the routes, the module flag or the permission keys it
 * rests on, and the per-role matrix is derived from `DEFAULT_ROLE_PERMISSIONS`
 * rather than written down. The five module flags with no screen behind them —
 * LMS, Events, Transport, Library, Hostel — are on the Roadmap tab, because a
 * Features tab that lists Library as shipped is one that loses a deal in the
 * room.
 */
export default async function PlatformFeaturesPage() {
  await requireSuperAdminPage('catalogue');

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
