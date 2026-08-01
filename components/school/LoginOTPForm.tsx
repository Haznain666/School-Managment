'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  establishSession,
  useOtpCountdown,
} from '@/components/school/useOtpCountdown';
import { withSchoolParam } from '@/lib/school-client';
import { ROLE_HOME_ROUTES, isUserRole } from '@/types/school-auth';

export interface LoginOTPFormProps {
  schoolName: string;
  /** Carried into the post-login redirect so dev keeps its tenant. */
  schoolSlug: string | null;
}

type OtpChannel = 'whatsapp' | 'email';

interface RequestData {
  expiresIn: number;
  channel: OtpChannel;
  /** Masked phone or email, depending on which channel actually carried it. */
  maskedContact: string;
}

interface VerifyData {
  customToken: string;
  role: string;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

/**
 * Two-step sign-in: phone number, then the passcode sent over WhatsApp.
 *
 * There is no password anywhere in this flow. Possession of the registered
 * handset is the proof, which is also why these accounts have nothing to
 * reset or leak.
 */
export function LoginOTPForm({ schoolName, schoolSlug }: LoginOTPFormProps) {
  const router = useRouter();
  const { secondsLeft, canResend, start } = useOtpCountdown();

  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [maskedContact, setMaskedContact] = useState('');
  const [channel, setChannel] = useState<OtpChannel>('whatsapp');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendOtp = useCallback(
    async (isResend: boolean): Promise<void> => {
      setError(null);
      setIsLoading(true);

      try {
        // `withSchoolParam` carries `?school=` through. A relative URL drops the
        // page's query string, and middleware rewrites any /api/school/* request
        // it cannot resolve a tenant for to the /school-not-found *page* — so
        // without this the request comes back as HTML on a deployment host and
        // `response.json()` below throws into the catch, reporting a connection
        // problem for what is really a missing tenant. On a real subdomain the
        // hostname carries the tenant and this is a no-op.
        const response = await fetch(withSchoolParam('/api/school/auth/otp/request'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone.trim() }),
        });

        const payload = (await response.json()) as Envelope<RequestData>;

        if (!response.ok || payload.ok !== true || payload.data === undefined) {
          setError(payload.error?.message ?? 'Could not send the code.');
          return;
        }

        setMaskedContact(payload.data.maskedContact);
        setChannel(payload.data.channel);
        setStep('otp');
        if (isResend) setOtp('');
        start();
      } catch {
        setError('Could not send the code. Check your connection and try again.');
      } finally {
        setIsLoading(false);
      }
    },
    [phone, start],
  );

  const handlePhoneSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (phone.trim() === '') {
        setError('Enter your registered mobile number.');
        return;
      }

      await sendOtp(false);
    },
    [phone, sendOtp],
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
        // Same tenant-resolution requirement as the request step above.
        const response = await fetch(withSchoolParam('/api/school/auth/otp/verify'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone.trim(), otp: otp.trim() }),
        });

        const payload = (await response.json()) as Envelope<VerifyData>;

        if (!response.ok || payload.ok !== true || payload.data === undefined) {
          setError(payload.error?.message ?? 'Could not verify the code.');
          setIsLoading(false);
          return;
        }

        const session = await establishSession(payload.data.customToken, schoolSlug);

        if ('error' in session) {
          setError(session.error);
          setIsLoading(false);
          return;
        }

        const home = isUserRole(session.role)
          ? ROLE_HOME_ROUTES[session.role]
          : '/dashboard';

        router.replace(
          schoolSlug === null || schoolSlug === ''
            ? home
            : `${home}?school=${encodeURIComponent(schoolSlug)}`,
        );
        router.refresh();
      } catch {
        setError('Could not verify the code. Please try again.');
        setIsLoading(false);
      }
    },
    [otp, phone, schoolSlug, router],
  );

  const errorBanner =
    error === null ? null : (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );

  if (step === 'phone') {
    return (
      <form
        onSubmit={(event) => {
          void handlePhoneSubmit(event);
        }}
        className="space-y-4 rounded-card border border-slate-200 bg-white p-6 shadow-card"
        noValidate
      >
        <h2 className="text-base font-semibold text-slate-900">
          Sign in to {schoolName}
        </h2>

        <Input
          label="Mobile number"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          required
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
          }}
          placeholder="0300-1234567"
          hint="Enter your registered mobile number."
          disabled={isLoading}
        />

        {errorBanner}

        <Button type="submit" fullWidth isLoading={isLoading}>
          Send OTP to WhatsApp
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
        <h2 className="text-base font-semibold text-slate-900">Enter your OTP</h2>
        <p className="mt-1 text-sm text-slate-500">
          Sent to {maskedContact} via {channel === 'whatsapp' ? 'WhatsApp' : 'Email'}
        </p>
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
          // Digits only — a pasted code often carries stray spaces.
          setOtp(event.target.value.replace(/\D/g, ''));
        }}
        placeholder="------"
        className="text-center text-lg tracking-[0.5em]"
        disabled={isLoading}
      />

      {errorBanner}

      <Button type="submit" fullWidth isLoading={isLoading}>
        Verify OTP
      </Button>

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="text-slate-500 underline-offset-2 hover:underline"
          disabled={isLoading}
          onClick={() => {
            setStep('phone');
            setOtp('');
            setError(null);
          }}
        >
          Use a different number
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
