'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CURRICULUM_LEVEL_LABELS, type CurriculumLevel } from '@/db/schema';
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
  maxGrade: string | null;
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
                {branch.maxGrade !== null && branch.maxGrade !== '' ? (
                  <div className="flex gap-2">
                    <dt className="text-ink-muted">Up to</dt>
                    <dd className="text-ink">{branch.maxGrade}</dd>
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
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
