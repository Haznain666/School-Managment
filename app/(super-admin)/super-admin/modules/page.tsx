import { asc } from 'drizzle-orm';
import type { Metadata } from 'next';

import { BulkModuleManager } from '@/components/super-admin/BulkModuleManager';
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
      <div>
        <h2 className="text-xl font-semibold text-slate-900">
          Modules across schools
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Switch modules, channels and integrations for several schools at once.
          Every setting defaults to <strong>Leave</strong> — only what you
          change is written, so nothing you did not touch is affected.
        </p>
      </div>

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
