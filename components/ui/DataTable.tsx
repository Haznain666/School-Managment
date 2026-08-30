'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown, ListFilter, SearchX } from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { EmptyState } from '@/components/ui/EmptyState';
import { Icon, type LucideIcon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { Select } from '@/components/ui/Select';
import { SkeletonTable } from '@/components/ui/Skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableHead,
  TableHeaderCell,
  TableRow,
  type TableAlign,
} from '@/components/ui/Table';
import { formatDateOnly, isIsoDateValue } from '@/lib/dates';
import { cn } from '@/lib/utils';

/**
 * Every record listing in this product, as one component.
 *
 * Sprint 15 required filters, sortable column titles, pagination capped at 100
 * rows and a visible loader on *every* listing in *every* portal. There are
 * thirty-odd of them. Thirty hand-rolled sort handlers is thirty chances to
 * sort a money column lexically, to page past the end, or to tell a school with
 * four hundred students that it has none because a filter matched nothing —
 * and each of those is invisible until somebody with real data finds it.
 *
 * So the behaviour lives here once, and a listing declares its columns.
 *
 * ── Two modes, one component ─────────────────────────────────────────────
 * `mode="client"` (the default) is for a table whose rows are already all in
 * the browser — fee types, grading schemes, salary components, the chart of
 * accounts. It owns search, filter, sort and page state internally and never
 * touches the network.
 *
 * `mode="server"` is for a table whose row count grows without bound —
 * students, challans, applications, expenses, staff, schools. Everything is
 * controlled by the caller, which turns the state into query parameters and
 * refetches. The distinction matters: sorting 12,000 challans in the browser
 * means shipping 12,000 challans to the browser first.
 *
 * ── Sorting is type-aware, because a money column is not text ────────────
 * `kind` decides the comparator. Money in this codebase is integer paise, so
 * `'money'` sorts numerically and aligns right; sorting it as text puts 1000
 * before 900 and the number nobody can explain is the one at the top of the
 * fee report. Blanks sort last in both directions — a row missing a value is
 * not "the smallest", it is absent, and burying it at the bottom is what a
 * reader expects whichever way the arrow points.
 *
 * ── The indicator is next to the title, not replacing it ─────────────────
 * The whole header is a button, the caret sits after the label, and `aria-sort`
 * goes on the `<th>` so a screen reader announces the order rather than the
 * decoration. A header that only reveals its control on hover is unusable from
 * a keyboard, which is why the neutral state draws a dimmed double caret
 * instead of nothing.
 *
 * ── Empty is not the same as filtered-to-nothing ─────────────────────────
 * `EmptyState` already makes this distinction (`empty` vs `no-result`) and this
 * component is what finally honours it everywhere: if any filter or the search
 * box is carrying a value, the empty result offers "Clear filters", never
 * "Add a student".
 */

export type SortDirection = 'asc' | 'desc';

export interface DataTableSort {
  columnId: string;
  direction: SortDirection;
}

/** What the comparator is being handed. */
export type DataTableSortValue = string | number | Date | boolean | null | undefined;

/**
 * Decides the comparator and, for numbers and money, the default alignment.
 * `money` is paise — see `lib/money.ts`.
 */
export type DataTableColumnKind = 'text' | 'number' | 'money' | 'date';

export interface DataTableColumn<Row> {
  /** Stable id. In server mode this is what goes on the wire as `sort`. */
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  align?: TableAlign;
  kind?: DataTableColumnKind;
  /**
   * Client mode: what this column sorts on. Supplying it makes the column
   * sortable.
   */
  sortValue?: (row: Row) => DataTableSortValue;
  /**
   * Server mode: opt the column into sorting. The server owns the comparator,
   * so there is nothing to read from the row here.
   */
  sortable?: boolean;
  /** Client mode: contributes this column to the free-text search. */
  searchValue?: (row: Row) => string | null | undefined;
  /** Renders the cell as `<th scope="row">` — the cell that names the row. */
  rowHeader?: boolean;
  /** Quietens the cell. Mirrors `TableCell`'s own prop. */
  muted?: boolean;
  className?: string;
  headerClassName?: string;
}

export interface DataTableFilterOption {
  value: string;
  label: string;
}

interface FilterBase<Row> {
  id: string;
  label: string;
  options: readonly DataTableFilterOption[];
  disabled?: boolean;
  /** Client mode: reads the value this filter matches against. */
  rowValue?: (row: Row) => string | readonly string[] | null | undefined;
}

export interface DataTableSelectFilter<Row> extends FilterBase<Row> {
  kind?: 'select';
  /** The "no choice" option's label. Defaults to `All <label>`. */
  allLabel?: string;
  /** Server mode: controlled value. `''` means no filter. */
  value?: string;
  onChange?: (value: string) => void;
}

export interface DataTableMultiFilter<Row> extends FilterBase<Row> {
  kind: 'multi';
  /** Server mode: controlled values. Empty means no filter. */
  values?: readonly string[];
  onChange?: (values: string[]) => void;
}

export type DataTableFilter<Row> =
  | DataTableSelectFilter<Row>
  | DataTableMultiFilter<Row>;

/**
 * The page sizes on offer. 100 is the ceiling the sprint set and it is enforced
 * in `resolvePageSize` as well as here, so a caller passing 500 gets 100 rather
 * than a table that quietly ignores the rule.
 */
export const DATA_TABLE_PAGE_SIZES = [25, 50, 100] as const;
export const DATA_TABLE_MAX_PAGE_SIZE = 100;
export const DATA_TABLE_DEFAULT_PAGE_SIZE = 50;

export function resolvePageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) {
    return DATA_TABLE_DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(requested), DATA_TABLE_MAX_PAGE_SIZE);
}

export interface DataTableProps<Row> {
  /** Accessible name for the table. Required by `Table`. */
  caption: string;
  columns: ReadonlyArray<DataTableColumn<Row>>;
  /** The rows to draw. In server mode this is one page's worth. */
  rows: readonly Row[];
  getRowKey: (row: Row, index: number) => string;

  mode?: 'client' | 'server';

  /** Free-text search. Omit to hide the search box. */
  search?: {
    /** Server mode: controlled value. Client mode: ignored. */
    value?: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    label?: string;
  };
  filters?: ReadonlyArray<DataTableFilter<Row>>;
  /** Extra controls inside the filter bar — date ranges, dependent selects. */
  extraFilters?: ReactNode;
  /** Actions pinned to the right of the filter bar — export, bulk actions. */
  actions?: ReactNode;

  /** Server mode: the current sort, and where a header click goes. */
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort) => void;
  /** Client mode: what the table is sorted by before anyone clicks. */
  defaultSort?: DataTableSort | null;

  /** Server mode: 1-based page, its size, and the total across all pages. */
  page?: number;
  pageSize?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  /** Hides the page-size control when a caller wants a fixed size. */
  showPageSize?: boolean;

  /** Requirement (d): a filter or page change is in flight. */
  pending?: boolean;

  /** Server mode: whether a filter is currently narrowing the result. */
  filtersActive?: boolean;
  onClearFilters?: () => void;

  /** The `empty` state — nothing exists yet. */
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: LucideIcon;
  emptyAction?: ReactNode;
  /** The `no-result` state — things exist, this filter matched none. */
  noResultTitle?: string;
  noResultDescription?: string;

  itemNoun?: { singular: string; plural: string };

  /** Drawn under the last row, inside the table frame. Totals live here. */
  footer?: ReactNode;
  /** An extra full-width row beneath a row — a detail panel, a breakdown. */
  renderSubRow?: (row: Row) => ReactNode | null;
  rowSelected?: (row: Row) => boolean;
  rowInteractive?: boolean;
  /** Per-row styling — a switched-off account, an overdue challan. */
  rowClassName?: (row: Row) => string | undefined;

  maxHeight?: string;
  className?: string;
  tableClassName?: string;
}

/* -------------------------------------------------------------------------- */
/* Comparators                                                                 */
/* -------------------------------------------------------------------------- */

function isBlank(value: DataTableSortValue): boolean {
  return value === null || value === undefined || value === '';
}

function toNumber(value: DataTableSortValue): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  const parsed = Number(String(value).replace(/[^0-9.eE+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toTime(value: DataTableSortValue): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The one comparator, so a column cannot be sorted one way here and another way
 * on the next screen. `numeric: true` on the text path is what keeps
 * "Section 10" after "Section 9" — school data is full of numbered names.
 */
function compareValues(
  a: DataTableSortValue,
  b: DataTableSortValue,
  kind: DataTableColumnKind,
): number {
  const aBlank = isBlank(a);
  const bBlank = isBlank(b);
  // Blanks last in both directions: the direction flip is applied by the
  // caller, and this check runs before it.
  if (aBlank && bBlank) return 0;
  if (aBlank) return Number.POSITIVE_INFINITY;
  if (bBlank) return Number.NEGATIVE_INFINITY;

  switch (kind) {
    case 'number':
    case 'money':
      return toNumber(a) - toNumber(b);
    case 'date':
      return toTime(a) - toTime(b);
    default:
      return String(a).localeCompare(String(b), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
  }
}

function defaultAlign<Row>(column: DataTableColumn<Row>): TableAlign {
  if (column.align !== undefined) return column.align;
  return column.kind === 'number' || column.kind === 'money' ? 'numeric' : 'start';
}

/**
 * What goes in the cell — and, for a `date` column, in the one date format.
 *
 * ── Why this is the table's job and not each caller's ────────────────────
 * A `kind: 'date'` column has already told this component that its value is a
 * date; leaving it to render `'2026-08-02'` as it stands means the product
 * shows a column-shaped ISO string on one screen and `8/2/2026` on the next,
 * and `8/2/2026` is the second of August or the eighth of February depending
 * on a setting nobody in the school chose. `formatDateOnly` reads a
 * `YYYY-MM-DD` as a calendar date rather than as UTC midnight, which is the
 * other half of the same defect — see `lib/dates.ts`.
 *
 * Only a plain string that is *actually* a column value is touched, and only
 * then. A cell that returns an element has decided how it wants to look — a
 * badge, a link, a date with a note under it — and a cell that returns
 * `'Never'`, `'in 3 days'` or `'August 2025'` has already turned its value into
 * a sentence. Reaching into either would be this component overruling its
 * caller, and in the last case it would turn a month into the first of it.
 */
function renderCell<Row>(column: DataTableColumn<Row>, row: Row): ReactNode {
  const content = column.cell(row);

  if (column.kind === 'date' && typeof content === 'string' && isIsoDateValue(content)) {
    return formatDateOnly(content);
  }

  return content;
}

function isSortable<Row>(column: DataTableColumn<Row>): boolean {
  return column.sortable ?? column.sortValue !== undefined;
}

function matchesFilter(
  rowValue: string | readonly string[] | null | undefined,
  selected: readonly string[],
): boolean {
  if (selected.length === 0) return true;
  if (rowValue === null || rowValue === undefined) return false;
  if (Array.isArray(rowValue)) {
    return rowValue.some((entry) => selected.includes(entry));
  }
  return selected.includes(rowValue as string);
}

/* -------------------------------------------------------------------------- */
/* The component                                                               */
/* -------------------------------------------------------------------------- */

export function DataTable<Row>({
  caption,
  columns,
  rows,
  getRowKey,
  mode = 'client',
  search,
  filters,
  extraFilters,
  actions,
  sort,
  onSortChange,
  defaultSort = null,
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  showPageSize = true,
  pending = false,
  filtersActive,
  onClearFilters,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyIcon,
  emptyAction,
  noResultTitle = 'No matches',
  noResultDescription = 'Nothing matches the filters you have set. Widen or clear them to see more.',
  itemNoun = { singular: 'record', plural: 'records' },
  footer,
  renderSubRow,
  rowSelected,
  rowInteractive = false,
  rowClassName,
  maxHeight,
  className,
  tableClassName,
}: DataTableProps<Row>) {
  const server = mode === 'server';

  /* -- state the client mode owns ----------------------------------------- */
  const [innerSearch, setInnerSearch] = useState('');
  const [innerFilters, setInnerFilters] = useState<Record<string, string[]>>({});
  const [innerSort, setInnerSort] = useState<DataTableSort | null>(defaultSort);
  const [innerPage, setInnerPage] = useState(1);
  const [innerPageSize, setInnerPageSize] = useState(resolvePageSize(pageSize));

  /*
   * A server-mode table only pages on the server if the caller gave it a page
   * handler. Without one — a listing whose API narrows by a filter but returns
   * everything matching it — the rows in hand are the whole result, and paging
   * them here is right. The alternative is what this guard exists to prevent:
   * `rows.slice(0, 50)` with a pager that cannot move, which loses row 51
   * silently and looks exactly like a table with 50 rows in it.
   */
  const serverPaged = server && onPageChange !== undefined;

  const activeSort = server ? sort ?? null : innerSort;
  const activePageSize = server ? resolvePageSize(pageSize) : innerPageSize;
  const activePage = serverPaged ? Math.max(1, page ?? 1) : innerPage;

  const searchValue = server ? search?.value ?? '' : innerSearch;

  const filterValues = useCallback(
    (filter: DataTableFilter<Row>): string[] => {
      if (server) {
        if (filter.kind === 'multi') return [...(filter.values ?? [])];
        const single = filter.value ?? '';
        return single === '' ? [] : [single];
      }
      return innerFilters[filter.id] ?? [];
    },
    [server, innerFilters],
  );

  const setFilterValues = useCallback(
    (filter: DataTableFilter<Row>, values: string[]) => {
      if (server) {
        if (filter.kind === 'multi') {
          filter.onChange?.(values);
        } else {
          filter.onChange?.(values[0] ?? '');
        }
        return;
      }
      setInnerPage(1);
      setInnerFilters((current) => ({ ...current, [filter.id]: values }));
    },
    [server],
  );

  const anyFilterActive = server
    ? filtersActive ??
      (searchValue.trim() !== '' ||
        (filters ?? []).some((filter) => filterValues(filter).length > 0))
    : innerSearch.trim() !== '' ||
      Object.values(innerFilters).some((values) => values.length > 0);

  const clearFilters = useCallback(() => {
    if (server) {
      onClearFilters?.();
      return;
    }
    setInnerSearch('');
    setInnerFilters({});
    setInnerPage(1);
  }, [server, onClearFilters]);

  /* -- client-mode derivation --------------------------------------------- */
  const columnsById = useMemo(() => {
    const map = new Map<string, DataTableColumn<Row>>();
    for (const column of columns) map.set(column.id, column);
    return map;
  }, [columns]);

  const processed = useMemo(() => {
    if (server) return rows;

    const needle = innerSearch.trim().toLowerCase();
    let working = [...rows];

    if (needle !== '') {
      const searchable = columns.filter((column) => column.searchValue !== undefined);
      if (searchable.length > 0) {
        working = working.filter((row) =>
          searchable.some((column) =>
            (column.searchValue?.(row) ?? '').toLowerCase().includes(needle),
          ),
        );
      }
    }

    for (const filter of filters ?? []) {
      const selected = innerFilters[filter.id] ?? [];
      if (selected.length === 0 || filter.rowValue === undefined) continue;
      const read = filter.rowValue;
      working = working.filter((row) => matchesFilter(read(row), selected));
    }

    if (innerSort !== null) {
      const column = columnsById.get(innerSort.columnId);
      const read = column?.sortValue;
      if (column !== undefined && read !== undefined) {
        const kind = column.kind ?? 'text';
        const factor = innerSort.direction === 'asc' ? 1 : -1;
        working.sort((a, b) => {
          const result = compareValues(read(a), read(b), kind);
          // Blanks are pinned last, so their sentinel result is not flipped.
          if (!Number.isFinite(result)) return result > 0 ? 1 : -1;
          return result * factor;
        });
      }
    }

    return working;
  }, [server, rows, columns, columnsById, filters, innerSearch, innerFilters, innerSort]);

  const total = server ? totalItems ?? rows.length : processed.length;

  const totalPages = Math.max(1, Math.ceil(total / activePageSize));

  // A filter that shortens the list can strand the reader on page 7 of 3.
  useEffect(() => {
    if (serverPaged) return;
    const length = server ? rows.length : processed.length;
    setInnerPage((current) =>
      Math.min(current, Math.max(1, Math.ceil(length / activePageSize))),
    );
  }, [serverPaged, server, rows.length, processed.length, activePageSize]);

  const visible = useMemo(() => {
    if (serverPaged) return rows.slice(0, activePageSize);
    const start = (Math.min(activePage, totalPages) - 1) * activePageSize;
    return (server ? rows : processed).slice(start, start + activePageSize);
  }, [server, serverPaged, rows, processed, activePage, activePageSize, totalPages]);

  const handleSort = useCallback(
    (columnId: string) => {
      const next: DataTableSort =
        activeSort !== null && activeSort.columnId === columnId
          ? { columnId, direction: activeSort.direction === 'asc' ? 'desc' : 'asc' }
          : { columnId, direction: 'asc' };

      if (server && onSortChange !== undefined) {
        onSortChange?.(next);
        return;
      }
      setInnerSort(next);
      setInnerPage(1);
    },
    [activeSort, server, onSortChange],
  );

  const handlePageChange = useCallback(
    (next: number) => {
      if (serverPaged) {
        onPageChange?.(next);
        return;
      }
      setInnerPage(next);
    },
    [serverPaged, onPageChange],
  );

  const handlePageSizeChange = useCallback(
    (next: number) => {
      const capped = resolvePageSize(next);
      if (serverPaged) {
        onPageSizeChange?.(capped);
        onPageChange?.(1);
        return;
      }
      setInnerPageSize(capped);
      setInnerPage(1);
    },
    [serverPaged, onPageSizeChange, onPageChange],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      if (server) {
        search?.onChange?.(value);
        return;
      }
      setInnerSearch(value);
      setInnerPage(1);
    },
    [server, search],
  );

  const hasFilterBar =
    search !== undefined ||
    (filters !== undefined && filters.length > 0) ||
    extraFilters !== undefined ||
    actions !== undefined;

  const columnCount = columns.length;

  return (
    <div className={cn('space-y-3', className)}>
      {hasFilterBar ? (
        <div className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface-raised p-4">
          {search !== undefined ? (
            <div className="w-full sm:w-64">
              <Input
                type="search"
                label={search.label ?? 'Search'}
                placeholder={search.placeholder ?? 'Search'}
                value={searchValue}
                onChange={(event) => {
                  handleSearchChange(event.target.value);
                }}
              />
            </div>
          ) : null}

          {(filters ?? []).map((filter) =>
            filter.kind === 'multi' ? (
              <MultiFilter
                key={filter.id}
                label={filter.label}
                options={filter.options}
                values={filterValues(filter)}
                disabled={filter.disabled}
                onChange={(values) => {
                  setFilterValues(filter, values);
                }}
              />
            ) : (
              <div key={filter.id} className="w-full sm:w-52">
                <Select
                  label={filter.label}
                  disabled={filter.disabled}
                  options={[
                    { value: '', label: filter.allLabel ?? `All ${filter.label.toLowerCase()}` },
                    ...filter.options,
                  ]}
                  value={filterValues(filter)[0] ?? ''}
                  onChange={(event) => {
                    setFilterValues(filter, event.target.value === '' ? [] : [event.target.value]);
                  }}
                />
              </div>
            ),
          )}

          {extraFilters}

          {anyFilterActive ? (
            <button
              type="button"
              onClick={clearFilters}
              className="h-10 rounded-control px-3 text-sm font-medium text-brand-primary hover:bg-surface-hover"
            >
              Clear filters
            </button>
          ) : null}

          {actions !== undefined ? (
            <div className="ml-auto flex flex-wrap items-end gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}

      {pending ? (
        // Requirement (d). The shape of what is arriving, not a spinner — see
        // CLAUDE.md, "Use a shape, not a grey box".
        <SkeletonTable
          rows={Math.min(activePageSize, 8)}
          columns={Math.min(Math.max(columnCount, 2), 8)}
        />
      ) : visible.length === 0 ? (
        anyFilterActive ? (
          <EmptyState
            tone="no-result"
            icon={SearchX}
            title={noResultTitle}
            description={noResultDescription}
            secondaryAction={
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-control border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface-hover"
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <EmptyState
            tone="empty"
            icon={emptyIcon}
            title={emptyTitle}
            description={emptyDescription}
            action={emptyAction}
          />
        )
      ) : (
        <Table caption={caption} maxHeight={maxHeight} className={tableClassName}>
          <TableHead>
            <TableRow>
              {columns.map((column) => {
                const sortable = isSortable(column);
                const isSorted = activeSort?.columnId === column.id;
                const align = defaultAlign(column);

                return (
                  <TableHeaderCell
                    key={column.id}
                    align={align}
                    className={column.headerClassName}
                    sort={
                      isSorted
                        ? activeSort?.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => {
                          handleSort(column.id);
                        }}
                        /*
                          The caret always follows the label — Sprint 20, item 4b.

                          This used to be `flex-row-reverse` on a numeric or
                          end-aligned column, which put the caret *before* the
                          label on three headers of the aged-debt table and
                          after it on every other one. Read across the header
                          row it looked like two tables spliced together, and
                          the reversal bought nothing the alignment does not:
                          a full-width button with `justify-end` pushes the
                          pair to the right edge and keeps the reading order
                          the same everywhere.
                        */
                        className={cn(
                          'group flex w-full items-center gap-1 rounded-control text-2xs font-semibold uppercase tracking-wide',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40',
                          isSorted ? 'text-ink' : 'text-ink-muted hover:text-ink',
                          align === 'numeric' || align === 'end'
                            ? 'justify-end'
                            : 'justify-start',
                        )}
                        // Says what the click will do, not what the state is —
                        // `aria-sort` on the th already reports the state.
                        aria-label={
                          isSorted && activeSort?.direction === 'asc'
                            ? `Sort descending`
                            : `Sort ascending`
                        }
                      >
                        <span>{column.header}</span>
                        {/*
                          A fixed footprint for the caret, so a sorted header
                          and an unsorted one are the same width. The three
                          glyphs are not: `ChevronsUpDown` is a double arrow and
                          the sorted ones are single, so without this the whole
                          row shifted by a pixel or two the moment somebody
                          sorted it — on a table whose columns a reader is
                          comparing across.
                        */}
                        <span className="inline-flex w-3 shrink-0 justify-center">
                          <Icon
                            as={
                              isSorted
                                ? activeSort?.direction === 'asc'
                                  ? ArrowUp
                                  : ArrowDown
                                : ChevronsUpDown
                            }
                            size="xs"
                            className={isSorted ? 'text-brand-primary' : 'text-ink-faint'}
                          />
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </TableHeaderCell>
                );
              })}
            </TableRow>
          </TableHead>

          <TableBody>
            {visible.map((row, index) => {
              const key = getRowKey(row, index);
              const sub = renderSubRow?.(row) ?? null;

              return (
                <Fragment key={key}>
                  <TableRow
                    selected={rowSelected?.(row) ?? false}
                    interactive={rowInteractive}
                    className={rowClassName?.(row)}
                  >
                    {columns.map((column) => (
                      <TableCell
                        key={column.id}
                        align={defaultAlign(column)}
                        rowHeader={column.rowHeader}
                        muted={column.muted}
                        className={column.className}
                      >
                        {renderCell(column, row)}
                      </TableCell>
                    ))}
                  </TableRow>
                  {sub === null ? null : (
                    <tr>
                      <td colSpan={columnCount} className="bg-surface-sunken px-4 py-3">
                        {sub}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </TableBody>

          {footer === undefined ? null : <TableFoot>{footer}</TableFoot>}
        </Table>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {showPageSize && (total > DATA_TABLE_PAGE_SIZES[0] || activePageSize !== DATA_TABLE_DEFAULT_PAGE_SIZE) ? (
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <span>Rows per page</span>
            <select
              value={String(activePageSize)}
              disabled={pending}
              onChange={(event) => {
                handlePageSizeChange(Number(event.target.value));
              }}
              className={cn(
                'h-8 rounded-control border border-line bg-surface px-2 text-xs text-ink',
                'focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/30',
              )}
              aria-label="Rows per page"
            >
              {DATA_TABLE_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}

        <Pagination
          page={Math.min(activePage, totalPages)}
          pageSize={activePageSize}
          totalItems={total}
          onPageChange={handlePageChange}
          itemNoun={itemNoun}
          disabled={pending}
          className="flex-1"
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Multi-select filter                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A checkbox list behind a button, rather than a native `<select multiple>`.
 *
 * A native multiple select needs ctrl-click to add a second value, which
 * roughly nobody discovers, and it silently *replaces* the selection on a plain
 * click. On a status filter that means a clerk who wanted "Unpaid and Partial"
 * gets "Partial" and a shorter list than they asked for, with nothing on screen
 * to say why.
 */
function MultiFilter({
  label,
  options,
  values,
  disabled = false,
  onChange,
}: {
  label: string;
  options: readonly DataTableFilterOption[];
  values: readonly string[];
  disabled?: boolean;
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (container.current?.contains(event.target as Node) === true) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const summary =
    values.length === 0
      ? `All ${label.toLowerCase()}`
      : values.length === 1
        ? options.find((option) => option.value === values[0])?.label ?? '1 selected'
        : `${values.length} selected`;

  return (
    <div ref={container} className="relative w-full sm:w-52">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => {
          setOpen((current) => !current);
        }}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-control border border-line bg-surface px-3 text-left text-sm text-ink',
          'focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span className="truncate">{summary}</span>
        <Icon as={ListFilter} size="xs" className="shrink-0 text-ink-faint" />
      </button>

      {open ? (
        <div
          className={cn(
            'absolute left-0 z-dropdown mt-1 max-h-64 w-full overflow-auto rounded-card border border-line bg-surface-raised p-2 shadow-lg',
          )}
        >
          {options.map((option) => {
            const checked = values.includes(option.value);
            return (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-sm text-ink hover:bg-surface-hover"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    onChange(
                      checked
                        ? values.filter((value) => value !== option.value)
                        : [...values, option.value],
                    );
                  }}
                  className="h-4 w-4 rounded border-line text-brand-primary focus:ring-brand-primary/30"
                />
                <span className="truncate">{option.label}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
