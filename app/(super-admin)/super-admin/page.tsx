import { count, desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';

import { branches, schoolModules, schools } from '@/db/schema';
import { BarChart } from '@/components/charts/BarChart';
import { PLATFORM_MODULES } from '@/lib/platform-modules';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
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
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink-muted">{hint}</p>
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
  const [totalRows, activeRows, branchRows, moduleRows, recent, adoptionRows] = await Promise.all([
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
    // Module adoption: how many schools have each module switched on. This is
    // the one figure on this panel that says something about the *product*
    // rather than the estate — a module nobody enables is either not wanted or
    // not discoverable, and both are worth knowing before building more of it.
    db
      .select({ moduleKey: schoolModules.moduleKey, value: count() })
      .from(schoolModules)
      .where(eq(schoolModules.isEnabled, true))
      .groupBy(schoolModules.moduleKey),
  ]);

  const totalSchools = totalRows[0]?.value ?? 0;
  const activeSchools = activeRows[0]?.value ?? 0;
  const totalBranches = branchRows[0]?.value ?? 0;
  const enabledModules = moduleRows[0]?.value ?? 0;

  // Every module, including the ones nobody has enabled. A bar chart that omits
  // its zeroes answers "which modules are used" but not "which are not", and
  // the second is the more useful question here.
  const adoption = (() => {
    const byKey = new Map(adoptionRows.map((row) => [row.moduleKey, row.value]));
    return PLATFORM_MODULES.map((module) => ({
      label: module.label,
      value: byKey.get(module.key) ?? 0,
    }));
  })();

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

      {totalSchools === 0 ? null : (
        <Card
          header={
            <CardTitle
              title="Module adoption"
              description={`How many of the ${totalSchools} schools have each module switched on`}
            />
          }
        >
          <BarChart
            title="Schools with each module enabled"
            summary={adoptionSummary(adoption, totalSchools)}
            categories={adoption.map((row) => row.label)}
            series={[{ label: 'Schools', values: adoption.map((row) => row.value) }]}
            format={(value) => String(Math.round(value))}
          />
        </Card>
      )}

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
          <p className="text-sm text-ink-muted">
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
          <Table caption="Recently added schools">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>
                    Name
                  </TableHeaderCell>
                  <TableHeaderCell>
                    City
                  </TableHeaderCell>
                  <TableHeaderCell>
                    Subdomain
                  </TableHeaderCell>
                  <TableHeaderCell>
                    Status
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {recent.map((school) => (
                  <TableRow key={school.id}>
                    <TableCell>
                      <Link
                        href={`/super-admin/schools/${school.id}`}
                        className="font-medium text-ink hover:text-brand-primary"
                      >
                        {school.name}
                      </Link>
                    </TableCell>
                    <TableCell muted>{school.city}</TableCell>
                    <TableCell muted className="font-mono text-xs">
                      {school.slug}
                    </TableCell>
                    <TableCell>
                      <Badge variant={school.isActive ? 'success' : 'danger'}>
                        {school.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

/**
 * Names the most and least adopted modules, which is the whole point of that
 * chart — and the half a screen-reader user would otherwise have to assemble
 * from eleven bars.
 */
function adoptionSummary(
  rows: ReadonlyArray<{ label: string; value: number }>,
  totalSchools: number,
): string {
  if (rows.length === 0) return 'No modules defined.';

  const most = rows.reduce((best, row) => (row.value > best.value ? row : best), rows[0]!);
  const unused = rows.filter((row) => row.value === 0);

  const lead = `${most.label} is the most adopted, on at ${most.value} of ${totalSchools} schools.`;
  return unused.length === 0
    ? `${lead} Every module is enabled somewhere.`
    : `${lead} ${unused.length} module${unused.length === 1 ? ' is' : 's are'} enabled nowhere: ${unused.map((row) => row.label).join(', ')}.`;
}
