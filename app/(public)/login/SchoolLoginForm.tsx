'use client';

import { FirebaseError } from 'firebase/app';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getFirebaseClientAuth } from '@/lib/firebase-client';
import { ROLE_HOME_ROUTES, isUserRole } from '@/types/school-auth';

export interface SchoolLoginFormProps {
  /** Carried into the post-login redirect so dev keeps its tenant. */
  schoolSlug: string | null;
}

interface SessionResponse {
  ok: boolean;
  data?: { role: string; name: string; locationId: string };
  error?: { code: string; message: string };
}

/** Firebase codes mapped to something a parent or teacher can act on. */
function messageForFirebaseError(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      // One message for all three — never reveal whether an account exists.
      return 'Invalid email or password';
    case 'auth/user-disabled':
      return 'Your account has been deactivated. Contact your school admin.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}

export function SchoolLoginForm({ schoolSlug }: SchoolLoginFormProps) {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setIsSubmitting(true);

      const auth = getFirebaseClientAuth();

      try {
        const credential = await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        );

        // Force-refresh so claims set moments ago — a just-accepted invite —
        // are present rather than served from a cached token.
        const idToken = await credential.user.getIdToken(true);

        const response = await fetch('/api/school/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        });

        const payload = (await response.json()) as SessionResponse;

        if (!response.ok || payload.ok !== true || payload.data === undefined) {
          // The Firebase sign-in succeeded but the server refused the session,
          // so drop the client credential rather than leaving a half-signed-in
          // browser holding a token it cannot use.
          await signOut(auth);
          setError(payload.error?.message ?? 'Sign-in failed. Please try again.');
          setIsSubmitting(false);
          return;
        }

        const { role } = payload.data;
        const home = isUserRole(role) ? ROLE_HOME_ROUTES[role] : '/dashboard';
        const target =
          schoolSlug === null || schoolSlug === ''
            ? home
            : `${home}?school=${encodeURIComponent(schoolSlug)}`;

        router.replace(target);
        router.refresh();
      } catch (caught) {
        setError(
          caught instanceof FirebaseError
            ? messageForFirebaseError(caught.code)
            : 'Sign-in failed. Please try again.',
        );
        setIsSubmitting(false);
      }
    },
    [email, password, router, schoolSlug],
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
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
        }}
        placeholder="you@school.edu.pk"
        disabled={isSubmitting}
      />

      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
        disabled={isSubmitting}
      />

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Button type="submit" fullWidth isLoading={isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}
