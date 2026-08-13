import type { ReactNode } from 'react';

import { SuperAdminShell } from '@/components/super-admin/SuperAdminShell';
import { readSuperAdminSession } from '@/lib/super-admin-guard';

/**
 * Super Admin shell.
 *
 * This surface is cross-tenant by design: a Super Admin has no location_id to
 * be pinned to, so it is gated by the session cookie rather than by Firebase
 * claims.
 *
 * When there is no session the children are rendered bare. In practice that
 * only ever happens on `/super-admin/login`, because middleware redirects
 * every other path here to the login page before this layout runs — and the
 * login form must not appear inside the signed-in chrome.
 */
export const dynamic = 'force-dynamic';

export default async function SuperAdminLayout({ children }: { children: ReactNode }) {
  const session = await readSuperAdminSession();

  if (session === null) {
    return <>{children}</>;
  }

  return <SuperAdminShell email={session.email}>{children}</SuperAdminShell>;
}
