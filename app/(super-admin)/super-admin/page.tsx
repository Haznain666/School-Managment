import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, Building2, GraduationCap, Mail } from 'lucide-react';

import { BarChart } from '@/components/charts/BarChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { LineChart } from '@/components/charts/LineChart';
import { EmailDeliveryHealth } from '@/components/super-admin/EmailDeliveryHealth';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { settle } from '@/lib/dashboard-queries';
import {
  getActiveSchoolCount,
  getEmailHealth,
  getPlatformStudentCount,
  getProvisioningSplit,
  getSchoolsByCity,
  getStudentsBySchool,
  getTenantGrowth,
  listRecentSchools,
  listTenantsNeedingAttention,
} from '@/lib/platform-dashboard';
import { describeSubdomainStatus } from '@/lib/subdomain-status';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export const dynamic = 'force-dynamic';

/** The estate has no tenant; `settle` still wants somewhere to log from. */
const PLATFORM = 'platform';

/**
 * Super Admin dashboard.
 *
 * **Decision it informs:** which tenant needs attention today, and is the
 * platform healthy.
 *
 * ── What was removed, and must not come back ─────────────────────────────
 * "Total schools ever created", "Total branches" and "Modules enabled" were the
 * three tiles this screen opened with. All three are trophies: an operator acts
 * on *active* tenants and on *broken* ones, and no number in that list changes
 * what they do next. Module adoption in particular was already removed once, as
 * a chart, and the docblock that removed it is still the argument.
 *
 * ── What replaced them ───────────────────────────────────────────────────
 * **Tenants needing attention.** A school whose subdomain failed, or that has
 * no campus, or that has no administrator, is a school nobody can use — and
 * until Sprint 15 none of those three states appeared anywhere on this screen.
 * The failed subdomain in the product owner's screenshot was reachable only by
 * scrolling the schools table past a red badge.
 *
 * The tile links to the table below rather than to a filtered schools list,
 * because the schools screen has no status filter and adding one belongs to
 * whoever owns that route. The table *is* the filtered list, and it carries the
 * reasons, which a filtered index would not.
 *
 * ── Failure isolation ────────────────────────────────────────────────────
 * Nine independent reads, each through `settle`. A dashboard assembled from
 * nine queries that have nothing to do with each other degrades one tile at a
 * time or it is not a dashboard — see the docblock on `settle` for the outage
 * that taught this.
 */
export default async function SuperAdminDashboardPage() {
  const [
    activeSchools,
    platformStudents,
    problems,
    growth,
    provisioning,
    bySchool,
    byCity,
    recent,
    email,
  ] = await Promise.all([
    settle('active schools', PLATFORM, () => getActiveSchoolCount()),
    settle('platform students', PLATFORM, () => getPlatformStudentCount()),
    settle('tenants needing attention', PLATFORM, () => listTenantsNeedingAttention()),
    settle('tenant growth', PLATFORM, () => getTenantGrowth()),
    settle('provisioning split', PLATFORM, () => getProvisioningSplit()),
    settle('students by school', PLATFORM, () => getStudentsBySchool()),
    settle('schools by city', PLATFORM, () => getSchoolsByCity()),
    settle('recent schools', PLATFORM, () => listRecentSchools()),
    settle('email health', PLATFORM, () => getEmailHealth()),
  ]);

  const added = activeSchools === null ? 0 : activeSchools.now - activeSchools.thirtyDaysAgo;
  const newStudents =
    platformStudents === null ? 0 : platformStudents.now - platformStudents.thirtyDaysAgo;
  const stuck = email === null ? 0 : email.struggling + email.failed;

  return (
    <div className="space-y-6">
      <StatTileGrid>
        <StatTile
          label="Active schools"
          icon={Building2}
          value={activeSchools === null ? undefined : activeSchools.now.toLocaleString()}
          unavailable={activeSchools === null ? 'The school count could not be read.' : undefined}
          delta={activeSchools === null ? undefined : `+${added}`}
          /*
            Zero is not an improvement. `good` was hardcoded here, so a month
            with no new school rendered `+0` in success green and announced
            itself to a screen reader as "an improvement" — a quiet claim that
            nothing happening is something going well.
          */
          deltaMeaning={added > 0 ? 'good' : 'neutral'}
          deltaPeriod="added in the last 30 days"
          detail="Tenants whose portal is reachable"
        />

        {/*
          The exception tile. Red at one, because one unusable tenant is a
          school that paid and cannot sign in — and the number it replaces
          ("total schools") could not go wrong.
        */}
        <StatTile
          label="Needing attention"
          icon={AlertTriangle}
          value={problems === null ? undefined : problems.length.toLocaleString()}
          unavailable={problems === null ? 'The tenant checks could not run.' : undefined}
          deltaMeaning={problems !== null && problems.length > 0 ? 'bad' : 'good'}
          delta={
            problems === null
              ? undefined
              : problems.length === 0
                ? 'All healthy'
                : 'Needs a person'
          }
          detail="No subdomain, no campus or no administrator"
        />

        <StatTile
          label="Students"
          icon={GraduationCap}
          value={platformStudents === null ? undefined : platformStudents.now.toLocaleString()}
          unavailable={
            platformStudents === null ? 'The student count could not be read.' : undefined
          }
          delta={platformStudents === null ? undefined : `+${newStudents}`}
          /* Same as Active schools above: `+0` is neutral, not success. */
          deltaMeaning={newStudents > 0 ? 'good' : 'neutral'}
          deltaPeriod="enrolled in the last 30 days"
          detail="Currently enrolled, across every tenant"
        />

        <StatTile
          label="Email delivery"
          icon={Mail}
          value={email === null ? undefined : stuck === 0 ? 'Healthy' : stuck.toLocaleString()}
          unavailable={email === null ? 'The outbox could not be read.' : undefined}
          deltaMeaning={stuck > 0 ? 'bad' : 'good'}
          delta={
            email === null ? undefined : stuck === 0 ? 'Nothing stuck' : 'Queued after a failure'
          }
          detail="Invitations, sign-in emails and fee notices"
        />
      </StatTileGrid>

      {/*
        Kept, and kept above the charts. Silent email is the failure a school
        reports as "the system did not invite my administrator", and the tile
        above only says how many — this card says what the mail server replied.
      */}
      <EmailDeliveryHealth />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          header={
            <CardTitle
              title={growthTitle(growth)}
              description="Schools added in each of the last twelve months"
            />
          }
        >
          {growth === null ? (
            <ChartUnavailable />
          ) : (
            <LineChart
              title="Schools added per month"
              summary={growthSummary(growth)}
              categories={growth.map((row) => row.label)}
              series={[{ label: 'Schools', values: growth.map((row) => row.value) }]}
              format={(value) => String(Math.round(value))}
              area
            />
          )}
        </Card>

        <Card
          header={
            <CardTitle
              title="Provisioning across the estate"
              description="Where each active tenant's subdomain has got to"
            />
          }
        >
          {provisioning === null ? (
            <ChartUnavailable />
          ) : (
            <DonutChart
              title="Subdomain state"
              summary={provisioningSummary(provisioning)}
              slices={[
                { label: 'Ready', value: provisioning[0]?.value ?? 0, fillClass: 'fill-status-success' },
                {
                  label: 'Provisioning',
                  value: provisioning[1]?.value ?? 0,
                  fillClass: 'fill-status-info',
                },
                { label: 'Failed', value: provisioning[2]?.value ?? 0, fillClass: 'fill-status-danger' },
                {
                  label: 'Needs a hand',
                  value: provisioning[3]?.value ?? 0,
                  fillClass: 'fill-status-warning',
                },
              ]}
              centerValue={String(provisioning.reduce((sum, row) => sum + row.value, 0))}
              centerLabel="active schools"
            />
          )}
        </Card>

        <Card
          header={
            <CardTitle
              title="Where the students are"
              description="Enrolled students at the six largest schools"
            />
          }
        >
          {bySchool === null ? (
            <ChartUnavailable />
          ) : bySchool.length === 0 ? (
            <p className="text-sm text-ink-muted">No school has enrolled a student yet.</p>
          ) : (
            <BarChart
              title="Enrolled students per school"
              summary={rankSummary(bySchool, 'students')}
              categories={bySchool.map((row) => row.label)}
              series={[{ label: 'Students', values: bySchool.map((row) => row.value) }]}
              format={(value) => String(Math.round(value))}
              orientation="horizontal"
            />
          )}
        </Card>

        <Card
          header={
            <CardTitle
              title="Schools by city"
              description="Where the estate is, with the long tail merged"
            />
          }
        >
          {byCity === null ? (
            <ChartUnavailable />
          ) : byCity.length === 0 ? (
            <p className="text-sm text-ink-muted">No active schools yet.</p>
          ) : (
            <BarChart
              title="Active schools per city"
              summary={rankSummary(byCity, 'schools')}
              categories={byCity.map((row) => row.label)}
              series={[{ label: 'Schools', values: byCity.map((row) => row.value) }]}
              format={(value) => String(Math.round(value))}
              orientation="horizontal"
            />
          )}
        </Card>
      </div>

      <Card
        id="needs-attention"
        header={
          <CardTitle
            title="Tenants needing attention"
            description="A school here cannot be used until somebody acts. Most recently created first."
          />
        }
        className="p-0"
      >
        {problems === null ? (
          <p className="px-5 py-4 text-sm text-ink-muted">
            The tenant checks could not run. Everything else on this page is current.
          </p>
        ) : problems.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">
            Every active tenant has a subdomain, a campus and an administrator.
          </p>
        ) : (
          <Table caption="Tenants needing attention">
            <TableHead>
              <TableRow>
                <TableHeaderCell>School</TableHeaderCell>
                <TableHeaderCell>City</TableHeaderCell>
                <TableHeaderCell>Subdomain</TableHeaderCell>
                <TableHeaderCell>What is wrong</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {problems.map((school) => (
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
                  <TableCell>
                    <Badge variant={describeSubdomainStatus(school.subdomainStatus).variant}>
                      {describeSubdomainStatus(school.subdomainStatus).label}
                    </Badge>
                  </TableCell>
                  {/*
                    Written out rather than left to the badge's colour. A row is
                    on this table for up to three separate reasons and only one
                    of them is the subdomain.
                  */}
                  <TableCell muted>{school.reasons.join(' · ')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card
        header={
          <CardTitle
            title="Recently added"
            description="The five newest tenants"
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
        {recent === null ? (
          <p className="px-5 py-4 text-sm text-ink-muted">This list could not be read.</p>
        ) : recent.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">
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
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>City</TableHeaderCell>
                <TableHeaderCell>Subdomain</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
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

/** Stands in for a chart whose data could not be read. */
function ChartUnavailable() {
  return (
    <p className="py-8 text-center text-sm text-ink-muted">
      This chart could not be loaded. Everything else on this page is current.
    </p>
  );
}

/**
 * The card's own heading states the insight where there is one.
 *
 * Where there is not — a flat twelve months — it states the metric. A title
 * that asserts a trend the data does not show is worse than a label.
 */
function growthTitle(rows: ReadonlyArray<{ label: string; value: number }> | null): string {
  if (rows === null || rows.length < 2) return 'Platform growth';

  const half = Math.floor(rows.length / 2);
  const early = rows.slice(0, half).reduce((sum, row) => sum + row.value, 0);
  const late = rows.slice(half).reduce((sum, row) => sum + row.value, 0);

  if (early === late) return 'Platform growth';
  return late > early ? 'Platform growth is accelerating' : 'Platform growth has slowed';
}

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

function provisioningSummary(rows: ReadonlyArray<{ label: string; value: number }>): string {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (total === 0) return 'No active schools yet.';

  const parts = rows
    .filter((row) => row.value > 0)
    .map((row) => `${row.value} ${row.label.toLowerCase()}`);

  return `${total} active school${total === 1 ? '' : 's'}: ${parts.join(', ')}.`;
}

/** One sentence for a screen reader, and the headline a sighted reader takes. */
function rankSummary(
  rows: ReadonlyArray<{ label: string; value: number }>,
  noun: string,
): string {
  if (rows.length === 0) return `No ${noun} to rank yet.`;

  const top = rows[0]!;
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return `${top.label} leads with ${top.value}; ${total} ${noun} across the ${rows.length} shown.`;
}
