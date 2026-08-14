'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { PasswordField } from '@/components/school/PasswordField';
import { Button } from '@/components/ui/Button';
import { validatePasswordStrength } from '@/lib/password-strength';
import { schoolErrorMessage, schoolFetch, withSchoolParam } from '@/lib/school-client';

export interface SetupPasswordFormProps {
  token: string;
  schoolName: string;
}

/**
 * Choose a first password, from the link in the welcome email.
 *
 * One step. The link already proved the mailbox, which is the only thing a
 * code proved, so there is nothing left to ask before the password itself.
 *
 * The confirm field is here and not on the sign-in form for the usual reason:
 * a typo in a password you are *setting* locks you out, and a typo in one you
 * are *entering* just fails. Compared locally, so a mismatch never costs a
 * round trip — and never spends the token.
 */
export function SetupPasswordForm({ token, schoolName }: SetupPasswordFormProps) {
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      const strength = validatePasswordStrength(password);
      if (!strength.valid) {
        setError(strength.error ?? 'Choose a stronger password.');
        return;
      }

      if (password !== confirm) {
        setError('Those two passwords do not match.');
        return;
      }

      setIsSubmitting(true);

      try {
        const data = await schoolFetch<{ redirectTo: string }>(
          '/api/school/auth/setup',
          {
            method: 'POST',
            body: JSON.stringify({ token, password }),
          },
        );

        // The session cookie is already on that response, so this is a
        // navigation rather than a sign-in step.
        router.replace(withSchoolParam(data.redirectTo));
        router.refresh();
      } catch (caught) {
        setError(
          schoolErrorMessage(caught, 'Could not set your password. Try again.'),
        );
        setIsSubmitting(false);
      }
    },
    [token, password, confirm, router],
  );

  return (
    <form
      method="post"
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-4 rounded-card border border-line bg-surface-raised p-6 shadow-card"
      noValidate
    >
      <p className="text-sm text-ink-muted">
        Welcome to {schoolName}. Choose a password and you are in — you will use
        it with your email address every time after this.
      </p>

      <PasswordField
        label="New password"
        name="password"
        value={password}
        onChange={setPassword}
        showStrength
        autoComplete="new-password"
        autoFocus
        required
        disabled={isSubmitting}
      />

      <PasswordField
        label="Confirm password"
        name="confirmPassword"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        required
        disabled={isSubmitting}
        error={
          confirm !== '' && confirm !== password
            ? 'These do not match yet.'
            : undefined
        }
      />

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <Button type="submit" fullWidth isLoading={isSubmitting}>
        Set password and sign in
      </Button>
    </form>
  );
}
