'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

interface Member {
  challanId: string;
  studentName: string;
  studentNumber: string;
  challanNumber: string;
  totalAmount: string;
}

interface Group {
  guardianId: string;
  guardianName: string;
  phone: string;
  members: Member[];
  total: string;
}

interface Issued {
  id: string;
  challanNumber: string;
  guardianName: string;
  phone: string;
  billingMonth: number | null;
  billingYear: number | null;
  dueDate: string;
  totalAmount: string;
  paidAmount: string;
  status: string;
  memberCount: number;
}

export interface FamilyVouchersProps {
  canWrite: boolean;
  defaultMonth: number;
  defaultYear: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Family vouchers: one slip for a parent with several children.
 *
 * Families are found by the primary guardian's phone number, which is the only
 * grouping key `student_guardians` actually carries — see `lib/family-challans.ts`
 * for why that is both deliberate and imperfect. The children's names are
 * printed on the voucher, so a wrong grouping is visible rather than silent.
 */
export function FamilyVouchers({ canWrite, defaultMonth, defaultYear }: FamilyVouchersProps) {
  const [month, setMonth] = useState(String(defaultMonth));
  const [year, setYear] = useState(String(defaultYear));
  const [dueDate, setDueDate] = useState('');

  const [groups, setGroups] = useState<Group[] | null>(null);
  const [issued, setIssued] = useState<Issued[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadIssued = useCallback(async () => {
    const response = await fetch('/api/school/family-challans');
    const payload = (await response.json()) as { ok: boolean; data?: { challans: Issued[] } };
    if (payload.ok === true && payload.data !== undefined) setIssued(payload.data.challans);
  }, []);

  const loadGroups = useCallback(async () => {
    setError(null);
    const query = new URLSearchParams({ month, year });
    try {
      const response = await fetch(`/api/school/family-challans?${query.toString()}`);
      const payload = (await response.json()) as {
        ok: boolean;
        data?: { groups: Group[] };
        error?: { message: string };
      };
      if (payload.ok === true && payload.data !== undefined) setGroups(payload.data.groups);
      else setError(payload.error?.message ?? 'Could not read those challans.');
    } catch {
      setError('Could not read those challans.');
    }
  }, [month, year]);

  useEffect(() => {
    void loadGroups();
    void loadIssued();
  }, [loadGroups, loadIssued]);

  const issue = useCallback(
    async (group: Group) => {
      setBusyId(group.guardianId);
      setError(null);
      setNotice(null);

      try {
        const response = await fetch('/api/school/family-challans', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            guardianId: group.guardianId,
            challanIds: group.members.map((member) => member.challanId),
            dueDate,
          }),
        });

        const payload = (await response.json()) as {
          ok: boolean;
          data?: { result: { challanNumber: string; total: string; members: number } };
          error?: { message: string };
        };

        if (!response.ok || payload.ok !== true || payload.data === undefined) {
          setError(payload.error?.message ?? 'Could not issue that voucher.');
          return;
        }

        setNotice(
          `${payload.data.result.challanNumber} issued for ${group.guardianName} — ` +
            `${payload.data.result.members} children, PKR ${payload.data.result.total}.`,
        );
        await Promise.all([loadGroups(), loadIssued()]);
      } catch {
        setError('Could not issue that voucher.');
      } finally {
        setBusyId(null);
      }
    },
    [dueDate, loadGroups, loadIssued],
  );

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {notice !== null ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}

      <Card header={<CardTitle title="Which month?" />}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Month"
            options={MONTHS.map((name, index) => ({ value: String(index + 1), label: name }))}
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
            }}
          />
          <Input
            label="Year"
            type="number"
            value={year}
            onChange={(event) => {
              setYear(event.target.value);
            }}
          />
          <Input
            label="Voucher due date"
            type="date"
            value={dueDate}
            hint="Printed on the slip the parent takes to the bank."
            onChange={(event) => {
              setDueDate(event.target.value);
            }}
          />
        </div>
      </Card>

      <Card
        header={
          <CardTitle
            title="Families that could have one voucher"
            description="Two or more children with an open challan for this month, sharing a contact number."
          />
        }
      >
        {groups === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-slate-600">
            No family has more than one open challan for this month. Nothing to
            combine.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {groups.map((group) => (
              <li key={group.guardianId} className="flex flex-wrap items-start justify-between gap-4 py-3">
                <div>
                  <p className="font-medium text-slate-900">{group.guardianName}</p>
                  <p className="font-mono text-xs text-slate-500">{group.phone}</p>
                  <ul className="mt-1 text-sm text-slate-600">
                    {group.members.map((member) => (
                      <li key={member.challanId}>
                        {member.studentName} · {member.challanNumber} · PKR{' '}
                        {member.totalAmount}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-nowrap items-center gap-3 whitespace-nowrap">
                  <span className="font-mono text-sm text-slate-900">
                    PKR {group.total}
                  </span>
                  {canWrite ? (
                    <Button
                      size="sm"
                      isLoading={busyId === group.guardianId}
                      disabled={dueDate === ''}
                      title={dueDate === '' ? 'Choose a due date first' : undefined}
                      onClick={() => {
                        void issue(group);
                      }}
                    >
                      Issue one voucher
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {issued.length > 0 ? (
        <Card className="p-0" header={<CardTitle title="Issued vouchers" />}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Voucher</th>
                  <th scope="col" className="px-4 py-3 font-medium">Family</th>
                  <th scope="col" className="px-4 py-3 font-medium">Children</th>
                  <th scope="col" className="px-4 py-3 font-medium">Due</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {issued.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-900">
                      {row.challanNumber}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.guardianName}
                      <span className="block font-mono text-xs text-slate-500">
                        {row.phone}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.memberCount}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {row.dueDate}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          row.status === 'paid'
                            ? 'success'
                            : row.status === 'cancelled'
                              ? 'neutral'
                              : row.status === 'partial'
                                ? 'warning'
                                : 'danger'
                        }
                      >
                        {row.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-900">
                      {row.paidAmount === '0.00'
                        ? row.totalAmount
                        : `${row.paidAmount} / ${row.totalAmount}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
