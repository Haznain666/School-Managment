'use client';

import { signInWithEmailAndPassword } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getFirebaseClientAuth } from '@/lib/firebase-client';
import { ROLE_HOME_ROUTES, isUserRole } from '@/types/school-auth';

export interface AcceptInviteFormProps {
  token: string;
  defaultName: string;
  schoolSlug: string;
}

interface AcceptResponse {
  ok: boolean;
  data?: { email: string; role: string; schoolSlug: string };
  error?: { code: string; message: string };
}

const MIN_PASSWORD_LENGTH = 8;

/**
 * Sets a password against an invitation, then signs the new account in.
 *
 * The server creates the Firebase user and its claims; this form immediately
 * signs in with the credentials it just set and exchanges the resulting ID
 * token for a session cookie, so the invitee lands in their portal without a
 * second login.
 */
export function AcceptInviteForm({
  token,
  defaultName,
  schoolSlug,
}: AcceptInviteFormProps) {
  const router = useRouter();

  const [name, setName] = useState(defaultName);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      if (name.trim() === '') {
        setError('Enter your full name.');
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }
      if (password !== confirm) {
        setError('The two passwords do not match.');
        return;
      }

      setIsSubmitting(true);

      try {
        const response = await fetch(`/api/school/invitations/${token}/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), password }),
        });

        const payload = (await response.json()) as AcceptResponse;

        if (!response.ok || payload.ok !== true || payload.data === undefined) {
          setError(payload.error?.message ?? 'Could not complete your signup.');
          setIsSubmitting(false);
          return;
        }

        const { email, role } = payload.data;

        // Sign in with the credentials just created, then trade the ID token
        // for the session cookie the portals actually read.
        const credential = await signInWithEmailAndPassword(
          getFirebaseClientAuth(),
          email,
          password,
        );
        const idToken = await credential.user.getIdToken(true);

        const home = isUserRole(role) ? ROLE_HOME_ROUTES[role] : '/dashboard';
        const sessionResponse = await fetch(
          `/api/school/auth/session?school=${encodeURIComponent(schoolSlug)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
          },
        );

        if (!sessionResponse.ok) {
          // The account exists and works — only the auto sign-in failed, so
          // send them to the login page rather than stranding them here.
          router.replace(`/login?school=${encodeURIComponent(schoolSlug)}`);
          return;
        }

        router.replace(`${home}?school=${encodeURIComponent(schoolSlug)}`);
        router.refresh();
      } catch {
        setError('Could not complete your signup. Please try again.');
        setIsSubmitting(false);
      }
    },
    [name, password, confirm, token, schoolSlug, router],
  );

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-4 rounded-card border border-slate-200 bg-white p-6 shadow-card"
      noValidate
    >
      <Input
        label="Full name"
        name="name"
        required
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        disabled={isSubmitting}
      />

      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        disabled={isSubmitting}
      />

      <Input
        label="Confirm password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(event) => {
          setConfirm(event.target.value);
        }}
        disabled={isSubmitting}
      />

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Button type="submit" fullWidth isLoading={isSubmitting}>
        Set up my account
      </Button>
    </form>
  );
}
