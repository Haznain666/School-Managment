'use client';

import { FirebaseError } from 'firebase/app';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { parseUserClaims, portalPathForRole } from '@/lib/claims';
import { getFirebaseAuth } from '@/lib/firebase';

export interface LoginFormProps {
  /**
   * Location ID of the school this subdomain belongs to. Null when the page is
   * reached without a resolved tenant (apex domain or local dev).
   */
  expectedLocationId: string | null;
  schoolName: string | null;
}

/** Maps Firebase auth error codes onto messages a parent or teacher can act on. */
function messageForFirebaseError(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      // One message for all three — never reveal whether an account exists.
      return 'Incorrect email/phone or password.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact your school administrator.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/invalid-email':
      return 'Enter a valid email address or registered phone number.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}

function looksLikeEmail(value: string): boolean {
  return value.includes('@');
}

/**
 * Resolves a phone number to the account email, scoped to the current school.
 * The subdomain decides the tenant, so a phone number can only ever match an
 * account at the school whose portal the user is on.
 */
async function resolveIdentifierToEmail(identifier: string): Promise<string | null> {
  const response = await fetch('/api/auth/resolve-identifier', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier }),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as { ok: boolean; data?: { email: string } };
  return payload.ok && payload.data !== undefined ? payload.data.email : null;
}

export function LoginForm({ expectedLocationId, schoolName }: LoginFormProps) {
  const router = useRouter();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      if (expectedLocationId === null) {
        setError(
          'No school is associated with this address. Use the link your school gave you.',
        );
        return;
      }

      setIsSubmitting(true);

      try {
        const trimmed = identifier.trim();
        const email = looksLikeEmail(trimmed)
          ? trimmed
          : await resolveIdentifierToEmail(trimmed);

        if (email === null) {
          setError('Incorrect email/phone or password.');
          return;
        }

        const credential = await signInWithEmailAndPassword(
          getFirebaseAuth(),
          email,
          password,
        );

        // Force-refresh so claims set moments ago (new account, role change)
        // are present rather than served from a cached token.
        const tokenResult = await credential.user.getIdTokenResult(true);
        const claims = parseUserClaims(tokenResult.claims as Record<string, unknown>);

        if (claims === null) {
          await signOut(getFirebaseAuth());
          setError(
            'This account is not set up yet. Contact your school administrator.',
          );
          return;
        }

        // Tenant check: an account from another school must not sign in here,
        // even with correct credentials. super_admin is cross-tenant by design.
        if (claims.role !== 'super_admin' && claims.location_id !== expectedLocationId) {
          await signOut(getFirebaseAuth());
          setError(
            schoolName === null
              ? 'This account does not belong to this school portal.'
              : `This account does not belong to ${schoolName}.`,
          );
          return;
        }

        // A user holding more than one role picks which one to use first.
        if (claims.is_dual_role) {
          router.replace('/role-select');
          return;
        }

        router.replace(portalPathForRole(claims.role, claims.location_id));
      } catch (caught) {
        if (caught instanceof FirebaseError) {
          setError(messageForFirebaseError(caught.code));
        } else {
          setError('Sign-in failed. Please try again.');
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [expectedLocationId, identifier, password, router, schoolName],
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
        label="Email or phone"
        name="identifier"
        type="text"
        autoComplete="username"
        required
        value={identifier}
        onChange={(event) => {
          setIdentifier(event.target.value);
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
