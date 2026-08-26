'use client';

import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { PortalNavList, type PortalNavItem, type PortalNavSection } from '@/components/school/PortalSidebar';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

/**
 * The frame every portal renders inside: sidebar, header slot, content.
 *
 * ── The defect this exists to fix ────────────────────────────────────────
 * `PortalSidebar` was `hidden … md:flex`. Below 768px it did not render at all,
 * and nothing replaced it — so on a phone the school-admin, teacher, student
 * and parent portals had **no navigation whatsoever**. Once you were on a page
 * the only way to another was the browser's back button. That is worst for
 * exactly the two audiences most likely to be on a phone and least likely to
 * have a desktop at all: parents and students.
 *
 * So the same navigation now renders twice from one definition — inline on
 * desktop, and in a drawer behind a button on mobile. One definition, because
 * two would drift, and a nav item that exists on one form factor and not the
 * other is worse than either.
 *
 * ── Why the frame owns the state ─────────────────────────────────────────
 * The button that opens the drawer lives in the header, and the drawer lives
 * beside the sidebar. Those are siblings, so the open state has to sit above
 * both. The header is composed on the server (it needs the school's branding
 * and the caller's profile), so it is passed in as a rendered node and the
 * trigger reaches the state through context — `SidebarToggle` below. A server
 * component's output can be a child of a client provider; that is what makes
 * this arrangement legal.
 */

interface SidebarContextValue {
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  collapsed: boolean;
  toggleCollapsed: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

/** Where the desktop collapse preference is remembered. */
const COLLAPSE_KEY = 'sms:sidebar-collapsed';

export interface PortalFrameProps {
  items: readonly PortalNavItem[];
  sections?: readonly PortalNavSection[];
  ariaLabel: string;
  /** The portal's top bar, rendered on the server. */
  header: ReactNode;
  /** Shown at the top of the mobile drawer, so it is clear which portal it is. */
  drawerTitle: string;
  children: ReactNode;
}

export function PortalFrame({
  items,
  sections,
  ariaLabel,
  header,
  drawerTitle,
  children,
}: PortalFrameProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const drawerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  /*
   * The stored preference is read after mount rather than during render.
   * Reading localStorage while rendering would produce different markup on the
   * server than in the browser, and React would discard the whole tree with a
   * hydration error — for a preference the user cannot even see until they set
   * it.
   */
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // Private browsing, or storage disabled. The default is fine.
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Not worth surfacing: the collapse still works for this session.
      }
      return next;
    });
  }, []);

  /*
   * Navigating closes the drawer. Without this, tapping a link on a phone
   * navigates *behind* a drawer that stays open over the page you asked for,
   * which reads as the tap having done nothing.
   */
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Escape closes it, and the page beneath must not scroll while it is open.
  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  // Move focus into the drawer when it opens, so a keyboard or screen-reader
  // user is taken to the navigation they just asked for rather than left
  // behind it.
  useEffect(() => {
    if (drawerOpen) drawerRef.current?.focus();
  }, [drawerOpen]);

  return (
    <SidebarContext.Provider value={{ drawerOpen, setDrawerOpen, collapsed, toggleCollapsed }}>
      {/*
        `h-dvh`, not `h-screen`. On mobile Safari `100vh` is the viewport with
        the browser chrome *hidden*, so a full-height shell is taller than what
        is actually visible and the bottom of every page sits under the address
        bar.
      */}
      <div className="flex h-dvh overflow-hidden">
        {/* Skip link: the first stop for a keyboard user, past 30 nav items. */}
        <a
          href="#portal-main"
          onClick={(event) => {
            event.preventDefault();
            mainRef.current?.focus();
          }}
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-toast focus:rounded-control focus:bg-brand-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-onPrimary"
        >
          Skip to content
        </a>

        <nav
          aria-label={ariaLabel}
          className={cn(
            'hidden shrink-0 flex-col bg-brand-secondary transition-[width] duration-slow ease-out-quart md:flex',
            collapsed ? 'w-16' : 'w-60',
          )}
        >
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-3">
            <PortalNavList items={items} sections={sections} collapsed={collapsed} />
          </div>

          <div className="border-t border-[rgb(var(--brand-on-secondary)/0.12)] p-2">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              className={cn(
                'flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-sm font-medium',
                'text-brand-onSecondary/70 transition-colors duration-fast',
                'hover:bg-[rgb(var(--brand-on-secondary)/0.10)] hover:text-brand-onSecondary',
                collapsed && 'justify-center',
              )}
            >
              <Icon
                as={collapsed ? PanelLeftOpen : PanelLeftClose}
                size="sm"
                label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              />
              {collapsed ? null : <span>Collapse</span>}
            </button>
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          {header}

          <main
            id="portal-main"
            ref={mainRef}
            // `tabIndex={-1}` makes the skip link's target focusable without
            // putting the whole content region into the tab order.
            tabIndex={-1}
            /*
              ── `relative` is the fix for the second scrollbar, and it is not
                 cosmetic ────────────────────────────────────────────────────
              Every portal screen had **two** vertical scrollbars: this one, and
              one on the document behind it that scrolled a blank strip. Measured
              on 2026-08-26 at 1280x720 on the platform dashboard:
              `innerWidth - documentElement.clientWidth` was **15** — a real root
              scrollbar — and `documentElement.scrollHeight` was **1185** against
              a 720px viewport, on a page whose every `<body>` child measured 720.

              The cause is `sr-only`. Tailwind implements it as `position:
              absolute`, and an absolutely positioned element is clipped by an
              ancestor's `overflow` **only when that ancestor is its containing
              block** — which means a positioned one. Nothing between these
              spans and `<html>` was positioned, so their containing block was
              the initial containing block: they escaped this element's
              `overflow-y: auto` entirely and extended the *root's* scrollable
              overflow to wherever they happened to sit.

              The bottom-most one on that page — the hidden `<figcaption>`
              summarising the schools-by-city chart — sat at document y = 1185,
              which is `scrollHeight` exactly.

              So the outer scrollbar was made of accessibility text, it scrolled
              a region with nothing painted in it, and it grew with the length of
              the page. `position: relative` makes this element the containing
              block for all of them, and the `overflow` above finally applies.
              Verified in the browser: root scrollbar 15 -> 0, root max scroll
              465 -> 0, and this element keeps its own.

              Do not remove it to "clean up". There is no visual change to see.
            */
            className="relative flex-1 overflow-y-auto p-4 focus-visible:outline-none sm:p-6"
          >
            {children}
          </main>
        </div>

        {/* ── Mobile drawer ────────────────────────────────────────────── */}
        {drawerOpen ? (
          <div className="md:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-backdrop cursor-default bg-[rgb(2_6_23/0.55)] animate-fade-in"
            />

            <div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel}
              tabIndex={-1}
              className="fixed inset-y-0 left-0 z-modal flex w-72 max-w-[85vw] flex-col bg-brand-secondary shadow-modal focus-visible:outline-none animate-slide-up"
            >
              <div className="flex items-center justify-between gap-2 border-b border-[rgb(var(--brand-on-secondary)/0.12)] px-4 py-3">
                <p className="truncate text-sm font-semibold text-brand-onSecondary">
                  {drawerTitle}
                </p>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="-mr-1 rounded-control p-1.5 text-brand-onSecondary/70 transition-colors duration-fast hover:bg-[rgb(var(--brand-on-secondary)/0.10)] hover:text-brand-onSecondary"
                >
                  <Icon as={X} size="sm" label="Close navigation" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                <PortalNavList items={items} sections={sections} collapsed={false} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </SidebarContext.Provider>
  );
}

/**
 * The hamburger. Rendered inside the portal's own header, which is a server
 * component — it reaches the frame's state through context rather than props.
 *
 * Hidden from `md` up, where the sidebar is always present.
 */
export function SidebarToggle() {
  const context = useContext(SidebarContext);
  if (context === null) return null;

  return (
    <button
      type="button"
      onClick={() => context.setDrawerOpen(true)}
      aria-expanded={context.drawerOpen}
      aria-controls="portal-main"
      className="-ml-1 rounded-control p-2 text-current transition-colors duration-fast hover:bg-[rgb(var(--brand-on-primary)/0.15)] md:hidden"
    >
      <MenuGlyph />
      <span className="sr-only">Open navigation</span>
    </button>
  );
}

/**
 * Drawn rather than imported.
 *
 * `SidebarToggle` is rendered by server components, and pulling the whole icon
 * module into that boundary for one three-line glyph is not worth it. It
 * inherits `currentColor` exactly as `Icon` would.
 */
function MenuGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
