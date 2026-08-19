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
   * ── Why there is no committed fallback ───────────────────────────────
   * There was one, briefly. GitHub push protection refused the push: this
   * repository is **public**, and a live token sitting in it is scraped whether
   * or not the token is technically a secret. The original argument for
   * committing it — that address search would then work without anyone opening
   * the hosting panel — stopped holding the moment unblocking the push became
   * an action of its own. One action either way, so it is the safer one.
   *
   * Absent, this resolves to `''` and every address field degrades to the plain
   * text input it has always been, saying in one line why there is no search.
   * That path is deliberate and tested (`UC-APF-19`); nothing breaks.
   */
  mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '',
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
