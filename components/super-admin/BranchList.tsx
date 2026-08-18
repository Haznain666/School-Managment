'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { CURRICULUM_LEVEL_LABELS, type CurriculumLevel } from '@/db/schema';
import { classRangeLabel } from '@/lib/branch-classes';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';
import { cn } from '@/lib/utils';

export interface BranchRow {
  id: string;
  name: string;
  code: string;
  city: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  curriculumLevel: CurriculumLevel;
  boardName: string | null;
  classLevels: string[];
  isActive: boolean;
  isMainBranch: boolean;
}

export interface BranchListProps {
  schoolId: string;
}

export function BranchList({ schoolId }: BranchListProps) {
  const [branches, setBranches] = useState<BranchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const base = `/api/super-admin/schools/${schoolId}/branches`;

  const load = useCallback(async () => {
    try {
      const data = await superAdminFetch<{ branches: BranchRow[] }>(base);
      setBranches(data.branches);
      setError(null);
    } catch {
      setError('Could not load branches.');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (branchId: string, body: Record<string, boolean>, failure: string) => {
      setPendingId(branchId);
      setError(null);
      try {
        await superAdminFetch(`${base}/${branchId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        await load();
      } catch (caught) {
        setError(caught instanceof SuperAdminApiError ? caught.message : failure);
      } finally {
        setPendingId(null);
      }
    },
    [base, load],
  );

  const deactivate = useCallback(
    async (branchId: string) => {
      setPendingId(branchId);
      setError(null);
      try {
        await superAdminFetch(`${base}/${branchId}`, { method: 'DELETE' });
        await load();
      } catch (caught) {
        setError(
          caught instanceof SuperAdminApiError
            ? caught.message
            : 'Could not deactivate the branch.',
        );
      } finally {
        setPendingId(null);
      }
    },
    [base, load],
  );

  /**
   * The branch awaiting erasure and the name typed to confirm it. Same shape
   * and same reasoning as the school dialog in `SchoolTable`: a yes/no prompt
   * is muscle memory, a typed name cannot be entered against the wrong card.
   */
  const [deleting, setDeleting] = useState<BranchRow | null>(null);
  const [confirmName, setConfirmName] = useState('');

  const deleteForever = useCallback(
    async (branch: BranchRow) => {
      setPendingId(branch.id);
      setError(null);
      try {
        await superAdminFetch(`${base}/${branch.id}?permanent=true`, {
          method: 'DELETE',
          body: JSON.stringify({ confirmName }),
        });
        setDeleting(null);
        setConfirmName('');
        await load();
      } catch (caught) {
        // The commonest failure here is the 409 naming what is still attached,
        // and that message is the whole value — it must not be replaced by a
        // generic one.
        setError(
          caught instanceof SuperAdminApiError
            ? caught.message
            : 'Could not delete the branch.',
        );
      } finally {
        setPendingId(null);
      }
    },
    [base, load, confirmName],
  );

  if (branches === null) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">{error ?? 'Loading branches…'}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {branches.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No branches yet. Add the first campus for this school.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {branches.map((branch) => (
            <Card
              key={branch.id}
              className={cn(branch.isMainBranch && 'ring-2 ring-brand-primary')}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{branch.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink-muted">
                    {branch.code}
                  </p>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant={branch.isActive ? 'success' : 'danger'}>
                    {branch.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  {branch.isMainBranch ? <Badge variant="warning">Main</Badge> : null}
                </div>
              </div>

              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="text-ink-muted">City</dt>
                  <dd className="text-ink">{branch.city}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-ink-muted">Curriculum</dt>
                  <dd className="text-ink">
                    {CURRICULUM_LEVEL_LABELS[branch.curriculumLevel]}
                  </dd>
                </div>
                {branch.boardName !== null && branch.boardName !== '' ? (
                  <div className="flex gap-2">
                    <dt className="text-ink-muted">Board</dt>
                    <dd className="text-ink">{branch.boardName}</dd>
                  </div>
                ) : null}
                {branch.classLevels.length > 0 ? (
                  <div className="flex gap-2">
                    <dt className="text-ink-muted">Classes</dt>
                    <dd className="text-ink">
                      {classRangeLabel(branch.classLevels, branch.curriculumLevel)}
                    </dd>
                  </div>
                ) : null}
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Link
                  href={`/super-admin/schools/${schoolId}/branches/${branch.id}/edit`}
                  className="text-sm font-medium text-brand-primary hover:underline"
                >
                  Edit
                </Link>

                {!branch.isMainBranch && branch.isActive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    isLoading={pendingId === branch.id}
                    onClick={() => {
                      void patch(
                        branch.id,
                        { isMainBranch: true },
                        'Could not set the main branch.',
                      );
                    }}
                  >
                    Make main
                  </Button>
                ) : null}

                {branch.isActive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    isLoading={pendingId === branch.id}
                    onClick={() => {
                      void deactivate(branch.id);
                    }}
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    isLoading={pendingId === branch.id}
                    onClick={() => {
                      void patch(
                        branch.id,
                        { isActive: true },
                        'Could not reactivate the branch.',
                      );
                    }}
                  >
                    Reactivate
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pendingId === branch.id}
                  onClick={() => {
                    setConfirmName('');
                    setError(null);
                    setDeleting(branch);
                  }}
                  className="text-status-danger-ink hover:bg-status-danger-subtle"
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {deleting !== null ? (
        // `z-backdrop` / `z-modal` from the project's named scale, not a raw
        // number — see the same dialog in `SchoolTable` for what a raw `z-50`
        // did underneath a `z-sticky` table header.
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-branch-title"
          className="fixed inset-0 z-backdrop flex items-center justify-center overflow-y-auto bg-[rgb(2_6_23/0.55)] p-4"
        >
          <Card className="z-modal my-auto max-h-[90vh] w-full max-w-lg overflow-y-auto">
            <div className="space-y-4">
              <h2 id="delete-branch-title" className="text-lg font-semibold text-ink">
                Delete {deleting.name} permanently?
              </h2>

              <div className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
                <p className="font-medium">This removes the campus record itself.</p>
                <p className="mt-1">
                  It is only possible while nothing is attached to it. If this
                  branch has students, staff or portal members, the delete is
                  refused and you will be told how many — because removing it
                  would detach them from every campus rather than deleting them.
                </p>
              </div>

              <p className="text-sm text-ink-muted">
                To close the campus but keep its records, cancel and use{' '}
                <span className="font-medium text-ink">Deactivate</span> instead.
              </p>

              <Input
                label={`Type ${deleting.name} to confirm`}
                value={confirmName}
                onChange={(event) => {
                  setConfirmName(event.target.value);
                }}
                disabled={pendingId === deleting.id}
                autoComplete="off"
                placeholder={deleting.name}
              />

              {error !== null ? (
                <p role="alert" className="text-sm text-status-danger-ink">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                <Button
                  variant="secondary"
                  disabled={pendingId === deleting.id}
                  onClick={() => {
                    setDeleting(null);
                    setConfirmName('');
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  isLoading={pendingId === deleting.id}
                  disabled={confirmName !== deleting.name}
                  onClick={() => {
                    void deleteForever(deleting);
                  }}
                >
                  Delete permanently
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
