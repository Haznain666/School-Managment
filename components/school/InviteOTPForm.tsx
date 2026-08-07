'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  useOtpCountdown,
} from '@/components/school/useOtpCountdown';
import { ROLE_HOME_ROUTES, isUserRole } from '@/types/school-auth';

export interface InviteOTPFormProps {
  token: string;
  inviteeName: string;
  /** Already masked server-side — the full address never reaches the browser. */
  maskedEmail: string;
  schoolName: string;
  roleName: string;
  branchName: string | null;
  schoolSlug: string;
}

interface InitiateData {
  maskedEmail: string;
  expiresIn: number;
}

interface AcceptData {
  role: string;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

/**
 * Two-step signup: confirm your name, then the code emailed to you.
 *
 * The address is fixed by the invitation and never editable here — whoever
 * holds the link cannot point the code at an inbox of their own. It used to be
 * a phone number and a WhatsApp message; since Stage 4 the address is the
 * identity the account is created against, so proving the handset proved the
 * wrong thing.
 */
export function InviteOTPForm({
  token,
  inviteeName,
  maskedEmail,
  schoolName,
  roleName,
  branchName,
  schoolSlug,
}: InviteOTPFormProps) {
  const router = useRouter();
  const { secondsLeft, canResend, start } = useOtpCountdown();

  const [step, setStep] = useState<'details' | 'otp'>('details');
  const [name, setName] = useState(inviteeName);
  const [sentTo, setSentTo] = useState(maskedEmail);
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendOtp = useCallback(
    async (isResend: boolean): Promise<void> => {
      setError(null);
      setIsLoading(true);

      try {
        const response = await fetch(
          `/api/school/invitations/${token}/accept/initiate`,
          { method: 'POST' },
        );

        const payload = (await response.json()) as Envelope<InitiateData>;

        if (!response.ok || payload.ok !== true || payload.data === undefined) {
          setError(payload.error?.message ?? 'Could not send the code.');
          return;
        }

        setSentTo(payload.data.maskedEmail);
        setStep('otp');
        if (isResend) setOtp('');
        start();
      } catch {
        setError('Could not send the code. Check your connection and try again.');
      } finally {
        setIsLoading(false);
      }
    },
    [token, start],
  );

  const handleDetailsSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (name.trim() === '') {
        setError('Enter your full name.');
        return;
      }

      await sendOtp(false);
    },
    [name, sendOtp],
  );

  const handleOtpSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      if (otp.trim().length !== 6) {
        setError('Enter the six-digit code.');
        return;
      }

      setIsLoading(true);

      try {
        const response = await fetch(`/api/school/invitations/${token}/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), otp: otp.trim() }),
        });

        const payload = (await response.json()) as Envelope<AcceptData>;

        if (!response.ok || payload.ok !== true || payload.data === undefined) {
          setError(payload.error?.message ?? 'Could not complete your setup.');
          setIsLoading(false);
          return;
        }

        // The cookie is already set on the response above. The fallback that
        // used to send a failed auto-sign-in to /login is gone with it: there
        // is no separate sign-in step left to fail.
        const home = isUserRole(payload.data.role)
          ? ROLE_HOME_ROUTES[payload.data.role]
          : '/dashboard';

        router.replace(`${home}?school=${encodeURIComponent(schoolSlug)}`);
        router.refresh();
      } catch {
        setError('Could not complete your setup. Please try again.');
        setIsLoading(false);
      }
    },
    [otp, name, token, schoolSlug, router],
  );

  const errorBanner =
    error === null ? null : (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );

  if (step === 'details') {
    return (
      <form
        onSubmit={(event) => {
          void handleDetailsSubmit(event);
        }}
        className="space-y-4 rounded-card border border-slate-200 bg-white p-6 shadow-card"
        noValidate
      >
        <div>
          <p className="text-sm text-slate-600">
            You have been invited to join <strong>{schoolName}</strong> as{' '}
            <strong>{roleName}</strong>.
          </p>
          {branchName !== null ? (
            <p className="mt-1 text-sm text-slate-500">Branch: {branchName}</p>
          ) : null}
        </div>

        <Input
          label="Full name"
          name="name"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          disabled={isLoading}
        />

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          A code will be sent to {sentTo}.
        </p>

        {errorBanner}

        <Button type="submit" fullWidth isLoading={isLoading}>
          Email me a code
        </Button>
      </form>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        void handleOtpSubmit(event);
      }}
      className="space-y-4 rounded-card border border-slate-200 bg-white p-6 shadow-card"
      noValidate
    >
      <div>
        <h2 className="text-base font-semibold text-slate-900">Enter your code</h2>
        <p className="mt-1 text-sm text-slate-500">Sent to {sentTo}</p>
      </div>

      <Input
        label="Six-digit code"
        name="otp"
        type="tel"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        required
        value={otp}
        onChange={(event) => {
          setOtp(event.target.value.replace(/\D/g, ''));
        }}
        placeholder="------"
        className="text-center text-lg tracking-[0.5em]"
        disabled={isLoading}
      />

      {errorBanner}

      <Button type="submit" fullWidth isLoading={isLoading}>
        Complete setup
      </Button>

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="text-slate-500 underline-offset-2 hover:underline"
          disabled={isLoading}
          onClick={() => {
            setStep('details');
            setOtp('');
            setError(null);
          }}
        >
          Back
        </button>

        <button
          type="button"
          className="text-brand-primary underline-offset-2 hover:underline disabled:text-slate-400 disabled:no-underline"
          disabled={!canResend || isLoading}
          onClick={() => {
            void sendOtp(true);
          }}
        >
          {canResend ? 'Resend code' : `Resend in ${secondsLeft}s`}
        </button>
      </div>
    </form>
  );
}
