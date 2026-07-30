'use client';

import { onIdTokenChanged, type User } from 'firebase/auth';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { parseUserClaims, type UserClaims } from '@/lib/claims';
import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/firebase';

/**
 * Client-side auth state.
 *
 * Claims are read from the Firebase ID token, which is signed by Firebase and
 * therefore trustworthy for *display and routing*. It is not an authorisation
 * decision: every API call sends the raw token and the server re-verifies it in
 * `withAuth()`. Nothing here is load-bearing for data access.
 */

export interface AuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  user: User | null;
  claims: UserClaims | null;
  /** Returns a fresh ID token for the `Authorization` header, or null. */
  getToken: (forceRefresh?: boolean) => Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<UserClaims | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');

  useEffect(() => {
    // Runs in the browser only, which is where Firebase is initialised.
    if (!isFirebaseConfigured()) {
      console.warn('[auth] Firebase is not configured; sign-in is unavailable.');
      setStatus('unauthenticated');
      return;
    }

    // onIdTokenChanged (not onAuthStateChanged) so that a claims refresh —
    // e.g. after a role change — propagates without a reload.
    const unsubscribe = onIdTokenChanged(getFirebaseAuth(), (nextUser) => {
      if (nextUser === null) {
        setUser(null);
        setClaims(null);
        setStatus('unauthenticated');
        return;
      }

      void nextUser
        .getIdTokenResult()
        .then((result) => {
          setUser(nextUser);
          setClaims(parseUserClaims(result.claims as Record<string, unknown>));
          setStatus('authenticated');
        })
        .catch(() => {
          setUser(null);
          setClaims(null);
          setStatus('unauthenticated');
        });
    });

    return unsubscribe;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      claims,
      getToken: async (forceRefresh = false) => {
        if (!isFirebaseConfigured()) return null;
        const current = getFirebaseAuth().currentUser;
        return current === null ? null : current.getIdToken(forceRefresh);
      },
    }),
    [status, user, claims],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used inside an <AuthProvider>.');
  }
  return context;
}
