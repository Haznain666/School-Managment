'use client';

import { useState } from 'react';

import { StudentPicker, type PickedStudent } from '@/components/fees/StudentPicker';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import { formatMonthYear } from '@/lib/dates';
import { formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * *Generate family voucher* — raise the month, for the whole family, at once
 * (Sprint 27, item A3).
 *
 * ── Why it starts from a child and not from a family ─────────────────────
 * Everything else on this screen searches families that already hold **open
 * vouchers**, because clubbing needs vouchers to club. Generation is the
 * opposite case by definition: the month has not been billed yet, so that
 * search finds nothing and a panel hanging off it would be unreachable exactly
 * when it is wanted. A clerk always knows a child, so the child is the way in
 * and the server resolves the family from their primary contact.
 *
 * ── The preview is the whole point ───────────────────────────────────────
 * Pressing Generate is four money demands going out to a parent, so the panel
 * shows who would be billed **and whose month is already taken** before any of
 * it happens. A sibling already holding a live voucher is not a failure to
 * report afterwards; it is a decision to put in front of a person — cancel
 * theirs and club the month properly, or leave it and bill the rest
 * individually.
 */

const MONTH_OPTIONS = MONTH_NAMES.map((name, index) => ({
  value: String(index + 1),
  label: name,
}));

interface Sibling {
  studentProfileId: string;
  studentName: string;
  studentNumber: string;
}

interface Clash {
  studentProfileId: string;
  studentName: string;
  challanNumber: string;
  familyChallanNumber: string | null;
  paidAmount: string;
}

interface Preview {
  guardianId: string;
  guardianName: string | null;
  siblings: Sibling[];
  clashes: Clash[];
}

export interface FamilyVoucherGeneratorProps {
  academicYearId: string;
  /** Next month, resolved on the server so the browser's clock cannot disagree. */
  defaultMonth: number;
  defaultYear: number;
  /** Raised when a voucher is issued, so the register above reloads. */
  onGenerated: () => void;
}

export function FamilyVoucherGenerator({
  academicYearId,
  defaultMonth,
  defaultYear,
  onGenerated,
}: FamilyVoucherGeneratorProps) {
  const [student, setStudent] = useState<PickedStudent | null>(null);
  const [month, setMonth] = useState(String(defaultMonth));
  const [year, setYear] = useState(String(defaultYear));

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    if (student === null) return;

    setLoading(true);
    setError(null);
    setNotice(null);

    const query = new URLSearchParams({
      studentProfileId: student.studentProfileId,
      academicYearId,
      billingMonth: month,
      billingYear: year,
    });

    try {
      setPreview(
        await schoolFetch<Preview>(
          `/api/school/family-challans/generate?${query.toString()}`,
        ),
      );
    } catch (caught) {
      setPreview(null);
      setError(schoolErrorMessage(caught, 'Could not read that family.'));
    } finally {
      setLoading(false);
    }
  };

  const generate = async (cancelExisting: boolean): Promise<void> => {
    if (preview === null) return;

    setGenerating(true);
    setError(null);

    try {
      const payload = await schoolFetch<{
        result: { challanNumber: string; total: string; members: number };
      }>('/api/school/family-challans/generate', {
        method: 'POST',
        body: JSON.stringify({
          guardianId: preview.guardianId,
          academicYearId,
          billingMonth: Number(month),
          billingYear: Number(year),
          cancelExisting,
        }),
      });

      setNotice(
        `${payload.result.challanNumber} raised — ${String(payload.result.members)} children, ${formatPkr(payload.result.total)}.`,
      );
      setPreview(null);
      setStudent(null);
      onGenerated();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not raise that family voucher.'));
    } finally {
      setGenerating(false);
    }
  };

  const unpaidClashes = (preview?.clashes ?? []).filter(
    (clash) => Number(clash.paidAmount) <= 0,
  );
  const paidClashes = (preview?.clashes ?? []).filter(
    (clash) => Number(clash.paidAmount) > 0,
  );

  return (
    <Card
      header={
        <CardTitle
          title="Generate a family voucher"
          description="Raise the month for every child of one family, and one slip over them. Find any one of the children — the rest of the family follows."
        />
      }
    >
      {error === null ? null : (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      )}

      {notice === null ? null : (
        <p
          role="status"
          className="mb-4 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-onSubtle"
        >
          {notice}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <StudentPicker
            academicYearId={academicYearId}
            selected={student}
            onSelect={(picked) => {
              setStudent(picked);
              setPreview(null);
              setNotice(null);
            }}
            label="Find any child of the family"
          />
        </div>

        <Select
          label="Billing month"
          options={MONTH_OPTIONS}
          value={month}
          hint="Defaults to next month — fees are billed a month ahead."
          onChange={(event) => {
            setMonth(event.target.value);
            setPreview(null);
          }}
        />

        <Input
          label="Billing year"
          type="number"
          min={2000}
          max={2100}
          value={year}
          onChange={(event) => {
            setYear(event.target.value);
            setPreview(null);
          }}
        />

        <div className="flex items-end">
          <Button
            variant="secondary"
            isLoading={loading}
            disabled={student === null}
            onClick={() => {
              void load();
            }}
          >
            Show the family
          </Button>
        </div>
      </div>

      {/*
        The preview. Deliberately a modal rather than an inline block: the next
        press bills a family, and a confirmation that shares a scroll position
        with a search box is one a person clicks past.
      */}
      <Modal
        open={preview !== null}
        title={
          preview === null
            ? 'The family'
            : `${preview.guardianName ?? 'This family'} — ${formatMonthYear(Number(month), Number(year))}`
        }
        description="Every child on the roll for this year, with the month they would be billed for."
        onClose={() => {
          setPreview(null);
        }}
      >
        {preview === null ? null : preview.siblings.length < 2 ? (
          <p className="text-sm text-ink-muted">
            This family has {preview.siblings.length === 0 ? 'no' : 'one'} child
            enrolled in this academic year. A family voucher needs two — bill this
            child from{' '}
            <span className="font-medium">Fees → Vouchers → Generate</span> instead.
          </p>
        ) : (
          <div className="space-y-4">
            <ul className="divide-y divide-line text-sm">
              {preview.siblings.map((sibling) => {
                const clash = preview.clashes.find(
                  (row) => row.studentProfileId === sibling.studentProfileId,
                );

                return (
                  <li
                    key={sibling.studentProfileId}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{sibling.studentName}</p>
                      <p className="font-mono text-xs text-ink-muted">
                        {sibling.studentNumber}
                      </p>
                    </div>

                    {clash === undefined ? (
                      <span className="text-xs text-ink-muted">Will be billed</span>
                    ) : (
                      <span className="text-right text-xs text-status-warning-ink">
                        <span className="font-mono">{clash.challanNumber}</span>
                        {clash.familyChallanNumber === null ? null : (
                          <span className="block text-ink-muted">
                            on family voucher{' '}
                            <span className="font-mono">
                              {clash.familyChallanNumber}
                            </span>
                          </span>
                        )}
                        {Number(clash.paidAmount) > 0 ? (
                          <span className="block text-ink-muted">
                            {formatPkr(clash.paidAmount)} already received
                          </span>
                        ) : null}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            {paidClashes.length > 0 ? (
              <p
                role="status"
                className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
              >
                {paidClashes.length === 1 ? 'One child has' : 'Some of these children have'}{' '}
                already paid something towards this month, so{' '}
                {paidClashes.length === 1 ? 'that voucher' : 'those vouchers'} cannot be
                cancelled — a cancelled voucher with a receipt against it is a receipt
                pointing at nothing. Settle the month for{' '}
                {paidClashes.length === 1 ? 'that child' : 'those children'} separately.
              </p>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                disabled={generating}
                onClick={() => {
                  setPreview(null);
                }}
              >
                Cancel
              </Button>

              {preview.clashes.length === 0 ? (
                <Button
                  isLoading={generating}
                  onClick={() => {
                    void generate(false);
                  }}
                >
                  Raise {String(preview.siblings.length)} vouchers
                </Button>
              ) : paidClashes.length > 0 ? null : (
                <Button
                  isLoading={generating}
                  onClick={() => {
                    void generate(true);
                  }}
                >
                  Cancel {String(unpaidClashes.length)} and continue
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
