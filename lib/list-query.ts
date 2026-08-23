/**
 * The query parameters every paged listing route reads.
 *
 * Sprint 15 put a page size, a sort and a page number on the wire for every
 * listing in the product. Each route reading those three by hand is each route
 * getting a different answer to "what does `limit=0` mean" and "what happens
 * when somebody asks for 50,000 rows" — and the second question is the one that
 * matters, because the 100-row ceiling the sprint set is worthless if it lives
 * only in the browser. A request typed into the address bar never runs the
 * browser's code.
 *
 * So the cap is here, on the server, and `components/ui/DataTable.tsx` caps the
 * same number again on its side. Both, not either.
 *
 * The sort column is matched against a whitelist the route owns rather than
 * interpolated anywhere near SQL. `sort=name; drop table` resolves to the
 * route's default, which is the only safe way to take a column name from a
 * stranger.
 */

/** The ceiling, deliberately the same number as `DATA_TABLE_MAX_PAGE_SIZE`. */
export const MAX_PAGE_SIZE = 100;

export interface ListQuery<Column extends string> {
  /** 1-based. */
  page: number;
  /** Rows per page, never above `MAX_PAGE_SIZE`. */
  limit: number;
  /** `(page - 1) * limit`, ready for `.offset()`. */
  offset: number;
  sort: Column;
  direction: 'asc' | 'desc';
}

export interface ListQueryOptions<Column extends string> {
  /** The columns this route is willing to sort by. Anything else is ignored. */
  sortable: readonly Column[];
  defaultSort: Column;
  defaultDirection?: 'asc' | 'desc';
  defaultLimit?: number;
}

export function readListQuery<Column extends string>(
  search: URLSearchParams,
  options: ListQueryOptions<Column>,
): ListQuery<Column> {
  const pageRaw = Number.parseInt(search.get('page') ?? '1', 10);
  const limitRaw = Number.parseInt(
    search.get('limit') ?? String(options.defaultLimit ?? 50),
    10,
  );

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_PAGE_SIZE)
      : Math.min(options.defaultLimit ?? 50, MAX_PAGE_SIZE);

  const requestedSort = search.get('sort');
  const sort = options.sortable.find((column) => column === requestedSort) ?? options.defaultSort;

  const requestedDirection = search.get('direction');
  const direction =
    requestedDirection === 'asc' || requestedDirection === 'desc'
      ? requestedDirection
      : options.defaultDirection ?? 'desc';

  return { page, limit, offset: (page - 1) * limit, sort, direction };
}
