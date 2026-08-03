'use client';

/**
 * Firebase CLIENT SDK — browser only.
 *
 * Its single job in this application is to exchange an email and password for
 * an ID token. That token is posted to `/api/school/auth/session`, which swaps
 * it for an httpOnly session cookie; the browser never stores a credential it
 * can read.
 *
 * Initialisation is lazy because this module is imported by components that
 * Next.js also renders on the server, where `initializeApp` would throw on the
 * absent public config.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env['NEXT_PUBLIC_FIREBASE_API_KEY'] ?? '',
  authDomain: process.env['NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'] ?? '',
  projectId: process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID'] ?? '',
  messagingSenderId: process.env['NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'] ?? '',
  appId: process.env['NEXT_PUBLIC_FIREBASE_APP_ID'] ?? '',
} as const;

export function isFirebaseClientConfigured(): boolean {
  return firebaseConfig.apiKey !== '' && firebaseConfig.projectId !== '';
}

/**
 * Which of the browser variables are absent from this bundle.
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, not read at runtime — so
 * an empty one here means it was missing from the environment when the bundle
 * was compiled, and adding it to the host now changes nothing until a rebuild.
 * That distinction is the whole reason this list exists: naming the variables
 * is not enough, the message has to say when they are read.
 */
export function missingFirebaseClientKeys(): string[] {
  const required: ReadonlyArray<[string, string]> = [
    ['NEXT_PUBLIC_FIREBASE_API_KEY', firebaseConfig.apiKey],
    ['NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', firebaseConfig.authDomain],
    ['NEXT_PUBLIC_FIREBASE_PROJECT_ID', firebaseConfig.projectId],
    ['NEXT_PUBLIC_FIREBASE_APP_ID', firebaseConfig.appId],
  ];

  return required.filter(([, value]) => value === '').map(([name]) => name);
}

export function getFirebaseClientApp(): FirebaseApp {
  if (typeof window === 'undefined') {
    throw new Error(
      'lib/firebase-client.ts is browser-only. Use lib/firebase-admin.ts on the server.',
    );
  }

  if (!isFirebaseClientConfigured()) {
    const missing = missingFirebaseClientKeys();
    throw new Error(
      'Firebase browser configuration is missing from this build: ' +
        `${missing.join(', ')}. These are inlined at build time, so set them ` +
        'on the host and redeploy — adding them without rebuilding has no effect.',
    );
  }

  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

export function getFirebaseClientAuth(): Auth {
  return getAuth(getFirebaseClientApp());
}
