'use client';

/**
 * Firebase CLIENT SDK — browser only (CRITICAL RULE #8).
 *
 * Initialisation is lazy and deliberately so: this module is imported by
 * components that Next.js also renders on the server during prerender, and
 * `initializeApp` throws there when the public config is absent. Nothing is
 * created until a browser actually asks for it.
 *
 * Never import this from a server component, route handler or middleware —
 * use `lib/firebase-admin.ts` there.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';

import { publicEnv } from './env';

const firebaseConfig = {
  apiKey: publicEnv.firebase.apiKey,
  authDomain: publicEnv.firebase.authDomain,
  projectId: publicEnv.firebase.projectId,
  messagingSenderId: publicEnv.firebase.messagingSenderId,
  appId: publicEnv.firebase.appId,
  databaseURL: publicEnv.firebase.databaseURL,
} as const;

/** True when the public Firebase config was actually supplied. */
export function isFirebaseConfigured(): boolean {
  return firebaseConfig.apiKey !== '' && firebaseConfig.projectId !== '';
}

/**
 * Next.js re-evaluates modules across HMR reloads, so reuse the existing app
 * instance rather than calling initializeApp twice.
 */
export function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error(
      'Firebase is not configured. Set the NEXT_PUBLIC_FIREBASE_* variables in .env.local.',
    );
  }
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

/** Email/password authentication. ID tokens carry the tenant custom claims. */
export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

/** Notifications and live sessions — see database.rules.json. */
export function getFirebaseDatabase(): Database {
  return getDatabase(getFirebaseApp());
}
