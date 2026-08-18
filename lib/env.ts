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
   * Google Maps JavaScript API key, for the address location picker.
   *
   * Optional, and the picker is built to be absent-tolerant: with no key the
   * address field is a plain text input and says so. A map key is a billed
   * third-party account, and a school profile form must not stop working
   * because nobody has opened one yet.
   *
   * Public by necessity — the Maps JS API is loaded by the browser and there is
   * no server-side variant of it. Restrict it by HTTP referrer in the Google
   * Cloud console; that, not secrecy, is what stops it being spent by others.
   */
  googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
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
