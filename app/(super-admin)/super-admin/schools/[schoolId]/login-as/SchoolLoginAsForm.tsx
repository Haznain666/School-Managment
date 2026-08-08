'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

/**
 * Step-up form for entering a school as the platform operator.
 *
 * Email and password, the same pair as the panel login — deliberately not the
 * school's WhatsApp passcode, which belongs to school members and stays
 * untouched.
 *
 * On success the browser is sent to the school's own address to redeem the
 * hand-off. `window.location` rather than the router: the destination is a
 * different origin once a wildcard domain is attached, and a client-side
 * navigation cannot cross that.
 */

export interface SchoolLoginAsFormProps {
  schoolId: string;
  schoolName: string;
}

interface LoginAsResult {
  loginUrl: string;
  schoolName: string;
  schoolSlug: string;
}

export function SchoolLoginAsForm({ schoolId, schoolName }: SchoolLoginAsFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (email.trim() === '' || password === '') {
      setError('Enter your email and password.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await superAdminFetch<LoginAsResult>(
        `/api/super-admin/schools/${schoolId}/login-as`,
        {
          method: 'POST',
          body: JSON.stringify({ email: email.trim(), password }),
        },
      );

      // Leaves the panel for the school's own origin. The hand-off is
      // short-lived, so this happens immediately rather than being offered as
      // a link the operator might click a minute later.
      window.location.assign(result.loginUrl);
    } catch (caught) {
      setError(
        caught instanceof SuperAdminApiError
          ? caught.message
          : 'Could not sign in to this school.',
      );
      setIsSubmitting(false);
    }
  };

  return (
    <form
      method="post"
      onSubmit={(event) => {
        void submit(event);
      }}
      className="space-y-6"
      noValidate
    >
      <Card>
        <div className="space-y-4">
          <Input
            label="Super Admin email"
            type="email"
            autoComplete="email"
            value={email}
            disabled={isSubmitting}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />

          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={isSubmitting}
            hint="The same credentials you use for the Super Admin panel."
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </div>

        {error !== null ? (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button type="submit" isLoading={isSubmitting}>
            Sign in to {schoolName}
          </Button>
          <Link
            href="/super-admin/schools"
            className="text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            Cancel
          </Link>
        </div>
      </Card>
    </form>
  );
}
