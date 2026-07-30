import type { CSSProperties, ReactNode } from 'react';

import { Sidebar, type NavItem } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import type { SchoolColorPalette, SchoolModuleFlags } from '@/db/schema';
import { paletteToCssVariables } from '@/lib/branding';
import type { UserClaimRole } from '@/lib/claims';

export interface PortalShellProps {
  title: string;
  schoolName: string;
  logoUrl: string | null;
  colorPalette: SchoolColorPalette | null;
  moduleFlags: SchoolModuleFlags;
  navItems: readonly NavItem[];
  role: UserClaimRole;
  email: string;
  branchName: string | null;
  children: ReactNode;
}

/**
 * Sidebar + top bar frame for every signed-in portal page.
 *
 * The school's palette is applied here as CSS custom properties, so the
 * `brand-*` Tailwind colours used throughout the component library resolve to
 * that school's colours without any per-tenant stylesheet.
 */
export function PortalShell({
  title,
  schoolName,
  logoUrl,
  colorPalette,
  moduleFlags,
  navItems,
  role,
  email,
  branchName,
  children,
}: PortalShellProps) {
  const brandStyle = paletteToCssVariables(colorPalette) as unknown as CSSProperties;

  return (
    <div style={brandStyle} className="flex h-screen bg-slate-50">
      <Sidebar
        items={navItems}
        role={role}
        moduleFlags={moduleFlags}
        schoolName={schoolName}
        logoUrl={logoUrl}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} email={email} role={role} branchName={branchName} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
