import { count, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { branches, schoolModules, schools } from '@/db/schema';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { db } from '@/lib/drizzle';
import { publicEnv } from '@/lib/env';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'School overview',
};

export const dynamic = 'force-dynamic';

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-900">
        {value === null || value === '' ? (
          <span className="text-slate-400">Not set</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

export default async function SchoolOverviewPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  if (!isUuid(schoolId)) notFound();

  const rows = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  const school = rows[0];
  if (school === undefined) notFound();

  const [branchRows, moduleRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(branches)
      .where(eq(branches.locationId, school.locationId)),
    db
      .select({ value: count() })
      .from(schoolModules)
      .where(eq(schoolModules.locationId, school.locationId)),
  ]);

  return (
    <div className="space-y-6">
      <Card
        header={
          <CardTitle
            title="School details"
            action={
              <Link href={`/super-admin/schools/${school.id}/edit`}>
                <Button variant="secondary" size="sm">
                  Edit
                </Button>
              </Link>
            }
          />
        }
      >
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" value={school.name} />
          <Field label="City" value={school.city} />
          <Field label="Principal" value={school.principalName} />
          <Field label="Phone" value={school.phone} />
          <Field label="Email" value={school.email} />
          <Field label="Address" value={school.address} />
          <Field label="Portal" value={`${school.slug}.${publicEnv.appDomain}`} />
          <Field label="GHL Sub-Account (Location ID)" value={school.locationId} />
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Status</dt>
            <dd className="mt-1">
              <Badge variant={school.isActive ? 'success' : 'danger'}>
                {school.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </dd>
          </div>
        </dl>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card
          header={<CardTitle title="Branches" description="Campuses on record" />}
          footer={
            <Link
              href={`/super-admin/schools/${school.id}/branches`}
              className="text-sm font-medium text-brand-primary hover:underline"
            >
              Manage branches
            </Link>
          }
        >
          <p className="text-3xl font-bold text-slate-900">
            {branchRows[0]?.value ?? 0}
          </p>
        </Card>

        <Card
          header={<CardTitle title="Modules" description="Configured on this school" />}
          footer={
            <Link
              href={`/super-admin/schools/${school.id}/modules`}
              className="text-sm font-medium text-brand-primary hover:underline"
            >
              Manage modules
            </Link>
          }
        >
          <p className="text-3xl font-bold text-slate-900">
            {moduleRows[0]?.value ?? 0}
          </p>
        </Card>
      </div>
    </div>
  );
}
