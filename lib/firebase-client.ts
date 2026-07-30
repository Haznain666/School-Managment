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
  storageBucket: process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'] ?? '',
  messagingSenderId: process.env['NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'] ?? '',
  appId: process.env['NEXT_PUBLIC_FIREBASE_APP_ID'] ?? '',
} as const;

export function isFirebaseClientConfigured(): boolean {
  return firebaseConfig.apiKey !== '' && firebaseConfig.projectId !== '';
}

export function getFirebaseClientApp(): FirebaseApp {
  if (typeof window === 'undefined') {
    throw new Error(
      'lib/firebase-client.ts is browser-only. Use lib/firebase-admin.ts on the server.',
    );
  }

  if (!isFirebaseClientConfigured()) {
    throw new Error(
      'Firebase is not configured. Set the NEXT_PUBLIC_FIREBASE_* variables.',
    );
  }

  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

export function getFirebaseClientAuth(): Auth {
  return getAuth(getFirebaseClientApp());
}
