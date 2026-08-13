import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * The table primitive every list screen has been improvising.
 *
 * This product is mostly tables — students, challans, staff, marks, payroll,
 * applications, attendance — and until Sprint 10.5 each screen wrote its own
 * `<table>` with its own padding, its own header treatment and its own idea of
 * how a numeric column aligns. The result was a product where two lists of the
 * same thing looked like they came from different applications.
 *
 * ── What is opinionated here, and why ────────────────────────────────────
 *
 * **Numbers are right-aligned and tabular.** A column of amounts is compared
 * down the column, not read across the row, and comparison only works when the
 * digits line up. `align="numeric"` does both at once so a screen cannot get
 * one and forget the other — which is the failure that makes a fee report look
 * amateur to the one person guaranteed to scrutinise it.
 *
 * **The header is sticky inside a scrolling body.** A register of 400 students
 * is scrolled past the header within one flick, and a column of unlabelled
 * dates is unreadable.
 *
 * **Horizontal overflow is owned by the wrapper, not the page.** A wide table
 * scrolls inside its own box; the page itself never scrolls sideways. Without
 * this a fee table on a phone drags the entire layout with it.
 *
 * ── Print ────────────────────────────────────────────────────────────────
 * Nothing here touches `@media print`. Printed documents go through
 * `PrintSheet`, which has its own rules, and STATE.md §5e is the standing
 * reminder of what a careless global print rule costs: every challan came out
 * blank for two days. If a printed table is ever wanted, it gets its own
 * component rather than a print block bolted onto this one.
 */

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Accessible name. Required — an unnamed table is a wall to a screen reader. */
  caption: string;
  /** Shows the caption visually as well. Off by default; page headers usually say it. */
  showCaption?: boolean;
  /**
   * Caps the scroll height so the sticky header has something to stick to.
   * Omit for short tables that should simply take their natural height.
   */
  maxHeight?: string;
  children: ReactNode;
}

export function Table({
  caption,
  showCaption = false,
  maxHeight,
  className,
  children,
  ...rest
}: TableProps) {
  return (
    <div
      className={cn(
        'relative w-full overflow-auto rounded-card border border-line bg-surface-raised',
        className,
      )}
      style={maxHeight === undefined ? undefined : { maxHeight }}
    >
      <table className="w-full border-collapse text-left text-sm" {...rest}>
        <caption
          className={cn(
            showCaption
              ? 'px-4 py-3 text-left text-sm font-semibold text-ink'
              : 'sr-only',
          )}
        >
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn('sticky top-0 z-sticky bg-surface-sunken', className)}
      {...rest}
    >
      {children}
    </thead>
  );
}

export function TableBody({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cn('divide-y divide-line', className)} {...rest}>
      {children}
    </tbody>
  );
}

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Draws the row as the current selection. */
  selected?: boolean;
  /** Adds hover feedback. Set it only when the row actually does something. */
  interactive?: boolean;
}

export function TableRow({
  selected = false,
  interactive = false,
  className,
  children,
  ...rest
}: TableRowProps) {
  return (
    <tr
      aria-selected={selected ? true : undefined}
      className={cn(
        'transition-colors duration-fast',
        // Selection wins over hover, so a hovered selected row does not
        // momentarily look deselected.
        selected
          ? 'bg-brand-primarySubtle'
          : interactive && 'hover:bg-surface-hover',
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

export type TableAlign = 'start' | 'center' | 'end' | 'numeric';

const ALIGN_CLASSES: Record<TableAlign, string> = {
  start: 'text-left',
  center: 'text-center',
  end: 'text-right',
  // Tabular figures as well as right alignment: proportional digits make a
  // column of amounts ragged even when the column edge is straight.
  numeric: 'text-right font-mono tabular-nums',
};

/*
 * The native `align` attribute is omitted from both cell interfaces. It is a
 * deprecated presentational HTML attribute with a narrower value set, and
 * keeping the name for our own richer prop is worth it: `align="numeric"` is
 * the thing a caller should be reaching for, and having it sit beside a
 * lookalike that silently does something else is how a money column ends up
 * left-aligned.
 */
export interface TableHeaderCellProps
  extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> {
  align?: TableAlign;
  /**
   * Current sort direction, when this column is the sorted one. Emits
   * `aria-sort`, which is how a screen reader announces the table's order.
   */
  sort?: 'ascending' | 'descending';
}

export function TableHeaderCell({
  align = 'start',
  sort,
  className,
  children,
  ...rest
}: TableHeaderCellProps) {
  return (
    <th
      scope="col"
      aria-sort={sort}
      className={cn(
        'whitespace-nowrap border-b border-line px-4 py-2.5',
        'text-2xs font-semibold uppercase tracking-wide text-ink-muted',
        ALIGN_CLASSES[align],
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export interface TableCellProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align'> {
  align?: TableAlign;
  /** Renders as a `<th scope="row">` — the cell that names the row. */
  rowHeader?: boolean;
  /** Quietens the cell for secondary detail. */
  muted?: boolean;
}

export function TableCell({
  align = 'start',
  rowHeader = false,
  muted = false,
  className,
  children,
  ...rest
}: TableCellProps) {
  const classes = cn(
    'px-4 py-3 align-middle',
    muted ? 'text-ink-muted' : 'text-ink',
    rowHeader && 'font-medium',
    ALIGN_CLASSES[align],
    className,
  );

  if (rowHeader) {
    return (
      <th scope="row" className={classes} {...(rest as ThHTMLAttributes<HTMLTableCellElement>)}>
        {children}
      </th>
    );
  }

  return (
    <td className={classes} {...rest}>
      {children}
    </td>
  );
}

export interface TableEmptyRowProps {
  /** Must match the table's column count, or the message sits under one column. */
  colSpan: number;
  children: ReactNode;
}

/**
 * A full-width row for an empty result, so the message lands inside the table's
 * own frame rather than beneath it looking detached.
 */
export function TableEmptyRow({ colSpan, children }: TableEmptyRowProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-0">
        {children}
      </td>
    </tr>
  );
}

/**
 * A footer for totals.
 *
 * Sticky to the bottom for the same reason the header is sticky to the top: the
 * total of a fee report is the number the reader came for, and it should not
 * require scrolling past 400 rows to see.
 */
export function TableFoot({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      className={cn(
        'sticky bottom-0 z-sticky border-t border-line-strong bg-surface-sunken font-semibold text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </tfoot>
  );
}
