import 'server-only';

import { and, count, desc, eq, sql } from 'drizzle-orm';

import { branches, emailOutbox, schoolUsers, schools, students } from '@/db/schema';

import { db } from './drizzle';
import { describeSubdomainStatus, type SubdomainStatus } from './subdomain-status';

/**
 * The reads behind the Super Admin dashboard.
 *
 * ── What this screen is for ──────────────────────────────────────────────
 * A platform operator's job is exception handling, not admiration. Until
 * Sprint 15 the dashboard answered "how many schools are there" four different
 * ways and answered "which tenant is broken" not at all — the failed subdomain
 * in the product owner's screenshot was reachable only by scrolling the schools
 * table until a red badge went past. `listTenantsNeedingAttention` is the tile
 * and the table this dashboard was missing.
 *
 * ── There is no tenant filter here, and that is correct ──────────────────
 * Every other query module in this repository takes a `locationId` and applies
 * it to every table. These do the opposite on purpose: the caller is the
 * platform operator, the subject is the estate, and the guard is the
 * super-admin session rather than a column. Nothing here may be imported by a
 * school-side screen.
 */

/* -----------------------------------------------------------------------------
 * Headline counts.
 * -------------------------------------------------------------------------- */

/** A count now, and the same count thirty days ago. */
export interface EstateCount {
  now: number;
  thirtyDaysAgo: number;
}

function thirtyDaysAgo(now: Date): Date {
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
}

/**
 * Active schools, and how many of today's were already here a month ago.
 *
 * The comparison is over *creation*, not over activation: `is_active` has no
 * history, so "active thirty days ago" cannot be answered and inventing it
 * would be worse than a slightly narrower claim. The tile says "added in the
 * last 30 days", which is what this actually measures.
 */
export async function getActiveSchoolCount(now: Date = new Date()): Promise<EstateCount> {
  const rows = await db
    .select({
      now: count(),
      older:
        sql<number>`count(*) filter (where ${schools.createdAt} < ${thirtyDaysAgo(now).toISOString()})`.mapWith(
          Number,
        ),
    })
    .from(schools)
    .where(eq(schools.isActive, true));

  return { now: rows[0]?.now ?? 0, thirtyDaysAgo: rows[0]?.older ?? 0 };
}

/** Enrolled students across every tenant, and the same figure a month back. */
export async function getPlatformStudentCount(now: Date = new Date()): Promise<EstateCount> {
  const rows = await db
    .select({
      now: count(),
      older:
        sql<number>`count(*) filter (where ${students.createdAt} < ${thirtyDaysAgo(now).toISOString()})`.mapWith(
          Number,
        ),
    })
    .from(students)
    .where(eq(students.status, 'enrolled'));

  return { now: rows[0]?.now ?? 0, thirtyDaysAgo: rows[0]?.older ?? 0 };
}

/* -----------------------------------------------------------------------------
 * Tenants needing attention.
 * -------------------------------------------------------------------------- */

/** Subdomain states that are not "this school is reachable". */
const BROKEN_SUBDOMAIN: SubdomainStatus[] = ['failed', 'pending', 'unmanaged'];

/** One tenant, and every reason it is on the list. */
export interface TenantProblem {
  id: string;
  name: string;
  slug: string;
  city: string;
  subdomainStatus: string;
  /** Plain sentences, one per fault. Never colour alone. */
  reasons: string[];
  createdAt: Date;
}

/**
 * The schools an operator has to do something about.
 *
 * Three faults, and all three are invisible from every other screen:
 *
 *   - **the subdomain is not serving.** `failed` needs a retry, `pending` was
 *     never requested, `unmanaged` was attempted with no hosting token. The
 *     spec also names `throttled`; there is no such value in
 *     `lib/subdomain-status.ts` and none is invented here.
 *   - **no branch.** A school with no campus can enrol nobody: the enrolment
 *     form has no branch to offer and the wizard's last step was never
 *     finished.
 *   - **no administrator.** Nobody can sign in. This is the state a school
 *     reports as "the system never invited us", and it looks identical to a
 *     healthy tenant on the schools table.
 *
 * `provisioning` is deliberately absent: it is a state that resolves itself in
 * a few minutes, and a tile that goes red for it would be red most of the time
 * on the day an operator onboards four schools.
 *
 * Most recently created first — a tenant onboarded this morning and broken is
 * the one somebody is waiting on.
 */
export async function listTenantsNeedingAttention(limit = 25): Promise<TenantProblem[]> {
  const rows = await db
    .select({
      id: schools.id,
      name: schools.name,
      slug: schools.slug,
      city: schools.city,
      locationId: schools.locationId,
      subdomainStatus: schools.subdomainStatus,
      createdAt: schools.createdAt,
      branchCount:
        sql<number>`(select count(*) from ${branches} where ${branches.locationId} = ${schools.locationId} and ${branches.isActive})`.mapWith(
          Number,
        ),
      adminCount:
        sql<number>`(select count(*) from ${schoolUsers} where ${schoolUsers.locationId} = ${schools.locationId} and ${schoolUsers.role} = 'school_admin' and ${schoolUsers.isActive})`.mapWith(
          Number,
        ),
    })
    .from(schools)
    .where(eq(schools.isActive, true))
    .orderBy(desc(schools.createdAt));

  const problems: TenantProblem[] = [];

  for (const row of rows) {
    const reasons: string[] = [];

    if ((BROKEN_SUBDOMAIN as string[]).includes(row.subdomainStatus)) {
      reasons.push(`Subdomain ${describeSubdomainStatus(row.subdomainStatus).label}`);
    }
    if (row.branchCount === 0) reasons.push('No campus');
    if (row.adminCount === 0) reasons.push('No administrator');

    if (reasons.length > 0) {
      problems.push({
        id: row.id,
        name: row.name,
        slug: row.slug,
        city: row.city,
        subdomainStatus: row.subdomainStatus,
        reasons,
        createdAt: row.createdAt,
      });
    }
  }

  return problems.slice(0, limit);
}

/* -----------------------------------------------------------------------------
 * Charts.
 * -------------------------------------------------------------------------- */

export interface EstateSlice {
  label: string;
  value: number;
}

/**
 * Provisioning state of the estate, in the four slices a donut can carry.
 *
 * `pending` and `unmanaged` both mean "somebody has to do something by hand",
 * which is one decision and therefore one slice. Five thin slices on a donut is
 * the shape that makes people reach for a table instead.
 */
export async function getProvisioningSplit(): Promise<EstateSlice[]> {
  const rows = await db
    .select({ status: schools.subdomainStatus, value: count() })
    .from(schools)
    .where(eq(schools.isActive, true))
    .groupBy(schools.subdomainStatus);

  const byStatus = new Map(rows.map((row) => [row.status, row.value]));
  const of = (...keys: string[]): number =>
    keys.reduce((sum, key) => sum + (byStatus.get(key) ?? 0), 0);

  return [
    { label: 'Ready', value: of('ready') },
    { label: 'Provisioning', value: of('provisioning') },
    { label: 'Failed', value: of('failed') },
    { label: 'Needs a hand', value: of('pending', 'unmanaged') },
  ];
}

/**
 * Schools per city, with the tail merged.
 *
 * A bar per city on an estate spread over twenty towns is twenty labels, of
 * which fifteen read `1`. "Other" carries them as one honest number instead of
 * fifteen slivers nobody can read.
 */
export async function getSchoolsByCity(top = 6): Promise<EstateSlice[]> {
  const rows = await db
    .select({ city: schools.city, value: count() })
    .from(schools)
    .where(eq(schools.isActive, true))
    .groupBy(schools.city)
    .orderBy(desc(count()));

  const head = rows.slice(0, top).map((row) => ({ label: row.city, value: row.value }));
  const tail = rows.slice(top).reduce((sum, row) => sum + row.value, 0);

  return tail > 0 ? [...head, { label: 'Other', value: tail }] : head;
}

/** Enrolled students at the largest tenants — the "is this in use" chart. */
export async function getStudentsBySchool(top = 6): Promise<EstateSlice[]> {
  const rows = await db
    .select({ name: schools.name, value: count(students.id) })
    .from(schools)
    .leftJoin(
      students,
      and(eq(students.locationId, schools.locationId), eq(students.status, 'enrolled')),
    )
    .groupBy(schools.id, schools.name)
    .orderBy(desc(count(students.id)))
    .limit(top);

  return rows
    .filter((row) => row.value > 0)
    .map((row) => ({ label: row.name, value: row.value }));
}

/** Schools created per month for the last twelve, with the empty months kept. */
export async function getTenantGrowth(
  months = 12,
  now: Date = new Date(),
): Promise<EstateSlice[]> {
  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${schools.createdAt}), 'YYYY-MM')`,
      value: count(),
    })
    .from(schools)
    // No date filter: the window is applied below, where the empty months have
    // to be filled in from a generated list anyway. A month in which nothing
    // happened returns no row, and a growth chart that silently omits its empty
    // months draws a flat line through a quiet quarter and calls it steady.
    .groupBy(sql`date_trunc('month', ${schools.createdAt})`);

  const byMonth = new Map(rows.map((row) => [row.month, row.value]));
  const out: EstateSlice[] = [];

  for (let back = months - 1; back >= 0; back -= 1) {
    const when = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const key = `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({
      // Three letters: this is a twelve-category axis and that is the label
      // width the vertical chart geometry was designed around.
      label: when.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }),
      value: byMonth.get(key) ?? 0,
    });
  }

  return out;
}

/** The five most recently added tenants — kept, demoted, below the problems. */
export async function listRecentSchools(limit = 5) {
  return db
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
    .limit(limit);
}

/** Queued-after-a-failure and abandoned mail, across the estate. */
export async function getEmailHealth(): Promise<{ struggling: number; failed: number }> {
  const rows = await db
    .select({
      struggling:
        sql<number>`count(*) filter (where ${emailOutbox.status} = 'queued' and ${emailOutbox.attempts} > 0)`.mapWith(
          Number,
        ),
      failed:
        sql<number>`count(*) filter (where ${emailOutbox.status} = 'failed')`.mapWith(Number),
    })
    .from(emailOutbox);

  return { struggling: rows[0]?.struggling ?? 0, failed: rows[0]?.failed ?? 0 };
}

/** Statuses the "needs attention" tile counts, for the filtered link. */
export const ATTENTION_STATUSES: readonly string[] = BROKEN_SUBDOMAIN;
