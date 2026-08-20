import type { ReactNode } from 'react';

import { LogoutButton } from '@/components/school/LogoutButton';
import { SidebarToggle } from '@/components/school/PortalFrame';
import { ROLE_LABELS, type UserRole } from '@/types/school-auth';

export interface SchoolNavbarProps {
  schoolName: string;
  logoUrl: string | null;
  /** Portal label shown beside the school name, e.g. "Teacher Portal". */
  portalLabel?: string;
  userName: string;
  role: UserRole;
  schoolSlug: string | null;
  /**
   * Set when the platform operator is inside a customer's portal. They hold
   * ordinary school_admin rights; this only makes that visible, so nobody —
   * including the operator — mistakes the session for a member of the school.
   */
  platformAdminEmail?: string | null;
  /**
   * Portal-specific context shown beside the school name.
   *
   * The parent portal puts its child switcher here — which child is being read
   * is the most important piece of state in that portal, and the header is the
   * one place on every screen where it can always be seen. No other portal has
   * anything to put here, which is why this is a slot rather than a prop for
   * one feature.
   */
  contextSlot?: ReactNode;
}

/**
 * Top bar shared by every school portal.
 *
 * Painted in the palette's `primary`, as `PalettePreview` has always drawn it.
 * The lettering is `onPrimary` — computed from that colour rather than assumed
 * white — and the two badges are drawn as tints of the foreground so they read
 * on a light primary as well as a dark one, which the fixed amber and slate
 * chips of the shared `Badge` would not.
 */
export function SchoolNavbar({
  schoolName,
  logoUrl,
  portalLabel,
  userName,
  role,
  schoolSlug,
  platformAdminEmail = null,
  contextSlot,
}: SchoolNavbarProps) {
  const isPlatformSession = platformAdminEmail !== null && platformAdminEmail !== '';

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 bg-brand-primary px-4 text-brand-onPrimary sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {/*
          The only way to the navigation below 768px, where the sidebar does not
          render. It reaches `PortalFrame`'s state through context rather than a
          prop, because this header is composed on the server.
        */}
        <SidebarToggle />

        {logoUrl !== null && logoUrl !== '' ? (
          // School logos arrive at unpredictable dimensions; a plain <img>
          // avoids forcing a size onto them.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="h-9 w-9 rounded-md object-contain"
            loading="lazy"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-onPrimary/15 text-sm font-semibold text-brand-onPrimary"
          >
            {schoolName.slice(0, 2).toUpperCase()}
          </span>
        )}

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{schoolName}</p>
          {portalLabel !== undefined ? (
            <p className="text-xs opacity-75">{portalLabel}</p>
          ) : null}
        </div>

        {contextSlot}
      </div>

      <div className="flex items-center gap-3">
        {isPlatformSession ? (
          <span className="rounded-full bg-brand-onPrimary/20 px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-current">
            Platform Super Admin
          </span>
        ) : null}
        <span className="rounded-full bg-brand-onPrimary/10 px-2 py-0.5 text-xs font-medium">
          {ROLE_LABELS[role]}
        </span>
        <span className="hidden truncate text-sm opacity-90 sm:inline">
          {isPlatformSession ? platformAdminEmail : userName}
        </span>
        <LogoutButton schoolSlug={schoolSlug} />
      </div>
    </header>
  );
}
