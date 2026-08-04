'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { OtpCodeInput } from '@/components/school/OtpCodeInput';
import { PasswordField } from '@/components/school/PasswordField';
import { useOtpCountdown } from '@/components/school/useOtpCountdown';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { postAuth } from '@/lib/public-auth-client';
import { cn } from '@/lib/utils';

export interface EmailLoginFormProps {
  schoolName: string;
  /** GHL Location ID, for deployments where no subdomain carries the tenant. */
  locationId: string;
  /** Carried into the post-login redirect so dev keeps its tenant. */
  schoolSlug: string | null;
}

type Tab = 'password' | 'otp';

interface LoginData {
  redirect: string;
  role: string;
  name: string;
  mustChangePassword?: boolean;
}

/**
 * Sign-in: email and password, or a one-time code to the same inbox.
 *
 * Both tabs end at the same place — an httpOnly session cookie set by the
 * server on the response to a single request. The browser never handles a
 * token, which is why there is no Firebase client work here at all, unlike the
 * WhatsApp flow this replaces.
 *
 * `router.replace` rather than `push`: the sign-in page must not be reachable
 * with the back button once a session exists.
 */
export function EmailLoginForm({
  schoolName,
  locationId,
  schoolSlug,
}: EmailLoginFormProps) {
  const router = useRouter();
  const { secondsLeft, canResend, start } = useOtpCountdown();

  const [tab, setTab] = useState<Tab>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const goToPortal = useCallback(
    (destination: string) => {
      router.replace(
        schoolSlug === null || schoolSlug === ''
          ? destination
          : `${destination}?school=${encodeURIComponent(schoolSlug)}`,
      );
      router.refresh();
    },
    [router, schoolSlug],
  );

  const switchTab = useCallback((next: Tab) => {
    setTab(next);
    setError(null);
    setNotice(null);
    setOtp('');
    setOtpSent(false);
  }, []);

  const handlePasswordSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      if (email.trim() === '' || password === '') {
        setError('Enter your email address and password.');
        return;
      }

      setIsLoading(true);

      const result = await postAuth<LoginData>('/api/auth/login/email', {
        email: email.trim(),
        password,
        locationId,
      });

      if (!result.ok) {
        setError(result.message);
        setIsLoading(false);
        return;
      }

      goToPortal(result.data.redirect);
    },
    [email, password, locationId, goToPortal],
  );

  const sendOtp = useCallback(async () => {
    setError(null);
    setNotice(null);

    if (email.trim() === '') {
      setError('Enter your email address.');
      return;
    }

    setIsLoading(true);

    const result = await postAuth<{ message: string }>('/api/auth/send-otp-email', {
      email: email.trim(),
      locationId,
    });

    setIsLoading(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setOtpSent(true);
    setOtp('');
    setNotice(result.data.message);
    start();
  }, [email, locationId, start]);

  const verifyOtp = useCallback(
    async (code: string) => {
      setError(null);

      if (code.length !== 6) {
        setError('Enter the six-digit code.');
        return;
      }

      setIsLoading(true);

      const result = await postAuth<LoginData>('/api/auth/verify-otp-email', {
        email: email.trim(),
        otp: code,
        locationId,
      });

      if (!result.ok) {
        setError(result.message);
        setIsLoading(false);
        return;
      }

      goToPortal(result.data.redirect);
    },
    [email, locationId, goToPortal],
  );

  const banner =
    error !== null ? (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    ) : notice !== null ? (
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{notice}</p>
    ) : null;

  const forgotHref =
    schoolSlug === null || schoolSlug === ''
      ? '/auth/forgot-password'
      : `/auth/forgot-password?school=${encodeURIComponent(schoolSlug)}`;

  return (
    <div className="rounded-card border border-slate-200 bg-white p-6 shadow-card">
      <h2 className="text-base font-semibold text-slate-900">Sign in to {schoolName}</h2>

      <div
        role="tablist"
        aria-label="Sign-in method"
        className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"
      >
        <TabButton
          isActive={tab === 'password'}
          label="Password"
          onSelect={() => {
            switchTab('password');
          }}
        />
        <TabButton
          isActive={tab === 'otp'}
          label="Email code"
          onSelect={() => {
            switchTab('otp');
          }}
        />
      </div>

      {tab === 'password' ? (
        <form
          onSubmit={(event) => {
            void handlePasswordSubmit(event);
          }}
          className="mt-5 space-y-4"
          noValidate
        >
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
            placeholder="you@school.edu.pk"
            disabled={isLoading}
          />

          <PasswordField
            label="Password"
            name="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={isLoading}
            required
          />

          {banner}

          <Button type="submit" fullWidth isLoading={isLoading}>
            Sign in
          </Button>

          <div className="flex items-center justify-between text-sm">
            <Link
              href={forgotHref}
              className="text-brand-primary underline-offset-2 hover:underline"
            >
              Forgot password?
            </Link>

            <button
              type="button"
              className="text-slate-500 underline-offset-2 hover:underline"
              onClick={() => {
                switchTab('otp');
              }}
            >
              Sign in with an email code
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (otpSent) {
              void verifyOtp(otp);
            } else {
              void sendOtp();
            }
          }}
          className="mt-5 space-y-4"
          noValidate
        >
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
            placeholder="you@school.edu.pk"
            hint={otpSent ? undefined : 'We will email you a six-digit code.'}
            disabled={isLoading || otpSent}
          />

          {otpSent ? (
            <OtpCodeInput
              value={otp}
              onChange={setOtp}
              onComplete={(code) => {
                void verifyOtp(code);
              }}
              disabled={isLoading}
              autoFocus
            />
          ) : null}

          {banner}

          <Button type="submit" fullWidth isLoading={isLoading}>
            {otpSent ? 'Verify and sign in' : 'Email me a code'}
          </Button>

          {otpSent ? (
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className="text-slate-500 underline-offset-2 hover:underline"
                disabled={isLoading}
                onClick={() => {
                  setOtpSent(false);
                  setOtp('');
                  setError(null);
                  setNotice(null);
                }}
              >
                Use a different address
              </button>

              <button
                type="button"
                className="text-brand-primary underline-offset-2 hover:underline disabled:text-slate-400 disabled:no-underline"
                disabled={!canResend || isLoading}
                onClick={() => {
                  void sendOtp();
                }}
              >
                {canResend ? 'Resend code' : `Resend in ${secondsLeft}s`}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="block w-full text-center text-sm text-slate-500 underline-offset-2 hover:underline"
              onClick={() => {
                switchTab('password');
              }}
            >
              Sign in with a password instead
            </button>
          )}
        </form>
      )}
    </div>
  );
}

function TabButton({
  isActive,
  label,
  onSelect,
}: {
  isActive: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onSelect}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium transition',
        isActive
          ? 'bg-white text-slate-900 shadow-sm'
          : 'text-slate-500 hover:text-slate-700',
      )}
    >
      {label}
    </button>
  );
}

/* WHATSAPP_DISABLED_START */
// WhatsApp auth temporarily disabled - re-enable when Meta template approved
//
// The phone + WhatsApp OTP sign-in this replaces lives in
// `components/school/LoginOTPForm.tsx`, untouched and still exported. To bring
// it back: restore `lib/otp-sender.ts` and `app/api/school/auth/otp/request`,
// then render <LoginOTPForm /> from `app/(public)/login/page.tsx` again — as a
// third tab beside these two, most likely, since a school with a password
// system has no reason to give up the channel its parents actually read.
/* WHATSAPP_DISABLED_END */
