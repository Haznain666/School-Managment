'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Toggle } from '@/components/ui/Toggle';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import {
  LATE_FEE_TYPES,
  LATE_FEE_TYPE_LABELS,
  type LateFeeType,
} from '@/db/schema/late-fee-rules';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Fee policy settings.
 *
 * Late fees default to off and stay off until switched on deliberately — a
 * school that has not thought about the policy should not start charging
 * families because a default said so.
 */

export interface FeeSettingsValues {
  isEnabled: boolean;
  graceDays: number;
  lateFeeType: LateFeeType;
  lateFeeAmount: string;
  maxLateFee: string | null;
  dueDayOfMonth: number;
  financialYearStartMonth: number;
  bankAccountDetails: string | null;
}

export interface FeeSettingsFormProps {
  initial: FeeSettingsValues;
  canEdit: boolean;
}

const TYPE_OPTIONS = LATE_FEE_TYPES.map((value) => ({
  value,
  label: LATE_FEE_TYPE_LABELS[value],
}));

const DUE_DAY_OPTIONS = Array.from({ length: 28 }, (_, index) => ({
  value: String(index + 1),
  label: String(index + 1),
}));

const MONTH_OPTIONS = MONTH_NAMES.map((label, index) => ({
  value: String(index + 1),
  label,
}));

export function FeeSettingsForm({ initial, canEdit }: FeeSettingsFormProps) {
  const router = useRouter();

  const [isEnabled, setIsEnabled] = useState(initial.isEnabled);
  const [graceDays, setGraceDays] = useState(String(initial.graceDays));
  const [lateFeeType, setLateFeeType] = useState<LateFeeType>(initial.lateFeeType);
  const [lateFeeAmount, setLateFeeAmount] = useState(initial.lateFeeAmount);
  const [maxLateFee, setMaxLateFee] = useState(initial.maxLateFee ?? '');
  const [dueDay, setDueDay] = useState(String(initial.dueDayOfMonth));
  const [fyStart, setFyStart] = useState(String(initial.financialYearStartMonth));
  const [bankDetails, setBankDetails] = useState(initial.bankAccountDetails ?? '');

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      await schoolFetch('/api/school/fees/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          isEnabled,
          graceDays: Number(graceDays),
          lateFeeType,
          lateFeeAmount,
          maxLateFee: maxLateFee.trim() === '' ? null : maxLateFee,
          dueDayOfMonth: Number(dueDay),
          financialYearStartMonth: Number(fyStart),
          bankAccountDetails: bankDetails,
        }),
      });

      setNotice('Settings saved.');
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the settings.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="space-y-6"
      noValidate
    >
      <Card header={<CardTitle title="Billing" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Challans fall due on"
            options={DUE_DAY_OPTIONS}
            value={dueDay}
            disabled={!canEdit || isSaving}
            hint="Day of the month. Capped at 28 so every month has it."
            onChange={(event) => {
              setDueDay(event.target.value);
            }}
          />
          <Select
            label="Financial year starts in"
            options={MONTH_OPTIONS}
            value={fyStart}
            disabled={!canEdit || isSaving}
            onChange={(event) => {
              setFyStart(event.target.value);
            }}
          />
          <div className="sm:col-span-2">
            <Textarea
              label="Bank deposit instructions"
              value={bankDetails}
              disabled={!canEdit || isSaving}
              hint="Printed on every challan. Account title, number and branch."
              placeholder={'Account Title: Green Valley School\nAccount No: 0123456789\nBank: HBL, Gulberg Branch'}
              rows={4}
              onChange={(event) => {
                setBankDetails(event.target.value);
              }}
            />
          </div>
        </div>
      </Card>

      <Card header={<CardTitle title="Late fees" />}>
        <Toggle
          label="Charge a late fee on overdue challans"
          description="Off by default. Nothing is charged until you switch this on."
          checked={isEnabled}
          disabled={!canEdit || isSaving}
          onChange={setIsEnabled}
        />

        {isEnabled ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Select
              label="Charge"
              options={TYPE_OPTIONS}
              value={lateFeeType}
              disabled={!canEdit || isSaving}
              hint={
                lateFeeType === 'daily'
                  ? 'Accrues for every day past the grace period.'
                  : 'One flat charge once the grace period lapses.'
              }
              onChange={(event) => {
                setLateFeeType(event.target.value as LateFeeType);
              }}
            />
            <Input
              label="Amount (PKR)"
              inputMode="decimal"
              value={lateFeeAmount}
              disabled={!canEdit || isSaving}
              onChange={(event) => {
                setLateFeeAmount(event.target.value);
              }}
            />
            <Input
              label="Grace days"
              type="number"
              min={0}
              max={90}
              value={graceDays}
              disabled={!canEdit || isSaving}
              hint="Days after the due date before anything is charged."
              onChange={(event) => {
                setGraceDays(event.target.value);
              }}
            />
            <Input
              label="Maximum late fee (PKR)"
              inputMode="decimal"
              value={maxLateFee}
              disabled={!canEdit || isSaving}
              hint={
                lateFeeType === 'daily'
                  ? 'Strongly recommended — a daily charge is otherwise unbounded.'
                  : 'Optional cap. Leave blank for none.'
              }
              onChange={(event) => {
                setMaxLateFee(event.target.value);
              }}
            />
          </div>
        ) : null}
      </Card>

      {notice !== null ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {canEdit ? (
        <Button type="submit" isLoading={isSaving}>
          Save settings
        </Button>
      ) : null}
    </form>
  );
}
