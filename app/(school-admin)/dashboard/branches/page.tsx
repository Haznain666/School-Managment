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
 * Read-and-create only. Editing and deactivating stay in the Super Admin panel
 * — see the note on the Active toggle in `components/super-admin/BranchForm.tsx`
 * for why a school hiding its own campus is a trap rather than a feature.
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
                <TableCell className="font-medium text-ink">{branch.name}</TableCell>
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
