'use client';

import { useCallback, useEffect, useState } from 'react';

/** Seconds a user must wait before a passcode can be resent. */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Countdown that gates the "resend" control.
 *
 * The cooldown is a courtesy to the person waiting — a second code invalidates
 * the first, so tapping resend repeatedly would leave them entering a code
 * that has already been superseded.
 */
export function useOtpCountdown(): {
  secondsLeft: number;
  canResend: boolean;
  start: () => void;
} {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) return;

    const timer = setTimeout(() => {
      setSecondsLeft((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => {
      clearTimeout(timer);
    };
  }, [secondsLeft]);

  const start = useCallback(() => {
    setSecondsLeft(RESEND_COOLDOWN_SECONDS);
  }, []);

  return { secondsLeft, canResend: secondsLeft <= 0, start };
}

/** Exchanges a Firebase custom token for a server session cookie. */
export async function establishSession(
  customToken: string,
  schoolSlug: string | null,
): Promise<{ role: string } | { error: string }> {
  const { signInWithCustomToken } = await import('firebase/auth');
  const { getFirebaseClientAuth } = await import('@/lib/firebase-client');

  const auth = getFirebaseClientAuth();

  try {
    const credential = await signInWithCustomToken(auth, customToken);
    // Force-refresh so the claims minted moments ago are present rather than
    // served from a cached token.
    const idToken = await credential.user.getIdToken(true);

    const query =
      schoolSlug === null || schoolSlug === ''
        ? ''
        : `?school=${encodeURIComponent(schoolSlug)}`;

    const response = await fetch(`/api/school/auth/session${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: { role: string };
      error?: { message: string };
    };

    if (!response.ok || payload.ok !== true || payload.data === undefined) {
      return { error: payload.error?.message ?? 'Could not start your session.' };
    }

    return { role: payload.data.role };
  } catch {
    return { error: 'Could not start your session. Please try again.' };
  }
}
