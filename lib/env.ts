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
