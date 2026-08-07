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

/**
 * `establishSession` used to live here.
 *
 * It signed the browser in with a Firebase custom token, force-refreshed the
 * ID token so freshly-minted claims were present, and POSTed it to
 * `/api/school/auth/session` to be traded for a cookie. All three hops are
 * gone: GoTrue verifies the credential server-side and the route that mints
 * the session writes the cookie onto its own response.
 *
 * Callers now read the role straight out of the response they already made.
 */
