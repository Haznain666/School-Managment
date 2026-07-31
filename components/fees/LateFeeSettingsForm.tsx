'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { LATE_FEE_TYPES, LATE_FEE_TYPE_LABELS, type LateFeeType } from '@/db/schema/late-fee-rules';
import { formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The school's late fee policy.
 *
 * Off by default and deliberately hard to switch on by accident: a policy here
 * decides what every parent in the school is charged for being a day late, so
 * the form refuses to enable itself without an amount and explains in plain
 * words what the current settings would actually charge.
 */

export interface LateFeeSettingsFormProps {
  initial: {
    dueDay: number;
    isEnabled: boolean;
    graceDays: number;
    lateFeeType: LateFeeType;
    lateFeeAmount: string;
    maxLateFee: string | null;
  };
  canEdit: boolean;
}

export function LateFeeSettingsForm({ initial, canEdit }: LateFeeSettingsFormProps) {
  const [dueDay, setDueDay] = useState(String(initial.dueDay));
  const [isEnabled, setIsEnabled] = useState(initial.isEnabled);
  const [graceDays, setGraceDays] = useState(String(initial.graceDays));
  const [lateFeeType, setLateFeeType] = useState<LateFeeType>(initial.lateFeeType);
  const [amount, setAmount] = useState(String(Number(initial.lateFeeAmount)));
  const [maxLateFee, setMaxLateFee] = useState(
    initial.maxLateFee === null ? '' : String(Number(initial.maxLateFee)),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      await schoolFetch('/api/school/fees/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          dueDay: Number(dueDay) || 10,
          isEnabled,
          graceDays: Number(graceDays) || 0,
          lateFeeType,
          lateFeeAmount: Number(amount) || 0,
          maxLateFee: maxLateFee.trim() === '' ? null : Number(maxLateFee),
        }),
      });

      setNotice('Late fee settings saved.');
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the late fee settings.'));
    } finally {
      setSaving(false);
    }
  };

  const grace = Number(graceDays) || 0;
  const parsedAmount = Number(amount) || 0;

  const summary = !isEnabled
    ? 'Late fees are switched off. Overdue challans are not charged anything extra.'
    : lateFeeType === 'fixed'
      ? `A challan more than ${grace} day${grace === 1 ? '' : 's'} past its due date is charged ${formatPkr(parsedAmount)}, once.`
      : `A challan is charged ${formatPkr(parsedAmount)} for every day past ${grace} day${
          grace === 1 ? '' : 's'
        } overdue` +
        (maxLateFee.trim() === ''
          ? ', with no upper limit.'
          : `, up to ${formatPkr(Number(maxLateFee))}.`);

  return (
    <div className="space-y-4">
      <Card
        header={
          <CardTitle
            title="Billing"
            description="When your monthly challans fall due."
          />
        }
      >
        <div className="sm:max-w-xs">
          <Input
            label="Due day of the month"
            type="number"
            min={1}
            max={28}
            value={dueDay}
            disabled={!canEdit}
            hint="Capped at the 28th so every month has that day. Individual challans can still be dated by hand."
            onChange={(event) => {
              setDueDay(event.target.value);
            }}
          />
        </div>
      </Card>

      <Card
        header={
          <CardTitle
            title="Late fees"
            description="Charged on challans that pass their due date."
          />
        }
      >
      <div className="space-y-5">
        <Toggle
          checked={isEnabled}
          onChange={setIsEnabled}
          disabled={!canEdit}
          label="Charge late fees"
          description="Applied when an overdue challan has the charge added to it."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Grace days"
            type="number"
            min={0}
            max={90}
            value={graceDays}
            disabled={!canEdit}
            hint="Days after the due date before anything is charged."
            onChange={(event) => {
              setGraceDays(event.target.value);
            }}
          />

          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium text-slate-700">
              How it is charged
            </legend>
            <div className="flex flex-col gap-2">
              {LATE_FEE_TYPES.map((value) => (
                <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="lateFeeType"
                    value={value}
                    checked={lateFeeType === value}
                    disabled={!canEdit}
                    className="h-4 w-4 accent-brand-primary"
                    onChange={() => {
                      setLateFeeType(value);
                    }}
                  />
                  {LATE_FEE_TYPE_LABELS[value]}
                </label>
              ))}
            </div>
          </fieldset>

          <Input
            label="Late fee amount (PKR)"
            type="number"
            min={0}
            step="0.01"
            value={amount}
            disabled={!canEdit}
            hint={lateFeeType === 'daily' ? 'Charged per day overdue.' : 'Charged once.'}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />

          <Input
            label="Maximum late fee (PKR)"
            type="number"
            min={0}
            step="0.01"
            value={maxLateFee}
            disabled={!canEdit || lateFeeType === 'fixed'}
            hint={
              lateFeeType === 'fixed'
                ? 'Only applies to a daily charge.'
                : 'Leave blank for no ceiling.'
            }
            onChange={(event) => {
              setMaxLateFee(event.target.value);
            }}
          />
        </div>

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {summary}
        </p>

        {error !== null ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {notice !== null ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {notice}
          </p>
        ) : null}

        {canEdit ? (
          <Button
            isLoading={saving}
            onClick={() => {
              void save();
            }}
          >
            Save settings
          </Button>
        ) : (
          <p className="text-sm text-slate-500">
            Only a school administrator can change these settings.
          </p>
        )}
      </div>
      </Card>
    </div>
  );
}
