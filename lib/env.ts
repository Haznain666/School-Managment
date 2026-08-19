/**
 * Typed environment access.
 *
 * Server secrets are read lazily through `requireServerEnv` so that importing a
 * module never crashes a build that happens not to need that variable.
 * Public (NEXT_PUBLIC_*) values must be referenced as full literals for Next.js
 * to inline them into the client bundle — hence the explicit object below.
 */

/** Values inlined into the browser bundle at build time. */
export const publicEnv = {
  // Supabase's anon key. Safe in the browser by design — it grants nothing on
  // its own; RLS and the session decide what it can reach. The service-role
  // key is its opposite and must never appear in this object.
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  appDomain: process.env.NEXT_PUBLIC_APP_DOMAIN ?? 'platform.com',
  /**
   * Mapbox public access token, for address autocomplete.
   *
   * This replaced `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. A `pk.` token is public by
   * design — the Search Box API is called from the browser and there is no
   * server-side variant, so the token is inlined into the bundle whichever way
   * it is supplied. Secrecy is not the control; restrict it by URL in the
   * Mapbox console, which is what stops it being spent by others.
   *
   * The literal below is the fallback rather than the value: setting
   * `NEXT_PUBLIC_MAPBOX_TOKEN` overrides it, which is how the token is rotated
   * without a code change. It is committed so that address autocomplete works
   * on a fresh checkout and on the live host without anyone opening the
   * hosting panel first — two panel actions are already outstanding
   * (STATE.md §5w) and this must not become a third.
   */
  mapboxToken:
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN ??
    '',
} as const;

export class MissingEnvError extends Error {
  constructor(name: string) {
    super(
      `Missing required environment variable "${name}". ` +
        'Copy .env.example to .env.local and fill it in.',
    );
    this.name = 'MissingEnvError';
  }
}

/** Reads a server-only variable, throwing a clear error when it is absent. */
export function requireServerEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new MissingEnvError(name);
  }
  return value;
}

/** Reads an optional server variable, falling back to `fallback`. */
export function serverEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value;
}

export const isProduction = process.env.NODE_ENV === 'production';
export const isDevelopment = process.env.NODE_ENV === 'development';
