import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SuperAdminShell } from '@/components/super-admin/SuperAdminShell';
import { countUnreadNotifications } from '@/lib/notifications';
import { readSuperAdminActor, readSuperAdminSession } from '@/lib/super-admin-guard';
import { SUPER_ADMIN_AREAS, superAdminCan } from '@/lib/super-admin-permissions';

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
 *
 * ── Sprint 35: a signed cookie is not a live operator ────────────────────
 * Middleware verifies the signature and nothing else; it runs on the Edge and
 * cannot read `super_admin_users`. So a deactivated or deleted admin still
 * arrives here with a perfectly valid cookie. The row is read (request-
 * memoised, so the page's own guard costs nothing more) and a session with no
 * live operator behind it is sent through the logout route, which clears the
 * cookie — straight to `/super-admin/login` would bounce back here forever,
 * because middleware would see the still-valid cookie and redirect.
 *
 * The sidebar is drawn from the same row: an operator sees only the areas
 * they may open. That is navigation, not the guard — every page and route
 * checks again.
 */
export const dynamic = 'force-dynamic';

export default async function SuperAdminLayout({ children }: { children: ReactNode }) {
  const session = await readSuperAdminSession();

  if (session === null) {
    return <>{children}</>;
  }

  const actor = await readSuperAdminActor();
  if (actor === null) redirect('/api/super-admin/auth/logout');

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

  const visibleAreas = SUPER_ADMIN_AREAS.filter((area) => superAdminCan(actor, area, 'r'));

  return (
    <SuperAdminShell
      email={actor.email}
      name={actor.name}
      visibleAreas={visibleAreas}
      unreadNotifications={unreadNotifications}
    >
      {children}
    </SuperAdminShell>
  );
}
