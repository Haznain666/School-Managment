import type { Metadata } from 'next';

import { RoleSelector } from '@/app/(auth)/role-select/RoleSelector';

export const metadata: Metadata = {
  title: 'Choose a role',
};

export const dynamic = 'force-dynamic';

/**
 * Landing spot for dual-role users. Which roles are offered comes from the
 * server (`GET /api/auth/roles`), so the list is always the roles the user
 * actually holds.
 */
export default function RoleSelectPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <h1 className="mb-1 text-2xl font-bold text-slate-900">Choose a role</h1>
        <p className="mb-6 text-sm text-slate-500">
          You hold more than one role at this school. Pick the one you want to
          use for this session.
        </p>
        <RoleSelector />
      </div>
    </main>
  );
}
