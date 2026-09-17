'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SkeletonForm } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import { LEAVE_STATUS_LABELS, type LeaveStatus } from '@/db/schema/leave-requests';
import type { HolidaySpan } from '@/db/schema/branch-leave-settings';
import {
  calendarSpan,
  dayLabel,
  quotaProblem,
  roundToHalf,
  spanProblem,
  type LeaveQuota,
} from '@/lib/leave-quota';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

import { countHint, useLeaveCount } from './useLeaveCount';

/**
 * Applying for your own leave — Sprint 33b.
 *
 * ── This replaces a page that said to go and ask the office ──────────────
 * `/teacher/leave` was read-only and its docblock said why: *"a self-service
 * application needs its own rules — who approves a head's leave, what happens
 * to an application for a day already marked on the register, whether a teacher
 * may withdraw one after it is approved. Those are product questions, not
 * code."* Every one of them now has an answer — the chain, the holiday rules,
 * and withdrawing while it is still pending — so the form exists and that
 * docblock has gone rather than being left to contradict the button beside it.
 *
 * ── One component, two portals ───────────────────────────────────────────
 * The teacher portal and the administrative dashboard render the same thing,
 * because it is the same act. Everything it needs arrives in one request from
 * `/api/school/leave/me`, which is four round trips on a phone in Lahore
 * otherwise.
 *
 * ── The day count is honest about what it does not know ──────────────────
 * The campus's holiday rule and the person's own calendar live on the server,
 * so the figure shown while typing is the **calendar span** and the hint says
 * so. What was actually counted comes back from the write and is shown then.
 * The quota check *is* run here, from `lib/leave-quota.ts` — the same function
 * the route refuses with — so somebody out of entitlement is told before they
 * press the button rather than after.
 */

interface QuotaRow extends LeaveQuota {
  leaveTypeId: string;
  leaveTypeName: string;
  isPaid: boolean;
  annualQuotaDays: number;
}

interface OwnRequest {
  id: string;
  leaveTypeName: string;
  isPaid: boolean;
  startDate: string;
  endDate: string;
  totalDays: string;
  reason: string | null;
  status: LeaveStatus;
  decisionNote: string | null;
  decidedByName: string | null;
}

interface MePayload {
  staff: {
    staffId: string;
    name: string;
    employeeCode: string;
    designation: string | null;
    branchName: string | null;
    permanentFrom: string | null;
  } | null;
  quotas: QuotaRow[];
  leaveRequests: OwnRequest[];
  chain: string | null;
  holidaySpan: HolidaySpan;
}

interface Draft {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  totalDays: string;
  reason: string;
}

const EMPTY_DRAFT: Draft = {
  leaveTypeId: '',
  startDate: '',
  endDate: '',
  totalDays: '',
  reason: '',
};

const STATUS_VARIANT: Record<LeaveStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  approved: 'success',
  pending: 'warning',
  rejected: 'danger',
  cancelled: 'neutral',
};

export function LeaveSelfService() {
  const [payload, setPayload] = useState<MePayload | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [pending, setPending] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPending(true);
    try {
      const next = await schoolFetch<MePayload>('/api/school/leave/me');
      setPayload(next);
      setDraft((held) => ({
        ...held,
        leaveTypeId: held.leaveTypeId === '' ? (next.quotas[0]?.leaveTypeId ?? '') : held.leaveTypeId,
      }));
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load your leave.'));
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * QA round 1, F5. "Days used" is counted by the server, by the function the
   * write stores with, and fills the box as soon as it answers. A typed half
   * day survives until the dates change, because it is an answer about *those*
   * dates.
   */
  const counting = useLeaveCount(draft.startDate, draft.endDate);
  const countedDays = counting.result?.days ?? null;
  useEffect(() => {
    if (countedDays === null) return;
    setDraft((held) => ({ ...held, totalDays: String(countedDays) }));
  }, [countedDays]);

  const span = calendarSpan(draft.startDate, draft.endDate);
  const quota = payload?.quotas.find((row) => row.leaveTypeId === draft.leaveTypeId) ?? null;
  const days = roundToHalf(Number(draft.totalDays) || (countedDays ?? span));

  // The same function the server refuses with, so nobody is told "fine" here
  // and "no" a second later.
  const preview =
    quota === null || span === 0 ? null : quotaProblem(quota, days, quota.leaveTypeName);

  const apply = async (): Promise<void> => {
    const rangeProblem = spanProblem(draft.startDate, draft.endDate);
    if (rangeProblem !== null) {
      setError(rangeProblem);
      return;
    }
    if (draft.leaveTypeId === '') {
      setError('Choose which leave this is.');
      return;
    }

    setBusy('apply');
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{
        counted: { days: number; holidayDays: number; skipped: boolean };
      }>('/api/school/leave/requests', {
        method: 'POST',
        body: JSON.stringify({
          leaveTypeId: draft.leaveTypeId,
          startDate: draft.startDate,
          endDate: draft.endDate,
          totalDays: draft.totalDays === '' ? undefined : Number(draft.totalDays),
          reason: draft.reason.trim(),
        }),
      });

      setDraft({ ...EMPTY_DRAFT, leaveTypeId: draft.leaveTypeId });
      setNotice(
        result.counted.skipped
          ? `Applied for ${dayLabel(result.counted.days)} — the ${dayLabel(result.counted.holidayDays)} the school is closed did not count.`
          : `Applied for ${dayLabel(result.counted.days)}. ${payload?.chain === null || payload?.chain === undefined ? '' : `It goes to: ${payload.chain}.`}`,
      );
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not apply for leave.'));
    } finally {
      setBusy(null);
    }
  };

  const withdraw = async (row: OwnRequest): Promise<void> => {
    setBusy(row.id);
    setError(null);
    setNotice(null);

    try {
      await schoolFetch(`/api/school/leave/requests/${row.id}`, { method: 'DELETE' });
      setNotice('Withdrawn. Those days are free again.');
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not withdraw that request.'));
    } finally {
      setBusy(null);
    }
  };

  if (pending && payload === null) {
    // The client-side wait. `loading.tsx` covers the server render; this covers
    // the fetch after mount, which is the one a filter or a refresh repeats.
    return <SkeletonForm fields={5} />;
  }

  if (payload !== null && payload.staff === null) {
    return (
      <EmptyState
        title="Your staff record has not been set up yet"
        description="Leave is recorded against an HR staff record. Ask your school office to link your account to it, and this page will work from then on."
      />
    );
  }

  return (
    <div className="space-y-6">
      {error !== null ? (
        <p
          role="alert"
          className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      <Card
        header={
          <CardTitle
            title="What you have left"
            description={
              payload?.holidaySpan === 'skip'
                ? 'A public holiday inside your dates is not counted at your campus.'
                : 'A public holiday inside your dates counts as leave at your campus.'
            }
          />
        }
      >
        {(payload?.quotas.length ?? 0) === 0 ? (
          <p className="text-sm text-ink-muted">
            Your school has not set up its leave types yet. The office does that once,
            under HR.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {payload?.quotas.map((row) => (
              <li key={row.leaveTypeId} className="rounded-lg border border-line px-3 py-2 text-sm">
                <span className="font-medium text-ink">{row.leaveTypeName}</span>
                <span className="ml-2 text-ink-muted">
                  {row.uncapped
                    ? 'no limit'
                    : `${dayLabel(row.remaining)} left of ${dayLabel(row.entitled)}`}
                </span>
                {row.isPaid ? null : (
                  <Badge className="ml-2" variant="danger">
                    Unpaid
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}

        {payload?.staff?.permanentFrom === null || payload?.staff?.permanentFrom === undefined ? null : (
          <p className="mt-3 text-xs text-ink-muted">
            Your entitlement is worked out from {payload.staff.permanentFrom}, the date you
            became permanent. It does not carry over into next year.
          </p>
        )}
      </Card>

      <Card header={<CardTitle title="Apply for leave" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Leave type"
            options={(payload?.quotas ?? []).map((row) => ({
              value: row.leaveTypeId,
              label: `${row.leaveTypeName} (${row.isPaid ? 'paid' : 'unpaid'})`,
            }))}
            placeholder="Choose one"
            value={draft.leaveTypeId}
            onChange={(event) => {
              setDraft({ ...draft, leaveTypeId: event.target.value });
            }}
          />
          <Input
            label="Days used"
            type="number"
            min={0.5}
            step={0.5}
            value={draft.totalDays}
            hint={countHint(counting, draft.startDate, draft.endDate)}
            onChange={(event) => {
              setDraft({ ...draft, totalDays: event.target.value });
            }}
          />
          <Input
            label="From"
            type="date"
            value={draft.startDate}
            onChange={(event) => {
              // A refusal about the old dates is not about these. QA round 1, F5.
              setError(null);
              setDraft({ ...draft, startDate: event.target.value, totalDays: '' });
            }}
          />
          <Input
            label="To"
            type="date"
            value={draft.endDate}
            onChange={(event) => {
              setError(null);
              setDraft({ ...draft, endDate: event.target.value, totalDays: '' });
            }}
          />
          <div className="sm:col-span-2">
            <Textarea
              label="Reason"
              rows={2}
              value={draft.reason}
              onChange={(event) => {
                setDraft({ ...draft, reason: event.target.value });
              }}
            />
          </div>
        </div>

        {counting.result?.holidayProblem == null ? null : (
          <p className="mt-3 rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-ink">
            {counting.result.holidayProblem}
          </p>
        )}

        {preview === null ? null : (
          <p className="mt-3 rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-ink">
            {preview}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            isLoading={busy === 'apply'}
            disabled={preview !== null || counting.pending}
            onClick={() => {
              void apply();
            }}
          >
            Apply
          </Button>
          {payload?.chain === null || payload?.chain === undefined ? null : (
            <p className="text-sm text-ink-muted">Goes to: {payload.chain}</p>
          )}
        </div>
      </Card>

      <Card className="p-0" header={<CardTitle title="Your leave" />}>
        {(payload?.leaveRequests.length ?? 0) === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">
            Nothing yet. What you apply for appears here with whatever your school decides.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {payload?.leaveRequests.map((row) => (
              <li key={row.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {row.leaveTypeName}
                      {row.isPaid ? '' : ' (unpaid)'}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {row.startDate} to {row.endDate} · {dayLabel(Number(row.totalDays))}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANT[row.status]}>
                      {LEAVE_STATUS_LABELS[row.status]}
                    </Badge>
                    {row.status === 'pending' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        isLoading={busy === row.id}
                        onClick={() => {
                          void withdraw(row);
                        }}
                      >
                        Withdraw
                      </Button>
                    ) : null}
                  </div>
                </div>

                {row.reason === null || row.reason === '' ? null : (
                  <p className="mt-2 text-sm text-ink-muted">{row.reason}</p>
                )}

                {row.decisionNote === null || row.decisionNote === '' ? null : (
                  <p className="mt-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink">
                    <span className="font-medium">
                      {row.decidedByName === null ? 'Your school said: ' : `${row.decidedByName} said: `}
                    </span>
                    {row.decisionNote}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
