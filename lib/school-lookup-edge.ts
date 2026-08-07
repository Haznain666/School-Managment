/**
 * Edge-safe `slug -> school` lookup for `middleware.ts`.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 * Middleware resolves the tenant on every request, which means it must read
 * the `schools` table. It runs on the Edge runtime — no TCP sockets, so no
 * PostgreSQL driver. Under Neon this was a non-issue because Neon's driver
 * spoke HTTP; Supabase speaks the Postgres wire protocol.
 *
 * Supabase also exposes every `public` table over PostgREST, which is plain
 * HTTPS and therefore does work here. So the same single-row lookup is issued
 * as a REST call instead of SQL. `lib/drizzle.ts` stays the one client for
 * every other query in the application (CRITICAL RULE #6) — this is the
 * documented exception, and it exists solely because of the runtime boundary.
 *
 * ── Why raw fetch rather than @supabase/supabase-js ──────────────────────
 * Same reasoning `lib/storage.ts` gives: one call against a documented, stable
 * endpoint does not justify pulling the SDK — and its auth, realtime and
 * postgrest modules — into the middleware bundle, which is size-sensitive.
 *
 * ── On the service-role key ──────────────────────────────────────────────
 * Middleware is server code; the key is never shipped to a browser. It is used
 * because the `schools` lookup has to succeed before anyone has authenticated
 * — a school's login page cannot render until we know which school it is.
 * Reading a slug, name and active flag is not a privileged act, and selecting
 * a tenant is not entering one: `withSchoolAuth` and `requireSchoolRole` still
 * compare the resolved location against the caller's own session claims.
 */

export interface ResolvedSchool {
  locationId: string;
  schoolId: string;
  slug: string;
  isActive: boolean;
}

/** Shape PostgREST returns for the selected columns. */
interface SchoolRow {
  location_id: string;
  id: string;
  slug: string;
  is_active: boolean;
}

function restEndpoint(): string | null {
  const raw = process.env['SUPABASE_URL'];
  if (raw === undefined || raw.trim() === '') return null;
  return `${raw.trim().replace(/\/+$/, '')}/rest/v1`;
}

/**
 * Supabase accepts either the legacy `service_role` JWT or the newer
 * `sb_secret_...` form. Both go in the same two headers — `apikey` gates the
 * API gateway, `Authorization` gates PostgREST, and omitting either returns a
 * 401 that reads like a bad key.
 */
function serviceKey(): string | null {
  const raw = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  return raw === undefined || raw.trim() === '' ? null : raw.trim();
}

/**
 * Looks up one school by slug. Returns null when it does not exist.
 * Throws when Supabase is unreachable or misconfigured, so the caller can tell
 * "no such school" apart from "the lookup failed" — middleware shows
 * /school-not-found for the first and logs the second.
 */
export async function fetchSchoolBySlug(slug: string): Promise<ResolvedSchool | null> {
  const endpoint = restEndpoint();
  const key = serviceKey();

  if (endpoint === null || key === null) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set — middleware ' +
        'resolves the tenant through the Supabase REST API.',
    );
  }

  const query = new URLSearchParams({
    slug: `eq.${slug}`,
    select: 'location_id,id,slug,is_active',
    limit: '1',
  });

  const response = await fetch(`${endpoint}/schools?${query.toString()}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
    // The tenant must reflect a rename or deactivation immediately.
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(
      `Supabase school lookup failed: ${response.status} ${await response.text()}`,
    );
  }

  const rows = (await response.json()) as SchoolRow[];
  const row = rows[0];
  if (row === undefined) return null;

  return {
    locationId: row.location_id,
    schoolId: row.id,
    slug: row.slug,
    isActive: row.is_active,
  };
}
