import { count, desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';

import { branches, schoolModules, schools } from '@/db/schema';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { db } from '@/lib/drizzle';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export const dynamic = 'force-dynamic';

interface StatCardProps {
  label: string;
  value: number;
  hint: string;
}

function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </Card>
  );
}

/**
 * Super Admin dashboard.
 *
 * Counts are read server-side with aggregate queries rather than pulled into
 * the client — the panel is an operator tool, and a page render is cheaper
 * than shipping every school row to count them in the browser.
 */
export default async function SuperAdminDashboardPage() {
  const [totalRows, activeRows, branchRows, moduleRows, recent] = await Promise.all([
    db.select({ value: count() }).from(schools),
    db.select({ value: count() }).from(schools).where(eq(schools.isActive, true)),
    db.select({ value: count() }).from(branches).where(eq(branches.isActive, true)),
    db
      .select({ value: count() })
      .from(schoolModules)
      .where(eq(schoolModules.isEnabled, true)),
    db
      .select({
        id: schools.id,
        name: schools.name,
        city: schools.city,
        slug: schools.slug,
        isActive: schools.isActive,
        createdAt: schools.createdAt,
      })
      .from(schools)
      .orderBy(desc(schools.createdAt))
      .limit(5),
  ]);

  const totalSchools = totalRows[0]?.value ?? 0;
  const activeSchools = activeRows[0]?.value ?? 0;
  const totalBranches = branchRows[0]?.value ?? 0;
  const enabledModules = moduleRows[0]?.value ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Schools" value={totalSchools} hint="All tenants" />
        <StatCard label="Active Schools" value={activeSchools} hint="Portals reachable" />
        <StatCard
          label="Total Branches"
          value={totalBranches}
          hint="Active campuses across all schools"
        />
        <StatCard
          label="Modules Enabled"
          value={enabledModules}
          hint="Across all schools"
        />
      </div>

      <Card
        header={
          <CardTitle
            title="Recent schools"
            description="The five most recently added tenants"
            action={
              <Link
                href="/super-admin/schools"
                className="text-sm font-medium text-brand-primary hover:underline"
              >
                View all
              </Link>
            }
          />
        }
        className="p-0"
      >
        {recent.length === 0 ? (
          <p className="text-sm text-slate-600">
            No schools yet.{' '}
            <Link
              href="/super-admin/schools/new"
              className="font-medium text-brand-primary hover:underline"
            >
              Add the first one
            </Link>
            .
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    City
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Subdomain
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((school) => (
                  <tr key={school.id}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/super-admin/schools/${school.id}`}
                        className="font-medium text-slate-900 hover:text-brand-primary"
                      >
                        {school.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{school.city}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {school.slug}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={school.isActive ? 'success' : 'danger'}>
                        {school.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
