import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { requireSchoolPermission } from '@/lib/school-guard';
import { listBranchOptions } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Branches',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The school's campuses.
 *
 * This link has been in the sidebar since Sprint 10.5 as a `placeholder`, which
 * in practice meant it led to a 404 — there was no such route, because branches
 * were an operator-only concern. Now that a school can create its own, the link
 * has somewhere to go, and the empty state here is the same one Invite Staff
 * redirects past: a school with no campus is one screen away from having one.
 *
 * ── Read, create, and — from Sprint 19a — open (item 8) ──────────────────
 * Every row is now a link to the campus's own page, where the record can be
 * edited, its principal appointed and, while nothing is attached to it, the
 * campus deleted. Editing is `branches.manage`; the list itself stays on
 * `settings.read`, which every administrative role holds.
 *
 * **Deactivating still stays in the Super Admin panel**, and that has not
 * changed — see the note on the Active toggle in
 * `components/super-admin/BranchForm.tsx`. Inside the portal an inactive campus
 * is invisible everywhere, so a school administrator who switched one off would
 * have hidden a campus with no screen left that shows it again.
 */
export default async function BranchesPage() {
  const { locationId, permissions } = await requireSchoolPermission('settings.read');

  const branches = await listBranchOptions(locationId);
  const canCreate = permissions.includes('settings.write');

  const addButton = canCreate ? (
    <Link href="/dashboard/branches/new">
      <Button>Add branch</Button>
    </Link>
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branches"
        description="The campuses of this school. Students, staff and fees are all scoped to one."
        actions={addButton}
      />

      {branches.length === 0 ? (
        <Card>
          <EmptyState
            title="No branches yet"
            description={
              canCreate
                ? 'Add your first campus. Staff and students are assigned to one, so nothing else can be set up until it exists.'
                : 'Nothing can be assigned until a campus exists. Ask a school administrator to add one.'
            }
            action={addButton}
          />
        </Card>
      ) : (
        <Table caption="Branches">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Branch</TableHeaderCell>
              <TableHeaderCell>Code</TableHeaderCell>
              <TableHeaderCell>City</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {branches.map((branch) => (
              <TableRow key={branch.id}>
                {/*
                  The name is the link, not the whole row. A row-wide click
                  target is unreachable from a keyboard without an anchor in it
                  anyway, and the name is what a reader aims at.
                */}
                <TableCell className="font-medium text-ink">
                  <Link
                    href={`/dashboard/branches/${branch.id}`}
                    className="text-brand-primary hover:underline"
                  >
                    {branch.name}
                  </Link>
                </TableCell>
                <TableCell>{branch.code}</TableCell>
                <TableCell>{branch.city}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
