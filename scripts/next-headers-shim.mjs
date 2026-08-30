/**
 * A no-op stand-in for `next/headers`, for the check scripts only.
 *
 * `lib/school-queries.ts` value-imports `lib/supabase-auth.ts` for the three
 * account functions that delete and look up a Supabase user, and that module
 * imports `cookies` from `next/headers` at the top level. `next/headers` is
 * resolvable only inside a Next server runtime, so a plain Node script bundling
 * `listSchoolUsers` fails at *import* time — before it has run a single
 * statement — with `Cannot find module 'next/headers'`.
 *
 * Nothing in `npm run check-sprint20` calls a request-scoped API: the script
 * runs queries against a location id that matches no school. So these throw if
 * they are ever reached, rather than returning a plausible empty value that
 * would let a script quietly assert something about a request that does not
 * exist.
 *
 * Only the check scripts alias this. Nothing in `app/` or `components/` does.
 */

function unavailable(name) {
  return () => {
    throw new Error(
      `${name}() was called from a check script — there is no request here. ` +
        'If a query now needs one, it is doing something the script cannot verify.',
    );
  };
}

export const cookies = unavailable('cookies');
export const headers = unavailable('headers');
export const draftMode = unavailable('draftMode');
