import { asc } from 'drizzle-orm';
import type { Metadata } from 'next';

import { BulkModuleManager } from '@/components/super-admin/BulkModuleManager';
import { PageHeader } from '@/components/ui/PageHeader';
import { schools } from '@/db/schema';
import { db } from '@/lib/drizzle';

export const metadata: Metadata = {
  title: 'Modules across schools',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Bulk module, channel and integration management.
 *
 * The per-school equivalent lives on the school's own Modules tab and is still
 * the right place to configure one school. This page exists for the other
 * shape of the job — "switch Fee Management on for these nine schools" — which
 * previously meant nine visits.
 *
 * The school list is read server-side and passed down whole. It is the tenant
 * directory: tens of rows, not thousands, and the multi-select needs all of
 * them at once to filter over.
 */
export default async function BulkModulesPage() {
  const rows = await db
    .select({
      id: schools.id,
      name: schools.name,
      city: schools.city,
      slug: schools.slug,
      isActive: schools.isActive,
    })
    .from(schools)
    .orderBy(asc(schools.name));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Modules across schools"
        description="Switch modules, channels and integrations for several schools at once. Each switch opens showing what the selected schools already hold — only the ones you move are written, so nothing you did not touch is affected."
      />

      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">
          There are no schools yet.
        </p>
      ) : (
        <BulkModuleManager schools={rows} />
      )}
    </div>
  );
}
