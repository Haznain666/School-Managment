import { notFound } from 'next/navigation';
import { Plus } from 'lucide-react';

import { PortalFrame } from '@/components/school/PortalFrame';
import { SchoolNavbar } from '@/components/school/SchoolNavbar';
import { schoolNav } from '@/components/school/school-nav';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { paletteToCSSVars } from '@/lib/branding';
import { PERMISSIONS } from '@/lib/permissions';
import { PALETTE_PRESETS } from '@/lib/palette-presets';
import { emptyModuleFlags, type SchoolModuleFlags } from '@/lib/platform-modules';
import type { CSSProperties } from 'react';

/**
 * The application shell, rendered outside a session.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * The shell is the one part of the product that cannot be checked from the main
 * workbench page, because it *is* the page — sidebar, drawer, header and
 * content region together. And it cannot be checked in situ either: every
 * portal is behind a session and a tenant, and sign-in has never worked from a
 * development machine (STATE.md §5d item 2).
 *
 * So the real `PortalFrame`, the real `SchoolNavbar` and the real
 * `schoolNav()` are assembled here against a fixture, with every permission
 * granted and every module on so the widest possible sidebar is exercised. If
 * the drawer opens here it opens in the portal, because it is the same code.
 *
 * 404s outside development, like the page it sits under.
 */

export const metadata = { title: 'Design system · Shell' };

/**
 * Every module on, so the sidebar renders at its longest.
 *
 * Built by flipping `emptyModuleFlags()` rather than by listing the keys, so a
 * module added in a later sprint is exercised here automatically instead of
 * being silently missing from the widest case this page exists to show.
 */
const ALL_MODULES: SchoolModuleFlags = Object.fromEntries(
  Object.keys(emptyModuleFlags()).map((key) => [key, true]),
) as SchoolModuleFlags;

export default function ShellPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  const { items, sections } = schoolNav({
    role: 'school_admin',
    permissions: PERMISSIONS,
    moduleFlags: ALL_MODULES,
  });

  // Crimson & Gold rather than the default: a preset makes it obvious at a
  // glance whether the shell is actually consuming the palette.
  const palette = PALETTE_PRESETS[0]!.palette;
  const brandStyle = paletteToCSSVars(palette) as unknown as CSSProperties;

  return (
    <div style={brandStyle} className="bg-brand-background text-brand-text">
      <PortalFrame
        items={items}
        sections={sections}
        ariaLabel="School administration navigation"
        drawerTitle="Roshan Hills Academy"
        header={
          <SchoolNavbar
            schoolName="Roshan Hills Academy"
            logoUrl={null}
            userName="Ayesha Siddiqui"
            role="school_admin"
            schoolSlug="roshan-hills"
          />
        }
      >
        <PageHeader
          title="Fee vouchers"
          description="Issued vouchers for the current term, across every campus."
          breadcrumbs={[
            { label: 'Dashboard', href: '#' },
            { label: 'Fees', href: '#' },
            { label: 'Vouchers' },
          ]}
          actions={
            <>
              <Button variant="secondary" size="sm">
                Export CSV
              </Button>
              <Button size="sm" icon={Plus}>
                Issue voucher
              </Button>
            </>
          }
        />

        <Card header={<CardTitle title="Shell check" description="What to look at on this page" />}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-muted">
            <li>Every sidebar item and section heading carries an icon.</li>
            <li>
              <strong className="font-medium text-ink">Collapse</strong> at the foot of the
              sidebar narrows it to icons and remembers the choice across reloads.
            </li>
            <li>
              Below 768px the sidebar is replaced by the hamburger in the header — this is
              the navigation that did not exist at all before.
            </li>
            <li>Tab from the top: the first stop is a &ldquo;Skip to content&rdquo; link.</li>
            <li>The active item has both a tint and a marker on its leading edge.</li>
          </ul>
        </Card>
      </PortalFrame>
    </div>
  );
}
