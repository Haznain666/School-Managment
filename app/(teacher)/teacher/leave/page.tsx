import type { Metadata } from 'next';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { LEAVE_STATUS_LABELS, type LeaveStatus } from '@/db/schema';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { listOwnLeave, staffIdForSchoolUser } from '@/lib/staff-self-queries';

export const metadata: Metadata = {
  title: 'My leave',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUS_VARIANTS: Record<LeaveStatus, 'success' | 'danger' | 'warning' | 'neutral'> = {
  approved: 'success',
  rejected: 'danger',
  pending: 'warning',
  cancelled: 'neutral',
};

/**
 * A teacher's own leave record.
 *
 * ── Read-only, and that is a decision rather than an omission ────────────
 * Applying for leave from the portal is not built here. Sprint 7's leave flow
 * is an HR screen that takes a staff id, and a self-service application needs
 * its own rules — who approves a head's leave, what happens to an application
 * for a day already marked on the register, whether a teacher may withdraw one
 * after it is approved. Those are product questions, not code, and shipping a
 * form that half-answers them would put applications into a queue nobody had
 * agreed how to work.
 *
 * What a teacher gets today is the thing they could not get at all before: what
 * they applied for, what was decided, and why. The page says the rest is done
 * through the office rather than leaving them looking for a button.
 */
export default async function TeacherLeavePage() {
  const { claims, locationId } = await requireSchoolRole(['teacher']);
  const profile = await getSchoolUserByUid(locationId, claims.uid);

  const staffId =
    profile === null ? null : await staffIdForSchoolUser(locationId, profile.id);

  const requests = staffId === null ? [] : await listOwnLeave(locationId, staffId);

  const approvedDays = requests
    .filter((row) => row.status === 'approved')
    .reduce((sum, row) => sum + Number(row.totalDays), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My leave"
        description="Every leave request recorded against you, and what your school decided."
      />

      {staffId === null ? (
        <EmptyState
          title="Your staff record has not been set up yet"
          description="Leave is recorded against an HR staff record. Ask your school office to link your account to it."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Figure label="Requests" value={String(requests.length)} />
            <Figure
              label="Approved days"
              value={approvedDays.toString()}
            />
            <Figure
              label="Awaiting a decision"
              value={String(requests.filter((row) => row.status === 'pending').length)}
            />
          </div>

          {requests.length === 0 ? (
            <EmptyState
              title="No leave has been recorded"
              description="Ask your school office to record a leave request. It appears here once they do."
            />
          ) : (
            <Card className="p-0">
              <ul className="divide-y divide-line">
                {requests.map((request) => (
                  <li key={request.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">
                          {request.leaveTypeName}
                          {request.isPaid ? '' : ' (unpaid)'}
                        </p>
                        <p className="text-xs text-ink-muted">
                          {request.startDate} to {request.endDate} ·{' '}
                          {request.totalDays} day
                          {Number(request.totalDays) === 1 ? '' : 's'}
                        </p>
                      </div>
                      <Badge variant={STATUS_VARIANTS[request.status as LeaveStatus]}>
                        {LEAVE_STATUS_LABELS[request.status as LeaveStatus]}
                      </Badge>
                    </div>

                    {request.reason === null || request.reason === '' ? null : (
                      <p className="mt-2 text-sm text-ink-muted">{request.reason}</p>
                    )}

                    {request.decisionNote === null || request.decisionNote === '' ? null : (
                      <p className="mt-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink">
                        <span className="font-medium">Your school said: </span>
                        {request.decisionNote}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <p className="text-sm text-ink-muted">
              Applying for leave is done through your school office, not from
              this page. What they record appears here, along with their decision.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-ink">{value}</p>
    </Card>
  );
}
