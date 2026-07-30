'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { PortalShell } from '@/components/layout/PortalShell';
import type { NavItem } from '@/components/layout/Sidebar';
import type { SchoolColorPalette, SchoolModuleFlags } from '@/db/schema';

export interface SchoolPortalFrameProps {
  locationId: string;
  schoolName: string;
  logoUrl: string | null;
  colorPalette: SchoolColorPalette | null;
  moduleFlags: SchoolModuleFlags;
  title: string;
  children: ReactNode;
}

/** Navigation for a school portal. Sprint 2+ fills in the real destinations. */
function navItemsFor(locationId: string): readonly NavItem[] {
  const base = `/${locationId}`;
  return [
    { label: 'Dashboard', href: `${base}/dashboard` },
    {
      label: 'Students',
      href: `${base}/students`,
      roles: ['school_admin', 'principal', 'vice_principal', 'coordinator', 'teacher'],
    },
    {
      label: 'Branches',
      href: `${base}/branches`,
      roles: ['school_admin', 'principal', 'vice_principal'],
    },
    {
      label: 'Staff',
      href: `${base}/staff`,
      roles: ['school_admin', 'principal', 'hr_manager'],
      module: 'hr',
    },
    {
      label: 'Accounts',
      href: `${base}/accounts`,
      roles: ['school_admin', 'accountant'],
      module: 'accounts',
    },
    { label: 'Events', href: `${base}/events`, module: 'events' },
  ];
}

/**
 * Client half of the school portal layout.
 *
 * Two jobs: send signed-out visitors to /login, and refuse to render a school's
 * portal for a user whose claims belong to a different school. The server
 * enforces the same rule on every request — this only prevents a confusing
 * flash of the wrong school's chrome.
 */
export function SchoolPortalFrame({
  locationId,
  schoolName,
  logoUrl,
  colorPalette,
  moduleFlags,
  title,
  children,
}: SchoolPortalFrameProps) {
  const router = useRouter();
  const { status, user, claims } = useAuth();

  const isWrongTenant =
    claims !== null && claims.role !== 'super_admin' && claims.location_id !== locationId;

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (status === 'authenticated' && (claims === null || isWrongTenant)) {
      router.replace('/login');
    }
  }, [status, claims, isWrongTenant, router]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  if (status !== 'authenticated' || claims === null || isWrongTenant) {
    // Redirect is already in flight; render nothing rather than the portal.
    return null;
  }

  return (
    <PortalShell
      title={title}
      schoolName={schoolName}
      logoUrl={logoUrl}
      colorPalette={colorPalette}
      moduleFlags={moduleFlags}
      navItems={navItemsFor(locationId)}
      role={claims.role}
      email={user?.email ?? ''}
      branchName={claims.branch_id === null ? null : 'Assigned branch'}
    >
      {children}
    </PortalShell>
  );
}
