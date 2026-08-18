import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';

import { branches, schoolModules, schools, students } from '@/db/schema';
import { BarChart } from '@/components/charts/BarChart';
import { EmailDeliveryHealth } from '@/components/super-admin/EmailDeliveryHealth';
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
  const [totalRows, activeRows, branchRows, moduleRows, recent, growthRows, sizeRows] =
    await Promise.all([
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
    /**
     * Schools created per month, for the last twelve.
     *
     * ── What replaced module adoption, and why ─────────────────────────
     * This panel used to draw "how many schools have each module switched
     * on" — eleven long module names, and eleven bars that between them
     * answered a product-research question nobody on this screen was asking.
     * It was also the tallest thing on the page by some margin.
     *
     * A platform operator's two standing questions are *is the estate
     * growing* and *which tenants are actually being used*. These two
     * queries answer them, and both fit in a compact chart because their
     * labels are three characters and a school name rather than
     * "Academics & Timetable".
     *
     * Truncated to the month in SQL so the grouping happens once, in the
     * database, rather than over rows pulled into the request.
     */
    db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${schools.createdAt}), 'YYYY-MM')`,
        value: count(),
      })
      .from(schools)
      .where(sql`${schools.createdAt} >= date_trunc('month', now()) - interval '11 months'`)
      .groupBy(sql`date_trunc('month', ${schools.createdAt})`),

    // Enrolled students per school. `enrolled` only: a graduated or withdrawn
    // student is history, and counting them would make a school that has run
    // for years look larger than one that is currently teaching more children.
    db
      .select({ name: schools.name, value: count(students.id) })
      .from(schools)
      .leftJoin(
        students,
        and(
          eq(students.locationId, schools.locationId),
          eq(students.status, 'enrolled'),
        ),
      )
      .groupBy(schools.id, schools.name)
      .orderBy(desc(count(students.id)))
      .limit(6),
  ]);

  const totalSchools = totalRows[0]?.value ?? 0;
  const activeSchools = activeRows[0]?.value ?? 0;
  const totalBranches = branchRows[0]?.value ?? 0;
  const enabledModules = moduleRows[0]?.value ?? 0;

  /**
   * The last twelve months, including the ones with no signups.
   *
   * Built from a generated list rather than from the query's own rows, because
   * a month in which nothing happened returns no row at all — and a growth
   * chart that silently omits its empty months draws a flat line through a
   * quiet quarter and calls it steady. The gaps are the information.
   */
  const growth = (() => {
    const byMonth = new Map(growthRows.map((row) => [row.month, row.value]));
    const now = new Date();
    const months: { label: string; value: number }[] = [];

    for (let back = 11; back >= 0; back -= 1) {
      const when = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
      const key = `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, '0')}`;
      months.push({
        // Three letters: this is a twelve-category x axis, and it is exactly
        // the label width the vertical chart was designed around.
        label: when.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }),
        value: byMonth.get(key) ?? 0,
      });
    }

    return months;
  })();

  const bySize = sizeRows.filter((row) => row.value > 0);

  return (
    <div className="space-y-6">
      {/*
        Above the tiles. Silent email is the failure a school reports as "the
        system did not invite my administrator", and until this card existed the
        only way to see it was to query the database.
      */}
      <EmailDeliveryHealth />

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
        <div className="grid gap-4 xl:grid-cols-2">
          <Card
            header={
              <CardTitle
                title="Platform growth"
                description="Schools added in each of the last twelve months"
              />
            }
          >
            {/*
              Vertical, and compact. Twelve three-letter labels is precisely
              what the default chart geometry was built for — unlike the eleven
              module names this replaced, which needed a whole chart mode of
              their own and still took half the page.
            */}
            <BarChart
              title="Schools added per month"
              summary={growthSummary(growth)}
              categories={growth.map((row) => row.label)}
              series={[{ label: 'Schools', values: growth.map((row) => row.value) }]}
              format={(value) => String(Math.round(value))}
            />
          </Card>

          <Card
            header={
              <CardTitle
                title="Where the students are"
                description="Enrolled students at the six largest schools"
              />
            }
          >
            {/*
              The figure that separates a tenant in use from an empty shell,
              which on an estate carrying test schools is the thing an operator
              most needs to see. Six rows, so it stays short.
            */}
            {bySize.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No school has enrolled a student yet.
              </p>
            ) : (
              <BarChart
                title="Enrolled students per school"
                summary={sizeSummary(bySize)}
                categories={bySize.map((row) => row.name)}
                series={[{ label: 'Students', values: bySize.map((row) => row.value) }]}
                format={(value) => String(Math.round(value))}
                orientation="horizontal"
              />
            )}
          </Card>
        </div>
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
 * chart — and what a screen-reader user would otherwise have to assemble bar
 * by bar.
 */
function growthSummary(rows: ReadonlyArray<{ label: string; value: number }>): string {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (total === 0) return 'No schools were added in the last twelve months.';

  const best = rows.reduce((peak, row) => (row.value > peak.value ? row : peak), rows[0]!);
  const latest = rows[rows.length - 1]!;

  return (
    `${total} school${total === 1 ? '' : 's'} added over twelve months, ` +
    `busiest in ${best.label} with ${best.value}. ` +
    `${latest.value} so far this month.`
  );
}

/** One sentence for a screen reader, and the headline a sighted reader takes. */
function sizeSummary(rows: ReadonlyArray<{ name: string; value: number }>): string {
  if (rows.length === 0) return 'No school has enrolled a student yet.';

  const top = rows[0]!;
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return `${top.name} is the largest with ${top.value} enrolled; ${total} across the ${rows.length} shown.`;
}
