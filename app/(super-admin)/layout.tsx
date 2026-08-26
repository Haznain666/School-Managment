import type { ReactNode } from 'react';

import { SuperAdminShell } from '@/components/super-admin/SuperAdminShell';
import { countUnreadNotifications } from '@/lib/notifications';
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

  /*
   * The bell's badge, read here so it is correct in the first painted frame.
   * Wrapped: `notifications` arrives in migration `0032`, and this layout runs
   * on every page of the platform portal — an unguarded read against a schema
   * that has not caught up takes the whole surface down (§5aw). A bell with no
   * badge is the correct degradation.
   */
  let unreadNotifications = 0;
  try {
    unreadNotifications = await countUnreadNotifications({ audience: 'super_admin' });
  } catch (error) {
    console.error('[layout] platform notification count could not be read:', error);
  }

  return (
    <SuperAdminShell email={session.email} unreadNotifications={unreadNotifications}>
      {children}
    </SuperAdminShell>
  );
}
