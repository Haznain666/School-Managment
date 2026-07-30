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
  firebase: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? '',
  },
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
