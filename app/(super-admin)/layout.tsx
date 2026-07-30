import type { ReactNode } from 'react';

import { SuperAdminFrame } from '@/app/(super-admin)/SuperAdminFrame';

/**
 * Super Admin shell — scaffold only for Sprint 1.
 *
 * This surface is cross-tenant by design: a super_admin has no single
 * location_id to be pinned to. Access is still gated on the `super_admin`
 * claim, checked here for the chrome and again server-side on every API call.
 */
export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  return <SuperAdminFrame>{children}</SuperAdminFrame>;
}
