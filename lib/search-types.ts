/**
 * What a global search returns, on every portal.
 *
 * Deliberately free of `server-only` and of any database import: the results
 * page, the header dropdown and the five query modules all describe the same
 * shape, and a second definition on the browser side is how a category quietly
 * stops rendering its subtitle.
 */

/** One thing found. */
export interface SearchHit {
  /** Unique across the whole result set, so React keys need nothing else. */
  key: string;
  /** What it is called — the name a person searched for. */
  title: string;
  /**
   * The line under the title: what distinguishes this hit from the four others
   * with the same name. A class and a section for a student, a designation for
   * a teacher, an amount and a due date for a challan.
   */
  subtitle: string | null;
  href: string;
  /**
   * The screen this leads to, named the way the product names it — "Student
   * detail", "Challan". The product owner asked for this explicitly and it is
   * the part most global searches leave out: a result list that says only
   * "Ahmed Raza" three times is a puzzle, and one that says "Student detail",
   * "Guardian on a student record" and "Staff record" is an answer.
   */
  page: string;
  /** An optional status chip — enrolment status, challan status. */
  badge?: string;
}

/** One category of results. */
export interface SearchGroup {
  key: string;
  /** "Students", "Teachers & staff". */
  label: string;
  /** A `NavIconName`, so the results page can draw the same glyph the nav does. */
  icon: string;
  hits: SearchHit[];
  /**
   * True when the category had more matches than were returned.
   *
   * Shown as "showing the first 8 of 40" rather than silently truncated. A
   * search that quietly drops results is worse than one that finds nothing: the
   * reader concludes the record does not exist.
   */
  truncated: boolean;
  /** Where to go to see all of them, when such a screen exists. */
  moreHref?: string;
}

export interface SearchResults {
  query: string;
  groups: SearchGroup[];
  /** Across every group, before truncation. */
  total: number;
}

/**
 * The shortest query worth running.
 *
 * One character matches most of a school. Two is the point at which an ILIKE
 * over five tables returns something a person can read, and it is short enough
 * for "5A" and for a two-letter surname.
 */
export const MIN_QUERY_LENGTH = 2;

/** How many hits each category returns to the results page. */
export const HITS_PER_GROUP = 8;

/** How many the header dropdown shows per category, before "see all". */
export const PREVIEW_HITS_PER_GROUP = 3;

export function isSearchable(query: string): boolean {
  return query.trim().length >= MIN_QUERY_LENGTH;
}

/**
 * Escapes a user's text for use inside an `ILIKE` pattern.
 *
 * `%` and `_` are wildcards, and a person typing a `%` means the character. The
 * backslash has to be escaped first or it would escape the escapes. This is not
 * an injection defence — the value is still a bound parameter and never touches
 * the SQL string — it is a correctness one: without it, searching for `100%`
 * matches every row in the table.
 */
export function likePattern(query: string): string {
  const escaped = query.trim().replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}
