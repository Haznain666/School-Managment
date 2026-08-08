'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { PasswordField } from '@/components/school/PasswordField';
import { useOtpCountdown } from '@/components/school/useOtpCountdown';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { isValidEmail, validatePasswordStrength } from '@/lib/password-strength';
import { withSchoolParam } from '@/lib/school-client';

export interface EmailLoginFormProps {
  schoolName: string;
  /** Carried into the post-login redirect so dev keeps its tenant. */
  schoolSlug: string | null;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

/**
 * School sign-in: email and password, with a code-based path for people who
 * do not have a password yet.
 *
 * ── Why one component and not three screens ──────────────────────────────
 * "First time here" and "forgot my password" are the same three steps —
 * request a code, enter it, choose a password — and they end where signing in
 * ends. Splitting them into separate routes meant the browser navigating twice
 * mid-flow, and a back button that lands on a step whose code has already been
 * spent. Here the whole thing is one form with a `step`, so leaving it is a
 * deliberate act rather than an accident of history.
 *
 * ── What replaced the WhatsApp passcode ──────────────────────────────────
 * This is the successor to `LoginOTPForm`, which asked for a mobile number and
 * sent a passcode over WhatsApp. Nothing about the shape survived: possession
 * of a handset is no longer the proof, and there is now a password to hold.
 * What did survive is `useOtpCountdown`, because a resend still must not be
 * spammable.
 *
 * ── The session is already set by the time these calls return ────────────
 * Every route below writes the session cookie onto its own response, so there
 * is no separate "sign in" step for the browser to do and nothing to hold in
 * component state. Success means the cookie is there; the redirect is all
 * that is left.
 *
 * ── Every step's form carries `method="post"` ────────────────────────────
 * Including the ones that only collect an email. A form with no method
 * natively submits as **GET** when it is submitted before React has hydrated
 * — pressing Enter while the route is still compiling, or any time hydration
 * fails — and GET puts every named field in the query string. That is not
 * hypothetical: it is exactly how a password reached a server access log
 * through the Super Admin sign-in form, in the URL, in browser history, and
 * in any Referer this page emits. With POST the same pre-hydration submit
 * sends a body to a page route that refuses POST, so it fails visibly and
 * harmlessly, and credentials never touch a URL.
 */
export function EmailLoginForm({ schoolName, schoolSlug }: EmailLoginFormProps) {
  const router = useRouter();
  const { secondsLeft, canResend, start } = useOtpCountdown();

  const [step, setStep] = useState<'password' | 'request-code' | 'code' | 'set-password'>(
    'password',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Where every successful path ends. The role decides which portal. */
  const goHome = useCallback(
    (redirectTo: string) => {
      router.replace(
        schoolSlug === null || schoolSlug === ''
          ? redirectTo
          : `${redirectTo}?school=${encodeURIComponent(schoolSlug)}`,
      );
      router.refresh();
    },
    [router, schoolSlug],
  );

  /**
   * `withSchoolParam` carries `?school=` through. A relative URL drops the
   * page's query string, and middleware rewrites any /api/school/* request it
   * cannot resolve a tenant for to the /school-not-found *page* — so without
   * this the request comes back as HTML on a deployment host and
   * `response.json()` throws into the catch, reporting a connection problem
   * for what is really a missing tenant. On a real subdomain the hostname
   * carries the tenant and this is a no-op.
   */
  const post = useCallback(
    async <T,>(path: string, body: unknown): Promise<T | null> => {
      const response = await fetch(withSchoolParam(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as Envelope<T>;

      if (!response.ok || payload.ok !== true || payload.data === undefined) {
        setError(payload.error?.message ?? 'Something went wrong.');
        return null;
      }

      return payload.data;
    },
    [],
  );

  const handlePasswordSignIn = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setNotice(null);

      if (!isValidEmail(email.trim())) {
        setError('Enter a valid email address.');
        return;
      }
      if (password === '') {
        setError('Enter your password.');
        return;
      }

      setIsLoading(true);

      try {
        const data = await post<{ role: string; redirectTo: string }>(
          '/api/school/auth/login',
          { email: email.trim(), password },
        );

        if (data === null) return;
        goHome(data.redirectTo);
      } catch {
        setError('Could not sign you in. Check your connection and try again.');
      } finally {
        setIsLoading(false);
      }
    },
    [email, password, post, goHome],
  );

  const sendCode = useCallback(
    async (isResend: boolean): Promise<void> => {
      setError(null);
      setIsLoading(true);

      try {
        const data = await post<{ sent: boolean }>('/api/school/auth/otp/request', {
          email: email.trim(),
        });

        if (data === null) return;

        // ── On the wording ────────────────────────────────────────────────
        // "If that address belongs to a member" is not politeness. The server
        // answers identically whether or not the address is one of this
        // school's, so that nobody can enumerate the staff list from the login
        // page — and this sentence is the only honest description of what
        // just happened.
        setNotice(
          `If that address belongs to a member of ${schoolName}, a six-digit code is on its way.`,
        );
        setStep('code');
        if (isResend) setCode('');
        start();
      } catch {
        setError('Could not send the code. Check your connection and try again.');
      } finally {
        setIsLoading(false);
      }
    },
    [email, post, schoolName, start],
  );

  const handleRequestCode = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      if (!isValidEmail(email.trim())) {
        setError('Enter a valid email address.');
        return;
      }

      await sendCode(false);
    },
    [email, sendCode],
  );

  const handleVerifyCode = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setNotice(null);

      if (code.trim().length !== 6) {
        setError('Enter the six-digit code.');
        return;
      }

      setIsLoading(true);

      try {
        const data = await post<{ verified: boolean }>(
          '/api/school/auth/otp/verify',
          { email: email.trim(), code: code.trim() },
        );

        if (data === null) return;

        // The session exists from here on. Choosing a password is the last
        // step, not a gate — which is why it is a separate step rather than a
        // second field on this one.
        setStep('set-password');
      } catch {
        setError('Could not verify the code. Please try again.');
      } finally {
        setIsLoading(false);
      }
    },
    [code, email, post],
  );

  const handleSetPassword = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      const strength = validatePasswordStrength(newPassword);
      if (!strength.valid) {
        setError(strength.error ?? 'Choose a stronger password.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('The two passwords do not match.');
        return;
      }

      setIsLoading(true);

      try {
        const data = await post<{ redirectTo: string }>('/api/school/auth/password', {
          password: newPassword,
        });

        if (data === null) return;
        goHome(data.redirectTo);
      } catch {
        setError('Could not save your password. Please try again.');
      } finally {
        setIsLoading(false);
      }
    },
    [newPassword, confirmPassword, post, goHome],
  );

  const banner =
    error !== null ? (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    ) : notice !== null ? (
      <p role="status" className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
        {notice}
      </p>
    ) : null;

  const formClass =
    'space-y-4 rounded-card border border-slate-200 bg-white p-6 shadow-card';

  if (step === 'password') {
    return (
      <form
        method="post"
        onSubmit={(event) => {
          void handlePasswordSignIn(event);
        }}
        className={formClass}
        noValidate
      >
        <h2 className="text-base font-semibold text-slate-900">
          Sign in to {schoolName}
        </h2>

        <Input
          label="Email address"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          placeholder="you@example.com"
          disabled={isLoading}
        />

        <PasswordField
          label="Password"
          name="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
          disabled={isLoading}
        />

        {banner}

        <Button type="submit" fullWidth isLoading={isLoading}>
          Sign in
        </Button>

        <button
          type="button"
          className="block w-full text-center text-sm text-brand-primary underline-offset-2 hover:underline"
          disabled={isLoading}
          onClick={() => {
            setError(null);
            setPassword('');
            setStep('request-code');
          }}
        >
          First time here, or forgotten your password?
        </button>
      </form>
    );
  }

  if (step === 'request-code') {
    return (
      <form
        method="post"
        onSubmit={(event) => {
          void handleRequestCode(event);
        }}
        className={formClass}
        noValidate
      >
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Set up or reset your password
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            We will email you a six-digit code to confirm it is you.
          </p>
        </div>

        <Input
          label="Email address"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoFocus
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          placeholder="you@example.com"
          hint="Use the address your school invited you on."
          disabled={isLoading}
        />

        {banner}

        <Button type="submit" fullWidth isLoading={isLoading}>
          Email me a code
        </Button>

        <button
          type="button"
          className="block w-full text-center text-sm text-slate-500 underline-offset-2 hover:underline"
          disabled={isLoading}
          onClick={() => {
            setError(null);
            setStep('password');
          }}
        >
          Back to sign in
        </button>
      </form>
    );
  }

  if (step === 'code') {
    return (
      <form
        method="post"
        onSubmit={(event) => {
          void handleVerifyCode(event);
        }}
        className={formClass}
        noValidate
      >
        <div>
          <h2 className="text-base font-semibold text-slate-900">Enter your code</h2>
          <p className="mt-1 text-sm text-slate-500">Sent to {email.trim()}</p>
        </div>

        <Input
          label="Six-digit code"
          name="code"
          type="tel"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          required
          value={code}
          onChange={(event) => {
            // Digits only — a pasted code often carries stray spaces.
            setCode(event.target.value.replace(/\D/g, ''));
          }}
          placeholder="------"
          className="text-center text-lg tracking-[0.5em]"
          disabled={isLoading}
        />

        {banner}

        <Button type="submit" fullWidth isLoading={isLoading}>
          Continue
        </Button>

        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="text-slate-500 underline-offset-2 hover:underline"
            disabled={isLoading}
            onClick={() => {
              setError(null);
              setNotice(null);
              setCode('');
              setStep('request-code');
            }}
          >
            Use a different address
          </button>

          <button
            type="button"
            className="text-brand-primary underline-offset-2 hover:underline disabled:text-slate-400 disabled:no-underline"
            disabled={!canResend || isLoading}
            onClick={() => {
              void sendCode(true);
            }}
          >
            {canResend ? 'Resend code' : `Resend in ${secondsLeft}s`}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      method="post"
      onSubmit={(event) => {
        void handleSetPassword(event);
      }}
      className={formClass}
      noValidate
    >
      <div>
        <h2 className="text-base font-semibold text-slate-900">Choose a password</h2>
        <p className="mt-1 text-sm text-slate-500">
          You are signed in. Set a password and you will use it from now on.
        </p>
      </div>

      <PasswordField
        label="New password"
        name="newPassword"
        value={newPassword}
        onChange={setNewPassword}
        showStrength
        autoComplete="new-password"
        autoFocus
        required
        disabled={isLoading}
      />

      <PasswordField
        label="Confirm password"
        name="confirmPassword"
        value={confirmPassword}
        onChange={setConfirmPassword}
        autoComplete="new-password"
        required
        disabled={isLoading}
      />

      {banner}

      <Button type="submit" fullWidth isLoading={isLoading}>
        Save and continue
      </Button>
    </form>
  );
}
