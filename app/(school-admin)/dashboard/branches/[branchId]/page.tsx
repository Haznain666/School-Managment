import { and, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { BranchDeleteCard } from '@/components/school/BranchDeleteCard';
import { PrincipalAssignments } from '@/components/school/PrincipalAssignments';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { branches, CURRICULUM_LEVEL_LABELS } from '@/db/schema';
import { classRangeLabel } from '@/lib/branch-classes';
import { db } from '@/lib/drizzle';
import { requireSchoolPermission } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Branch',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One campus — what it is, who heads it, and the two ways to change it.
 *
 * ── Why this page exists (Sprint 19a, item 8) ────────────────────────────
 * A school could create a campus and never look at it again. Its name, code,
 * address and landline print on every voucher the campus issues, and correcting
 * any of them meant a support ticket to somebody with a Super Admin login.
 *
 * ── And why the principal card is here rather than in Settings ───────────
 * Item 10. "Who runs this campus" is a question about *this campus*, and it was
 * being asked on a page about the school's logo and postal address. The card is
 * unchanged; it is passed this branch's id and shows this branch's heads.
 * School-wide assignments — the head who runs everything — are included,
 * because they are in force here too and a list that omitted them would answer
 * the question with less than the whole answer.
 *
 * Reading is `settings.read`, which every administrative role holds. Changing
 * is `branches.manage`, which by default only the school administrator does:
 * a campus administrator editing the campus record is editing the boundary they
 * are confined by, and `lib/branch-scope.ts` reads that boundary on every
 * request.
 */
export default async function BranchDetailPage({
  params,
}: {
  params: Promise<{ branchId: string }>;
}) {
  const { branchId } = await params;
  if (!isUuid(branchId)) notFound();

  const { locationId, permissions } = await requireSchoolPermission('settings.read');

  // Tenant *and* id, in one statement: a branch UUID belonging to another
  // school is a 404 here rather than a row.
  const rows = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.locationId, locationId)))
    .limit(1);

  const branch = rows[0];
  if (branch === undefined) notFound();

  const canManage = permissions.includes('branches.manage');
  const classes = classRangeLabel(branch.classLevels, branch.curriculumLevel);

  return (
    <div className="space-y-6">
      <PageHeader
        title={branch.name}
        description={`${branch.code} · ${branch.city}`}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Branches', href: '/dashboard/branches' },
          { label: branch.name },
        ]}
        actions={
          canManage ? (
            <Link href={`/dashboard/branches/${branch.id}/edit`}>
              <Button>Edit campus</Button>
            </Link>
          ) : null
        }
      />

      <Card header={<CardTitle title="Campus record" />}>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Branch name" value={branch.name} />
          <Field label="Branch code" value={branch.code} />
          <Field label="City" value={branch.city} />
          <Field label="Street address" value={branch.address} />
          <Field label="Landline" value={branch.landline} />
          <Field label="Mobile" value={branch.phone} />
          <Field label="Email" value={branch.email} />
          <Field
            label="Curriculum"
            value={CURRICULUM_LEVEL_LABELS[branch.curriculumLevel]}
          />
          <Field label="Board" value={branch.boardName} />
          <Field label="Classes taught" value={classes === '' ? null : classes} />
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Status
            </dt>
            <dd className="mt-1 flex gap-2">
              {branch.isMainBranch ? <Badge variant="info">Main campus</Badge> : null}
              {branch.isActive ? (
                <Badge variant="success">Active</Badge>
              ) : (
                <Badge variant="danger">Inactive</Badge>
              )}
            </dd>
          </div>
        </dl>
      </Card>

      {/*
        Item 10. Passed this campus's id, so the card asks and answers the
        question about this campus rather than about the school.

        `canEdit` is `principals.manage`, unchanged — appointing a head is a
        different decision from editing the campus record, and a school that has
        already decided who may do which should not have those two collapse
        because the card moved page.
      */}
      {permissions.includes('principals.manage') ? (
        <PrincipalAssignments
          branches={[{ id: branch.id, name: branch.name }]}
          canEdit
          onlyBranchId={branch.id}
        />
      ) : null}

      {canManage ? (
        <BranchDeleteCard
          branchId={branch.id}
          branchCode={branch.code}
          branchName={branch.name}
        />
      ) : null}
    </div>
  );
}

/** One read-only fact, or an em dash where the school has not recorded it. */
function Field({ label, value }: { label: string; value: string | null }): ReactNode {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-ink">
        {value === null || value === '' ? '—' : value}
      </dd>
    </div>
  );
}
