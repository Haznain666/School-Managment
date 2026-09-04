import type { ReactNode } from 'react';

import Link from 'next/link';
import { Search } from 'lucide-react';

import { LogoutButton } from '@/components/school/LogoutButton';
import { SidebarToggle } from '@/components/school/PortalFrame';
import { GlobalSearch } from '@/components/ui/GlobalSearch';
import { Icon } from '@/components/ui/Icon';
import { NotificationBell } from '@/components/ui/NotificationBell';
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
  /**
   * Where this portal's search results live — `/dashboard/search`,
   * `/teacher/search`, and so on.
   *
   * Passed in rather than derived from the role, because the role is already a
   * prop and deriving it here would be a second place that knows the route map.
   * Omitting it hides the box, which is what the login and setup screens want.
   */
  searchResultsHref?: string;
  /** Unread notifications, read once in the layout. */
  unreadNotifications?: number;
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
  searchResultsHref,
  unreadNotifications,
}: SchoolNavbarProps) {
  const isPlatformSession = platformAdminEmail !== null && platformAdminEmail !== '';

  return (
    /*
      ── Sprint 26: what changes below `sm`, and why ─────────────────────────
      Reported as "the header is all cluttered" with a 375px screenshot: the
      child switcher's text ran under the search icon and the bell. It was not a
      wrapping bug. Nine things were competing for 375 pixels on one 64px row —
      menu, logo, school name, portal label, child switcher, search, bell, role
      chip, sign out — and the two that carry live state (which school, which
      child) are the two that lost, because they are the only two that are text.

      So on a phone the row now carries the menu, the logo, whichever context
      the portal put in the slot, and the three controls. `gap-2` instead of
      `gap-4`, and the three things that are duplicated elsewhere come off:

        · the school name  — the logo is beside it and the drawer's title
                             repeats it in full;
        · the portal label — the sidebar it opens is the parent portal;
        · the role chip    — it says "Parent" next to a portal called Parent.

      They all return at `sm`. Nothing is removed from the product; three
      redundant labels stop crowding out the one piece of state a parent
      actually navigates by.
    */
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 bg-brand-primary px-4 text-brand-onPrimary sm:gap-4 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
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

        {/*
          Hidden below `sm` only when the portal put something in the slot. A
          portal with nothing there — teacher, pupil, administrator — keeps its
          school name on a phone, because otherwise the header would be a logo
          and three icons and say nothing at all.
        */}
        <div className={contextSlot === undefined ? 'min-w-0' : 'hidden min-w-0 sm:block'}>
          <p className="truncate text-sm font-semibold">{schoolName}</p>
          {portalLabel !== undefined ? (
            <p className="truncate text-xs opacity-75">{portalLabel}</p>
          ) : null}
        </div>

        {contextSlot}
      </div>

      {/*
        The search box sits in the middle of the bar on anything wider than a
        phone, and moves under it on a phone — a 375px header cannot carry a
        school name, a search field and a sign-out control on one line, and the
        control that loses is the one people use least.

        `max-w-md` rather than a fixed width: on a 1440px screen a full-width
        search box reads as a form the page is asking you to fill in.
      */}
      {searchResultsHref === undefined ? null : (
        /*
          `min-w-[16rem]` is load-bearing. Without it the box is whatever is left
          after the two groups either side, and QA measured that at **165px** on
          a 1280px screen for a platform-operator session — narrow enough that
          the placeholder was cut off mid-word and the box read as decoration.
          A floor plus a ceiling means it is always a usable field and never a
          form the page appears to be asking you to fill in.
        */
        <div className="hidden min-w-[16rem] flex-1 justify-center px-2 md:flex">
          <GlobalSearch
            endpoint="/api/school/search"
            resultsHref={searchResultsHref}
            placeholder="Search students, staff, vouchers…  /"
            tone="brand"
            className="w-full max-w-md"
          />
        </div>
      )}

      {/*
        `min-w-0` so this group yields to the search box rather than pinning it:
        the email inside truncates, and truncating an address is a smaller loss
        than a search field nobody can type into.
      */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {/*
          The phone's way in. The dropdown needs a 20rem panel and there is no
          room for it beside a school name at 375px, so below `md` the control
          is a link straight to the results page, which owns its own search box.
          A feature that exists only on desktop is a feature parents and
          students do not have.
        */}
        {searchResultsHref === undefined ? null : (
          <Link
            href={searchResultsHref}
            className="rounded-control p-2 text-brand-onPrimary transition-colors duration-fast hover:bg-brand-onPrimary/15 md:hidden"
          >
            <Icon as={Search} size="md" label="Search" />
          </Link>
        )}

        {unreadNotifications === undefined ? null : (
          <NotificationBell
            endpoint="/api/school/notifications"
            initialUnread={unreadNotifications}
            tone="brand"
          />
        )}

        {isPlatformSession ? (
          <span className="rounded-full bg-brand-onPrimary/20 px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-current">
            Platform Super Admin
          </span>
        ) : null}
        {/*
          The platform-operator chip above stays at every width — it is a
          safety signal and the one thing nobody may miss. This one is an
          ordinary label and duplicates the portal name, so it waits for room.
        */}
        <span className="hidden rounded-full bg-brand-onPrimary/10 px-2 py-0.5 text-xs font-medium sm:inline-block">
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
