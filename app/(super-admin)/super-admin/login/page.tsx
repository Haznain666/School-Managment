import type { Metadata } from 'next';

import { SuperAdminLoginForm } from '@/app/(super-admin)/super-admin/login/SuperAdminLoginForm';

export const metadata: Metadata = {
  title: 'Super Admin sign in',
};

export const dynamic = 'force-dynamic';

/**
 * Super Admin sign-in.
 *
 * Middleware lets this page through without a session and redirects here from
 * anywhere else under `/super-admin`. If a valid session already exists it
 * redirects away, so this form is only ever shown to a signed-out operator.
 */
export default async function SuperAdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-sunken px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-ink">SMS Platform</h1>
          <p className="mt-1 text-sm text-ink-muted">Super Admin sign in</p>
        </div>

        <SuperAdminLoginForm nextPath={next ?? null} />

        <p className="mt-6 text-center text-xs text-ink-muted">
          This panel manages every school on the platform.
        </p>
      </div>
    </main>
  );
}
