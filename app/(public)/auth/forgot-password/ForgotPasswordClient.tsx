'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { OtpCodeInput } from '@/components/school/OtpCodeInput';
import { PasswordField } from '@/components/school/PasswordField';
import { useOtpCountdown } from '@/components/school/useOtpCountdown';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { validatePasswordStrength } from '@/lib/password-strength';
import { postAuth } from '@/lib/public-auth-client';
import { cn } from '@/lib/utils';

export interface ForgotPasswordClientProps {
  schoolName: string;
  locationId: string;
  schoolSlug: string | null;
}

type Step = 'email' | 'otp' | 'password';

const STEP_ORDER: readonly Step[] = ['email', 'otp', 'password'];
const STEP_LABELS: Record<Step, string> = {
  email: 'Your email',
  otp: 'Verify',
  password: 'New password',
};

/**
 * Password reset, three steps on one page.
 *
 * One page rather than three routes because the reset token only exists in
 * memory between steps two and three. Putting it in a URL would leave it in
 * browser history and in any Referer header the page sends, which for a
 * credential that sets a password is not a trade worth making for a back
 * button.
 *
 * Each step keeps the email that got it here, so going back never means typing
 * the address again.
 */
export function ForgotPasswordClient({
  schoolName,
  locationId,
  schoolSlug,
}: ForgotPasswordClientProps) {
  const router = useRouter();
  const { secondsLeft, canResend, start } = useOtpCountdown();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loginHref =
    schoolSlug === null || schoolSlug === ''
      ? '/login'
      : `/login?school=${encodeURIComponent(schoolSlug)}`;

  const sendCode = useCallback(async () => {
    setError(null);
    setNotice(null);

    if (email.trim() === '') {
      setError('Enter the email address on your account.');
      return;
    }

    setIsLoading(true);

    const result = await postAuth<{ message: string }>('/api/auth/forgot-password', {
      email: email.trim(),
      locationId,
    });

    setIsLoading(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setNotice(result.data.message);
    setOtp('');
    setStep('otp');
    start();
  }, [email, locationId, start]);

  const verifyCode = useCallback(
    async (code: string) => {
      setError(null);

      if (code.length !== 6) {
        setError('Enter the six-digit code.');
        return;
      }

      setIsLoading(true);

      const result = await postAuth<{ resetToken: string }>(
        '/api/auth/verify-forgot-otp',
        { email: email.trim(), otp: code, locationId },
      );

      setIsLoading(false);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setResetToken(result.data.resetToken);
      setNotice(null);
      setStep('password');
    },
    [email, locationId],
  );

  const submitPassword = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      // Checked here so the common mistakes are caught without a round trip.
      // The server checks both again; this is convenience, not enforcement.
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

      const result = await postAuth<{ message: string }>('/api/auth/reset-password', {
        email: email.trim(),
        resetToken,
        newPassword,
        confirmPassword,
        locationId,
      });

      if (!result.ok) {
        setError(result.message);
        setIsLoading(false);
        return;
      }

      // Deliberately not signed in: proving you can read an inbox should not
      // hand you a session, so the reset ends at the sign-in page.
      const separator = loginHref.includes('?') ? '&' : '?';
      router.replace(`${loginHref}${separator}reset=1`);
      router.refresh();
    },
    [newPassword, confirmPassword, email, resetToken, locationId, loginHref, router],
  );

  const banner =
    error !== null ? (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    ) : notice !== null ? (
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{notice}</p>
    ) : null;

  return (
    <div className="rounded-card border border-slate-200 bg-white p-6 shadow-card">
      <StepIndicator current={step} />

      {step === 'email' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void sendCode();
          }}
          className="mt-5 space-y-4"
          noValidate
        >
          <div>
            <h2 className="text-base font-semibold text-slate-900">Reset your password</h2>
            <p className="mt-1 text-sm text-slate-500">
              Enter the address you use for {schoolName} and we will email you a code.
            </p>
          </div>

          <Input
            label="Email address"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            placeholder="you@school.edu.pk"
            disabled={isLoading}
          />

          {banner}

          <Button type="submit" fullWidth isLoading={isLoading}>
            Send reset code
          </Button>

          <Link
            href={loginHref}
            className="block text-center text-sm text-slate-500 underline-offset-2 hover:underline"
          >
            Back to sign in
          </Link>
        </form>
      ) : null}

      {step === 'otp' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void verifyCode(otp);
          }}
          className="mt-5 space-y-4"
          noValidate
        >
          <div>
            <h2 className="text-base font-semibold text-slate-900">Enter your code</h2>
            <p className="mt-1 text-sm text-slate-500">
              We sent a six-digit code to {email}. It expires in 15 minutes.
            </p>
          </div>

          <OtpCodeInput
            value={otp}
            onChange={setOtp}
            onComplete={(code) => {
              void verifyCode(code);
            }}
            disabled={isLoading}
            autoFocus
          />

          {banner}

          <Button type="submit" fullWidth isLoading={isLoading}>
            Verify code
          </Button>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className="text-slate-500 underline-offset-2 hover:underline"
              disabled={isLoading}
              onClick={() => {
                setStep('email');
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
                void sendCode();
              }}
            >
              {canResend ? 'Resend code' : `Resend in ${secondsLeft}s`}
            </button>
          </div>
        </form>
      ) : null}

      {step === 'password' ? (
        <form
          onSubmit={(event) => {
            void submitPassword(event);
          }}
          className="mt-5 space-y-4"
          noValidate
        >
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Choose a new password
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              You will be signed out everywhere and asked to sign in again.
            </p>
          </div>

          <PasswordField
            label="New password"
            name="newPassword"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            showStrength
            autoFocus
            required
            disabled={isLoading}
          />

          <PasswordField
            label="Confirm new password"
            name="confirmPassword"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            required
            disabled={isLoading}
          />

          {banner}

          <Button type="submit" fullWidth isLoading={isLoading}>
            Update password
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function StepIndicator({ current }: { current: Step }) {
  const currentIndex = STEP_ORDER.indexOf(current);

  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {STEP_ORDER.map((step, index) => {
        const isDone = index < currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <li key={step} className="flex flex-1 flex-col gap-1.5">
            <span
              aria-hidden
              className={cn(
                'h-1 w-full rounded-full',
                isDone || isCurrent ? 'bg-brand-primary' : 'bg-slate-200',
              )}
            />
            <span
              className={cn(
                'text-xs',
                isCurrent ? 'font-medium text-slate-700' : 'text-slate-400',
              )}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {STEP_LABELS[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
