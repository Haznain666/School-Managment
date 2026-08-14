/**
 * A no-op stand-in for the `server-only` package.
 *
 * `server-only` exists to throw if a module is pulled into a client bundle, and
 * it does that by throwing on import outside a React Server Component. That is
 * exactly right in the application and exactly wrong in a plain Node script, so
 * `npm run check-dashboard` aliases the package to this file in order to
 * execute `lib/dashboard-queries.ts` directly.
 *
 * Only the check scripts alias it. Nothing in `app/` or `components/` does, so
 * the real guarantee is untouched.
 */
export {};
