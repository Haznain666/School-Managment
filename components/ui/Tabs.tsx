'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useId, useRef, useState } from 'react';

import { Icon, type LucideIcon } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

/**
 * Tabs, in the two forms this product actually needs.
 *
 * `LinkTabs` is the one most screens want. The Super Admin school page, the
 * student record and the fee reports are all sets of *routes*, not panels — the
 * tab is a destination that has its own URL, survives a refresh and can be
 * linked to. Those must be `<a>` elements; building them as buttons that swap
 * client state would break the back button and every deep link in support
 * threads.
 *
 * `Tabs` is the panel form, for genuinely local switching where no navigation
 * happens. It implements the roving-tabindex keyboard pattern: arrow keys move
 * between tabs, Home and End jump to the ends, and only the active tab is in
 * the tab order — so a keyboard user tabs *past* the tab strip in one press
 * rather than through every tab in it.
 */

/* -----------------------------------------------------------------------------
 * Shared appearance.
 *
 * An underline rather than a filled pill. A filled active tab is a second thing
 * competing with the page's primary button for the "this is the important
 * element" role, and on a school's saturated palette the two blocks of brand
 * colour fight. The underline says "current" without claiming "act on me".
 * -------------------------------------------------------------------------- */

const TAB_BASE =
  'relative inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-2 text-sm font-medium transition-colors duration-fast';

const TAB_ACTIVE = 'border-brand-primary text-ink';
const TAB_INACTIVE =
  'border-transparent text-ink-muted hover:border-line-strong hover:text-ink';

/**
 * The strip itself. Scrolls horizontally on narrow screens rather than
 * wrapping: a wrapped tab strip changes height as tabs are selected, which
 * shifts the whole page under the reader's cursor.
 */
function TabStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex gap-1 overflow-x-auto border-b border-line',
        // Hides the scrollbar without disabling the scrolling itself.
        '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Link tabs — one route per tab.
 * -------------------------------------------------------------------------- */

export interface LinkTabItem {
  label: string;
  href: string;
  icon?: LucideIcon;
  /** A count, e.g. pending applications. Omit rather than passing 0. */
  count?: number;
}

export interface LinkTabsProps {
  items: readonly LinkTabItem[];
  /**
   * The href of the current tab. Resolved by the caller from `usePathname` or
   * from the server's own knowledge of the route — this component does not
   * guess, because prefix matching gets it wrong for nested routes (the same
   * trap `PortalSidebar.isCurrent` exists to handle).
   */
  currentHref: string;
  ariaLabel: string;
  className?: string;
}

export function LinkTabs({ items, currentHref, ariaLabel, className }: LinkTabsProps) {
  return (
    <nav aria-label={ariaLabel} className={className}>
      <TabStrip>
        {items.map((item) => {
          const isCurrent = item.href === currentHref;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent ? 'page' : undefined}
              className={cn(TAB_BASE, isCurrent ? TAB_ACTIVE : TAB_INACTIVE)}
            >
              {item.icon !== undefined ? <Icon as={item.icon} size="sm" /> : null}
              {item.label}
              {item.count !== undefined ? <TabCount value={item.count} active={isCurrent} /> : null}
            </Link>
          );
        })}
      </TabStrip>
    </nav>
  );
}

function TabCount({ value, active }: { value: number; active: boolean }) {
  return (
    <span
      className={cn(
        'ml-0.5 rounded-pill px-1.5 py-0.5 font-mono text-2xs tabular-nums',
        active
          ? 'bg-brand-primarySubtle text-brand-onPrimarySubtle'
          : 'bg-surface-sunken text-ink-muted',
      )}
    >
      {value.toLocaleString()}
    </span>
  );
}

/* -----------------------------------------------------------------------------
 * Panel tabs — local switching, no navigation.
 * -------------------------------------------------------------------------- */

export interface TabPanelItem {
  /** Stable identifier, used for the ARIA wiring. */
  id: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
  content: ReactNode;
}

export interface TabsProps {
  items: readonly TabPanelItem[];
  /** Which tab opens selected. Defaults to the first. */
  defaultId?: string;
  ariaLabel: string;
  className?: string;
}

export function Tabs({ items, defaultId, ariaLabel, className }: TabsProps) {
  const baseId = useId();
  const [selected, setSelected] = useState(defaultId ?? items[0]?.id ?? '');
  const stripRef = useRef<HTMLDivElement>(null);

  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === selected),
  );

  /**
   * Arrow-key navigation.
   *
   * Selection follows focus, which is the correct pattern when switching is
   * instant and cheap — the reader arrows along and sees each panel, rather
   * than arrowing then pressing Enter. It would be the wrong pattern if a tab
   * triggered a fetch, which is why the panel form is for local content only.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const lastIndex = items.length - 1;
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') nextIndex = selectedIndex === lastIndex ? 0 : selectedIndex + 1;
    else if (event.key === 'ArrowLeft') nextIndex = selectedIndex === 0 ? lastIndex : selectedIndex - 1;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = lastIndex;

    if (nextIndex === null) return;

    event.preventDefault();
    const nextItem = items[nextIndex];
    if (nextItem === undefined) return;

    setSelected(nextItem.id);
    stripRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${baseId}-tab-${nextItem.id}`)}`)
      ?.focus();
  };

  return (
    <div className={className}>
      <div ref={stripRef} role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
        <TabStrip>
          {items.map((item) => {
            const isSelected = item.id === selected;

            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`${baseId}-tab-${item.id}`}
                aria-selected={isSelected}
                aria-controls={`${baseId}-panel-${item.id}`}
                // Roving tabindex: only the selected tab is reachable by Tab.
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setSelected(item.id)}
                className={cn(TAB_BASE, isSelected ? TAB_ACTIVE : TAB_INACTIVE)}
              >
                {item.icon !== undefined ? <Icon as={item.icon} size="sm" /> : null}
                {item.label}
                {item.count !== undefined ? (
                  <TabCount value={item.count} active={isSelected} />
                ) : null}
              </button>
            );
          })}
        </TabStrip>
      </div>

      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          // `tabIndex={0}` so the panel itself is focusable, which is how a
          // keyboard user gets from the tab into its content.
          tabIndex={0}
          hidden={item.id !== selected}
          className="pt-4 focus-visible:outline-none"
        >
          {item.id === selected ? item.content : null}
        </div>
      ))}
    </div>
  );
}
