'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { OtpCodeInput } from '@/components/school/OtpCodeInput';
import { PasswordField } from '@/components/school/PasswordField';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { validatePasswordStrength } from '@/lib/password-strength';
import { postAuth } from '@/lib/public-auth-client';

export interface VerifyInvitationClientProps {
  schoolName: string;
  locationId: string;
  schoolSlug: string | null;
  /** From the invitation link. Both are needed; neither is enough alone. */
  token: string;
  email: string;
}

type Step = 'otp' | 'password';

/**
 * Accepting an invitation: prove the code, then choose a password.
 *
 * The address is read-only. It is what the invitation was issued against and
 * what the token is checked against server-side, so letting it be edited would
 * only produce a confident-looking failure.
 *
 * Setting the password signs the person in — unlike a reset, where the same
 * pair of steps deliberately ends at the sign-in page. The difference is who
 * they are: an invitee has just proved possession of the inbox the invitation
 * was sent to and has no other credential to try, and sending them to a login
 * form to type the password they chose four seconds ago is friction with
 * nothing behind it.
 */
export function VerifyInvitationClient({
  schoolName,
  locationId,
  schoolSlug,
  token,
  email,
}: VerifyInvitationClientProps) {
  const router = useRouter();

  const [step, setStep] = useState<Step>('otp');
  const [otp, setOtp] = useState('');
  const [verifiedToken, setVerifiedToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const verifyCode = useCallback(
    async (code: string) => {
      setError(null);

      if (code.length !== 6) {
        setError('Enter the six-digit code.');
        return;
      }

      setIsLoading(true);

      const result = await postAuth<{ token: string }>('/api/auth/verify-invitation', {
        token,
        email,
        otp: code,
        locationId,
      });

      setIsLoading(false);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setVerifiedToken(result.data.token);
      setStep('password');
    },
    [token, email, locationId],
  );

  const submitPassword = useCallback(
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

      const result = await postAuth<{ redirect: string }>('/api/auth/set-password', {
        token: verifiedToken,
        email,
        newPassword,
        confirmPassword,
        locationId,
      });

      if (!result.ok) {
        setError(result.message);
        setIsLoading(false);
        return;
      }

      // The portal is a path from the server; the tenant and the welcome flag
      // are ours to add. Built through URL rather than by concatenation so the
      // separator is right whatever the server sent back.
      const destination = new URL(result.data.redirect, window.location.origin);
      if (schoolSlug !== null && schoolSlug !== '') {
        destination.searchParams.set('school', schoolSlug);
      }
      destination.searchParams.set('welcome', '1');

      router.replace(`${destination.pathname}${destination.search}`);
      router.refresh();
    },
    [newPassword, confirmPassword, verifiedToken, email, locationId, schoolSlug, router],
  );

  const banner =
    error === null ? null : (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );

  return (
    <div className="rounded-card border border-slate-200 bg-white p-6 shadow-card">
      {step === 'otp' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void verifyCode(otp);
          }}
          className="space-y-4"
          noValidate
        >
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Welcome to {schoolName}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Check your email for the six-digit code and enter it below.
            </p>
          </div>

          <Input
            label="Email address"
            name="email"
            type="email"
            value={email}
            readOnly
            disabled
            onChange={() => {
              // Read-only: the invitation decides the address.
            }}
          />

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

          <p className="text-center text-xs text-slate-400">
            No code? Ask your school administrator to resend the invitation.
          </p>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            void submitPassword(event);
          }}
          className="space-y-4"
          noValidate
        >
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Choose your password
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              This is what you will use to sign in to {schoolName} from now on.
            </p>
          </div>

          <PasswordField
            label="Password"
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
            Set password and continue
          </Button>
        </form>
      )}
    </div>
  );
}
