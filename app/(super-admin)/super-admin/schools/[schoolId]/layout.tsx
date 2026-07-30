import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { schools } from '@/db/schema';
import { SchoolTabs } from '@/components/super-admin/SchoolTabs';
import { Badge } from '@/components/ui/Badge';
import { db } from '@/lib/drizzle';
import { publicEnv } from '@/lib/env';
import { isUuid } from '@/lib/validation';

/**
 * School detail shell: identity header plus the tab bar shared by Overview,
 * Modules, Branding and Branches.
 */
export const dynamic = 'force-dynamic';

export default async function SchoolDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;

  // A malformed uuid would make Postgres raise rather than return no rows.
  if (!isUuid(schoolId)) notFound();

  const rows = await db
    .select({
      id: schools.id,
      name: schools.name,
      slug: schools.slug,
      city: schools.city,
      isActive: schools.isActive,
    })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);

  const school = rows[0];
  if (school === undefined) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-slate-900">{school.name}</h2>
            <Badge variant={school.isActive ? 'success' : 'danger'}>
              {school.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {school.city} ·{' '}
            <span className="font-mono text-xs">
              {school.slug}.{publicEnv.appDomain}
            </span>
          </p>
        </div>
      </div>

      <SchoolTabs schoolId={school.id} />

      {children}
    </div>
  );
}
