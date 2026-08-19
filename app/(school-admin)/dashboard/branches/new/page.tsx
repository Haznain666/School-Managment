import type { Metadata } from 'next';

import { BranchForm } from '@/components/super-admin/BranchForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';
import { listBranchOptions } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Add branch',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Where a school adds a campus of its own.
 *
 * The form is the Super Admin panel's, given no `schoolId`. That absence is
 * what switches it to `/api/school/branches` and drops the two controls that
 * only an operator should hold — see `components/super-admin/BranchForm.tsx`.
 * Two copies of a nine-field form with a curriculum-driven class list is one
 * copy too many, and the copy that drifts is always the one nobody is looking
 * at.
 */

/**
 * Where to go after saving.
 *
 * Only in-portal paths are honoured. `next` arrives in the query string, so
 * without this an emailed link could bounce an administrator to any origin
 * immediately after a successful save — the moment they are least likely to
 * read the address bar.
 */
function safeNext(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  return value.startsWith('/dashboard/') ? value : null;
}

export default async function NewSchoolBranchPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { locationId } = await requireSchoolPermission('settings.write');
  const { next } = await searchParams;

  const branches = await listBranchOptions(locationId);
  const isFirstBranch = branches.length === 0;
  const returnTo = safeNext(next);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={isFirstBranch ? 'Add your first branch' : 'Add branch'}
        description={
          isFirstBranch
            ? 'Staff are assigned to a campus, so this comes first. It takes a minute, and you only do it once per campus.'
            : 'A campus of this school. Students, staff and fees are all scoped to one.'
        }
      />

      {isFirstBranch && returnTo !== null ? (
        <p className="rounded-lg bg-surface-sunken px-4 py-3 text-sm text-ink-muted">
          <strong className="font-medium text-ink">
            You were inviting somebody.
          </strong>{' '}
          Create the branch and you will be taken straight back to the invite
          form. Nobody is invited on this screen — that happens on the next one.
        </p>
      ) : null}

      <BranchForm doneUrl={returnTo ?? '/dashboard/branches'} />
    </div>
  );
}
