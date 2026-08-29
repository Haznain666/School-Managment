'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { NAV_ICONS, type NavIconName } from '@/components/school/nav-icons';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

export interface PortalNavItem {
  label: string;
  href: string;
  /**
   * Which glyph, by destination name. A string rather than the component
   * itself, because these lists are built on the server — see
   * `components/school/nav-icons.ts`.
   */
  icon?: NavIconName;
  /** Not built yet — rendered dimmed and non-interactive. */
  placeholder?: boolean;
  /** A count, e.g. pending applications. Omit rather than passing 0. */
  badge?: number;
}

/** A titled group of links, for a module with several screens of its own. */
export interface PortalNavSection {
  label: string;
  /** The glyph for the group as a whole, shown when the sidebar is collapsed. */
  icon?: NavIconName;
  items: readonly PortalNavItem[];
}

/**
 * The navigation list shared by all four school portals.
 *
 * Which items appear is decided server-side (by role, and by which modules the
 * school has enabled) and passed in — a disabled module is absent from this
 * list entirely rather than hidden with CSS.
 *
 * ── Painted in `secondary`, which is what the preview always promised ────
 * `PalettePreview` has drawn the sidebar in the palette's secondary colour
 * since it was written; the real sidebar was white, and `secondary` reached
 * nothing at all. It is the surface, with `onSecondary` for its lettering and
 * `accent` marking the current page.
 *
 * Both foregrounds are computed from the surface they sit on
 * (`lib/color-contrast.ts`), so this holds up for a school whose secondary is
 * pale as well as for the dark navy default. Opacity does the rest of the
 * hierarchy — a resting link at 75%, a placeholder at 40% — because a tint of
 * the foreground is legible against any surface, where a fixed slate is not.
 *
 * ── Rendered twice, defined once ─────────────────────────────────────────
 * `PortalFrame` renders this inline on desktop and inside a drawer on mobile.
 * Keeping one definition is the point: the sidebar used to vanish entirely
 * below 768px, and the cure for that must not be a second list that drifts.
 *
 * ── The sections collapse, and start closed (Sprint 19a, item 6) ─────────
 * A school administrator's sidebar runs to nine groups and forty-odd links,
 * which is a wall rather than a menu: everything below Fees is off the bottom
 * of a laptop screen, and the reader scrolls a list to find a heading rather
 * than reading headings to find a list.
 *
 * Three rules, and each of them is answering a way this could have gone wrong:
 *
 *  · **Closed by default, but never the section you are in.** A collapsed
 *    sidebar that hides the current page has taken away the one thing a
 *    sidebar is for — saying where you are. The current section is opened
 *    before anything is read from storage, so it is open on the very first
 *    paint and cannot flicker shut.
 *  · **Stored per section, in `localStorage`, inside `try`/`catch`.** A private
 *    window and a browser with storage disabled both throw on the *read*, and
 *    a sidebar is not a feature worth failing a whole portal for.
 *  · **No disclosure in icon-only mode.** Collapsed, the heading is already
 *    replaced by a rule (see below) — there is nothing left to click, and the
 *    items must stay visible or the rail becomes a column of blank space.
 */
export function PortalNavList({
  items,
  sections,
  collapsed = false,
}: {
  items: readonly PortalNavItem[];
  sections?: readonly PortalNavSection[];
  /** Icon-only mode. Labels become tooltips supplied by the browser. */
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  /**
   * Which disclosures the reader has opened, by section label.
   *
   * Absent from the map means "not answered", which is closed — except for the
   * section holding the current route, which `sectionIsOpen` opens regardless.
   * Seeding this from `localStorage` in an initialiser would read storage
   * during the server render, so it starts empty and is filled after mount:
   * the first paint is the same on both sides, and the restore is one frame
   * later on a control nobody is looking at yet.
   */
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SECTION_STORAGE_KEY);
      if (stored === null) return;

      const parsed: unknown = JSON.parse(stored);
      if (typeof parsed !== 'object' || parsed === null) return;

      const restored: Record<string, boolean> = {};
      for (const [label, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'boolean') restored[label] = value;
      }
      setOpened(restored);
    } catch {
      // A private window, a disabled storage quota, or a value somebody edited
      // by hand. All three mean "no preference", which is the default anyway.
    }
  }, []);

  const toggleSection = useCallback((label: string, next: boolean) => {
    setOpened((current) => {
      const updated = { ...current, [label]: next };
      try {
        window.localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // The preference is lost at the end of the session and nothing else is.
      }
      return updated;
    });
  }, []);

  /**
   * Prefix matching, except for the exact link.
   *
   * `/dashboard/admissions` is the parent of every other Admissions route, so
   * matching it by prefix would light up the overview link on every child page.
   * Longer siblings win by being checked against the full path.
   */
  const isCurrent = (href: string): boolean => {
    if (pathname === href) return true;
    if (!pathname.startsWith(`${href}/`)) return false;

    const siblings = [...items, ...(sections ?? []).flatMap((section) => section.items)];
    return !siblings.some(
      (sibling) =>
        sibling.href !== href &&
        sibling.href.startsWith(`${href}/`) &&
        (pathname === sibling.href || pathname.startsWith(`${sibling.href}/`)),
    );
  };

  const renderItem = (item: PortalNavItem) => {
    const glyph = item.icon === undefined ? undefined : NAV_ICONS[item.icon];

    if (item.placeholder === true) {
      return (
        <li key={item.href}>
          <span
            aria-disabled="true"
            title="Coming in a later sprint"
            className={cn(
              'flex cursor-not-allowed items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-medium',
              // 40% until Sprint 10.5, which measured at 2.69:1 — below even the
              // 3:1 floor for a non-text element. WCAG 1.4.3 exempts inactive
              // components from the 4.5 requirement and this is genuinely one,
              // so it stays visibly dimmer than a live link; but "exempt" is not
              // a licence to make it unreadable, and a reader still has to be
              // able to tell what is coming later.
              'text-brand-onSecondary/55',
              collapsed && 'justify-center px-0',
            )}
          >
            {glyph !== undefined ? <Icon as={glyph} size="sm" /> : null}
            {collapsed ? null : <span className="truncate">{item.label}</span>}
          </span>
        </li>
      );
    }

    const isActive = isCurrent(item.href);

    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={isActive ? 'page' : undefined}
          // The label has to survive collapse for a screen reader and for a
          // hover, since the visible text is gone.
          title={collapsed ? item.label : undefined}
          className={cn(
            'group relative flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-medium',
            'transition-colors duration-fast',
            collapsed && 'justify-center px-0',
            isActive
              ? 'bg-[rgb(var(--brand-accent)/0.25)] text-brand-onSecondary'
              : 'text-brand-onSecondary/75 hover:bg-[rgb(var(--brand-on-secondary)/0.10)] hover:text-brand-onSecondary',
          )}
        >
          {/*
            A marker on the leading edge as well as the tint. On a school whose
            accent is close to its secondary the tint alone is nearly invisible,
            and "which page am I on" is the one question a sidebar exists to
            answer. Drawn in the foreground colour, which is contrast-guaranteed
            against this surface where the accent is not.
          */}
          {isActive ? (
            <span
              aria-hidden="true"
              className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-brand-onSecondary"
            />
          ) : null}

          {glyph !== undefined ? <Icon as={glyph} size="sm" /> : null}

          {collapsed ? (
            <span className="sr-only">{item.label}</span>
          ) : (
            <span className="truncate">{item.label}</span>
          )}

          {item.badge !== undefined && item.badge > 0 && !collapsed ? (
            <span className="ml-auto rounded-pill bg-[rgb(var(--brand-on-secondary)/0.18)] px-1.5 py-0.5 font-mono text-2xs tabular-nums">
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          ) : null}
        </Link>
      </li>
    );
  };

  return (
    <>
      {/*
        The flat items — Dashboard, Users, Branches, Communications, Reports,
        Settings, Feedback — are not in a section and do not collapse. They are
        seven links with no heading between them, so there is nothing to
        disclose and hiding them would cost the reader the shortcuts they use
        most.
      */}
      <ul className="space-y-0.5">{items.map(renderItem)}</ul>

      {(sections ?? []).map((section) => {
        const holdsCurrent = section.items.some((item) => isCurrent(item.href));
        // The current section wins over the stored preference, always. See the
        // docblock: a sidebar that hides the page you are on has stopped doing
        // the one job it has.
        const isOpen = collapsed || holdsCurrent || opened[section.label] === true;
        const panelId = `nav-section-${slugifySection(section.label)}`;

        return (
          <div key={section.label} className="mt-5">
            {collapsed ? (
              /*
                Collapsed, the heading has nowhere to go — so the group is marked
                by a rule instead, and the section name survives only for screen
                readers. A truncated three-letter heading would be noise, and
                with no heading there is no disclosure control either.
              */
              <>
                <span className="sr-only">{section.label}</span>
                <div
                  aria-hidden="true"
                  className="mx-auto mb-2 h-px w-6 bg-[rgb(var(--brand-on-secondary)/0.20)]"
                />
              </>
            ) : (
              // 70%, not the 50% this carried before Sprint 10.5. At 50% these
              // measured 3.47:1 against the default secondary — and unlike a
              // placeholder these are live, readable labels ("Admissions",
              // "Fees") that a reader scans to find a section, so nothing exempts
              // them from the full 4.5. 11px uppercase is the *hardest* text in
              // the sidebar to read, not the easiest.
              <h2>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  // Disabled rather than hidden on the section holding the
                  // current page: the chevron still says "this one is open",
                  // and a control that would close the page out from under the
                  // reader is better refused than offered.
                  disabled={holdsCurrent}
                  onClick={() => {
                    toggleSection(section.label, !isOpen);
                  }}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-control px-2.5 pb-1 pt-1',
                    'text-2xs font-semibold uppercase tracking-wide',
                    'text-brand-onSecondary/70 transition-colors duration-fast',
                    holdsCurrent
                      ? 'cursor-default'
                      : 'hover:bg-[rgb(var(--brand-on-secondary)/0.10)] hover:text-brand-onSecondary',
                  )}
                >
                  <Icon
                    as={ChevronDown}
                    size="xs"
                    className={cn(
                      'shrink-0 transition-transform duration-fast',
                      isOpen ? undefined : '-rotate-90',
                    )}
                  />
                  <span className="truncate">{section.label}</span>
                </button>
              </h2>
            )}

            {/*
              `hidden`, not unmounted. The links stay in the accessibility tree
              as a collapsed region rather than disappearing from the document,
              and a browser's own in-page find still reaches them.
            */}
            <ul id={panelId} hidden={!isOpen} className="space-y-0.5">
              {section.items.map(renderItem)}
            </ul>
          </div>
        );
      })}
    </>
  );
}

/** Where the open/closed answers are kept. One key, one object. */
const SECTION_STORAGE_KEY = 'sms.portal.nav-sections';

/** A section label as an `id` fragment, for `aria-controls`. */
function slugifySection(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
