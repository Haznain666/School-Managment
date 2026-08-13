'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { BadgeVariant } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  type ApplicationStatus,
} from '@/db/schema/admission-applications';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The admissions inbox, one tab per status.
 *
 * Tabs rather than a status filter because reviewing is a queue: an admissions
 * officer works through "pending" until it is empty, and a dropdown hides how
 * much is left.
 */

export interface ApplicationRow {
  id: string;
  studentName: string;
  guardianName: string;
  guardianPhone: string;
  gradeName: string | null;
  branchName: string | null;
  status: ApplicationStatus;
  submittedAt: string;
  convertedToStudentProfileId: string | null;
}

export function applicationStatusVariant(status: ApplicationStatus): BadgeVariant {
  switch (status) {
    case 'accepted':
      return 'success';
    case 'rejected':
      return 'danger';
    case 'waitlisted':
    case 'reviewing':
      return 'warning';
    case 'pending':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10);
}

export function ApplicationTable() {
  const [status, setStatus] = useState<ApplicationStatus>('pending');
  const [search, setSearch] = useState('');
  const [applications, setApplications] = useState<ApplicationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const query = new URLSearchParams({ status });
      if (search.trim() !== '') query.set('search', search.trim());

      try {
        const payload = await schoolFetch<{ applications: ApplicationRow[] }>(
          `/api/school/applications?${query.toString()}`,
          { signal },
        );
        setApplications(payload.applications);
        setError(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(schoolErrorMessage(caught, 'Could not load applications.'));
      }
    },
    [status, search],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void load(controller.signal);
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="tablist" aria-label="Application status" className="flex flex-wrap gap-2">
          {APPLICATION_STATUSES.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={status === value}
              onClick={() => {
                setApplications(null);
                setStatus(value);
              }}
              className={
                status === value
                  ? 'rounded-full bg-brand-primary px-3 py-1.5 text-sm font-medium text-brand-onPrimary'
                  : 'rounded-full bg-surface-sunken px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-line'
              }
            >
              {APPLICATION_STATUS_LABELS[value]}
            </button>
          ))}
        </div>

        <div className="w-full sm:w-64">
          <Input
            label="Search"
            hideLabel
            placeholder="Student, guardian or phone"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {applications === null ? (
        <Card>
          <p className="text-sm text-ink-muted">Loading applications…</p>
        </Card>
      ) : applications.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No {APPLICATION_STATUS_LABELS[status].toLowerCase()} applications.
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Student</th>
                  <th scope="col" className="px-4 py-3 font-medium">Guardian</th>
                  <th scope="col" className="px-4 py-3 font-medium">Phone</th>
                  <th scope="col" className="px-4 py-3 font-medium">Grade</th>
                  <th scope="col" className="px-4 py-3 font-medium">Branch</th>
                  <th scope="col" className="px-4 py-3 font-medium">Submitted</th>
                  <th scope="col" className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {applications.map((application) => (
                  <tr key={application.id}>
                    <td className="px-4 py-3 font-medium text-ink">
                      {application.studentName}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{application.guardianName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                      {application.guardianPhone}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {application.gradeName ?? 'Not specified'}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {application.branchName ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {formatDate(application.submittedAt)}
                    </td>
                    <td className="px-4 py-3">
                      {application.convertedToStudentProfileId === null ? (
                        <Link
                          href={`/dashboard/admissions/applications/${application.id}`}
                          className="text-sm font-medium text-brand-primary hover:underline"
                        >
                          {application.status === 'accepted' ? 'Convert' : 'Review'}
                        </Link>
                      ) : (
                        <Link
                          href={`/dashboard/admissions/students/${application.convertedToStudentProfileId}`}
                          className="text-sm font-medium text-brand-primary hover:underline"
                        >
                          View student
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {applications !== null && applications.length > 0 ? (
        <p className="text-sm text-ink-muted">
          {applications.length} {APPLICATION_STATUS_LABELS[status].toLowerCase()}{' '}
          application{applications.length === 1 ? '' : 's'}.
        </p>
      ) : null}
    </div>
  );
}
