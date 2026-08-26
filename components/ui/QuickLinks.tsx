import Link from 'next/link';

import { NAV_ICONS, type NavIconName } from '@/components/school/nav-icons';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

/**
 * The row of chips at the top of a dashboard.
 *
 * ── Why chips, and why at the top ────────────────────────────────────────
 * The school-admin dashboard's quick actions were a grid of bordered tiles at
 * the *bottom* of the page, below nine charts. On a laptop that is two scrolls
 * away, which means the links most likely to be wanted — invite a member of
 * staff, open settings — were the hardest things on the screen to reach, and
 * the charts they sat under are the part nobody clicks. The product owner asked
 * for them moved up and made chips; both halves of that are right.
 *
 * A chip also stops the row competing with the content. A tile with a title and
 * a description reads as a *destination card*, and eight of them read as the
 * page's main content — which is how they came to be pushed to the bottom in
 * the first place. A chip reads as a shortcut, so a row of eight is a toolbar.
 *
 * ── The descriptions are not lost, they are `title` ──────────────────────
 * Each tile's sentence becomes the chip's tooltip and its accessible name
 * suffix, so a school administrator who does not recognise "Promotions" can
 * still find out what it is without the row costing a third of the screen.
 *
 * ── Never rendered empty ─────────────────────────────────────────────────
 * A caller whose permissions filter every link away gets nothing rather than an
 * empty strip with a heading over it.
 */

export interface QuickLink {
  label: string;
  href: string;
  icon?: NavIconName;
  /** One line. Becomes the tooltip and part of the accessible name. */
  description?: string;
  /** Draws attention — used for the one action a screen most expects. */
  emphasis?: boolean;
}

export interface QuickLinksProps {
  links: readonly QuickLink[];
  /** Names the group for screen readers. Not shown. */
  ariaLabel?: string;
  className?: string;
}

export function QuickLinks({
  links,
  ariaLabel = 'Quick links',
  className,
}: QuickLinksProps) {
  if (links.length === 0) return null;

  return (
    <nav aria-label={ariaLabel} className={cn('flex flex-wrap gap-2', className)}>
      {links.map((link) => (
        <Link
          key={link.href + link.label}
          href={link.href}
          title={link.description}
          aria-label={
            link.description === undefined ? undefined : `${link.label} — ${link.description}`
          }
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium',
            'transition-colors duration-fast',
            link.emphasis
              ? 'border-brand-primary bg-brand-primary text-brand-onPrimary hover:bg-brand-primaryHover'
              : 'border-line bg-surface-raised text-ink hover:border-brand-primary hover:bg-surface-hover',
          )}
        >
          {link.icon === undefined ? null : <Icon as={NAV_ICONS[link.icon]} size="sm" />}
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
