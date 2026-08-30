'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { LATE_FEE_TYPES, LATE_FEE_TYPE_LABELS, type LateFeeType } from '@/db/schema/late-fee-rules';
import { formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The school's fee settings: when vouchers fall due, what happens to a family's
 * sibling discount, and the late fee policy.
 *
 * Off by default and deliberately hard to switch on by accident: a policy here
 * decides what every parent in the school is charged for being a day late, so
 * the form refuses to enable itself without an amount and explains in plain
 * words what the current settings would actually charge.
 *
 * Sprint 20 added the sibling-discount card in the middle, and the same rule
 * governs it: both toggles default off, both say what they will do in words,
 * and the auto-apply one warns when it would do nothing because the school has
 * no sibling scheme to grant.
 */

export interface LateFeeSettingsFormProps {
  initial: {
    dueDay: number;
    autoSendVouchers: boolean;
    autoSendDay: number;
    isEnabled: boolean;
    graceDays: number;
    lateFeeType: LateFeeType;
    lateFeeAmount: string;
    maxLateFee: string | null;
    autoApplySiblingDiscount: boolean;
    siblingDiscountForLastChild: boolean;
  };
  canEdit: boolean;
  /**
   * How many **active** schemes of type `sibling` this school has.
   *
   * Read on the server, because the toggle below is only meaningful if there is
   * exactly one scheme for the auto-apply to grant. Nought is a setting that
   * does nothing, silently, on the one screen where "nothing happened" and "it
   * worked" look identical. More than one is worse: the grant would have to
   * pick, and picking would file half a school's families under a rate nobody
   * chose — so it grants nothing, and the form says so here rather than leaving
   * the reason in a server log.
   */
  siblingSchemeCount: number;
}

export function LateFeeSettingsForm({
  initial,
  canEdit,
  siblingSchemeCount,
}: LateFeeSettingsFormProps) {
  const [dueDay, setDueDay] = useState(String(initial.dueDay));
  const [autoSendVouchers, setAutoSendVouchers] = useState(initial.autoSendVouchers);
  const [autoSendDay, setAutoSendDay] = useState(String(initial.autoSendDay));
  const [autoApplySibling, setAutoApplySibling] = useState(
    initial.autoApplySiblingDiscount,
  );
  const [siblingForLastChild, setSiblingForLastChild] = useState(
    initial.siblingDiscountForLastChild,
  );
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
          autoSendVouchers,
          autoSendDay: Number(autoSendDay) || 28,
          isEnabled,
          graceDays: Number(graceDays) || 0,
          lateFeeType,
          lateFeeAmount: Number(amount) || 0,
          maxLateFee: maxLateFee.trim() === '' ? null : Number(maxLateFee),
          autoApplySiblingDiscount: autoApplySibling,
          siblingDiscountForLastChild: siblingForLastChild,
        }),
      });

      setNotice('Fee settings saved.');
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the fee settings.'));
    } finally {
      setSaving(false);
    }
  };

  const grace = Number(graceDays) || 0;
  const parsedAmount = Number(amount) || 0;

  const summary = !isEnabled
    ? 'Late fees are switched off. Overdue vouchers are not charged anything extra.'
    : lateFeeType === 'fixed'
      ? `A voucher more than ${grace} day${grace === 1 ? '' : 's'} past its due date is charged ${formatPkr(parsedAmount)}, once.`
      : `A voucher is charged ${formatPkr(parsedAmount)} for every day past ${grace} day${
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
            description="When your monthly vouchers fall due."
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
            hint="Capped at the 28th so every month has that day. Individual vouchers can still be dated by hand."
            onChange={(event) => {
              setDueDay(event.target.value);
            }}
          />
        </div>

        {/*
          Off, and it stays off until somebody here turns it on.

          A school must never start emailing its parents because a sprint
          deployed, and an email cannot be recalled — so this is the one control
          in the fee module whose default is the inert one on purpose. The
          sweeper claims each school for the day with a conditional UPDATE, so
          the seven server processes in production produce one send between
          them; see `lib/voucher-auto-send.ts`.
        */}
        <div className="mt-6 space-y-4 border-t border-line pt-6">
          <Toggle
            checked={autoSendVouchers}
            onChange={setAutoSendVouchers}
            disabled={!canEdit}
            label="Email this month's vouchers automatically"
            description="Sends the vouchers you have already raised to each student's primary contact. It never generates one."
          />

          {autoSendVouchers ? (
            <div className="sm:max-w-xs">
              <Input
                label="Send on day"
                type="number"
                min={1}
                max={28}
                value={autoSendDay}
                disabled={!canEdit}
                hint="Capped at the 28th so every month has that day."
                onChange={(event) => {
                  setAutoSendDay(event.target.value);
                }}
              />
            </div>
          ) : null}
        </div>
      </Card>

      {/*
        Sprint 20, item 6. Two settings about the **sibling discount**, on the
        table that is already "the school's fee settings".

        Its own card rather than a third block on Billing, because the two
        questions have nothing to do with when a voucher falls due and one of
        them changes what a family is charged.
      */}
      <Card
        header={
          <CardTitle
            title="Sibling discount"
            description="What happens to a family's discount when a child joins, and when the last one is left."
          />
        }
      >
        <div className="space-y-5">
          {/*
            Off by default, and it must stay off until a school turns it on.

            This is the fee module's `autoSendVouchers`, and it is worse in one
            respect: an email cannot be recalled, and neither can a discount
            once the voucher carrying it has been printed and paid. Switching
            it back off next month does not undo anything already priced.
          */}
          <Toggle
            checked={autoApplySibling}
            onChange={setAutoApplySibling}
            disabled={!canEdit}
            label="Apply the sibling discount automatically"
            description="When a child is enrolled and the school already teaches a brother or sister, grant the sibling discount without being asked."
          />

          {autoApplySibling && siblingSchemeCount !== 1 ? (
            <p
              role="status"
              className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle"
            >
              {siblingSchemeCount === 0 ? (
                <>
                  This school has no active <strong>Sibling Discount</strong>{' '}
                  scheme, so nothing will be granted.
                </>
              ) : (
                <>
                  This school has {siblingSchemeCount} active{' '}
                  <strong>Sibling Discount</strong> schemes, so nothing will be
                  granted automatically — there is no way to tell which rate you
                  mean. Switch all but one off.
                </>
              )}{' '}
              <Link href="/dashboard/fees/concessions" className="font-medium underline">
                Fees → Concessions
              </Link>{' '}
              is where a scheme&apos;s kind is set.
            </p>
          ) : null}

          <Toggle
            checked={siblingForLastChild}
            onChange={setSiblingForLastChild}
            disabled={!canEdit}
            label="Keep the discount when only one child is left"
            description="By default the sibling discount is removed once a family has only one child still at the school. Switch this on to keep it."
          />

          <p className="rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
            {siblingForLastChild
              ? 'A child whose brothers and sisters have all left keeps their sibling discount.'
              : 'When a family is down to one child at this school, that child’s sibling discount is closed automatically and a note is written on the grant saying why. Vouchers already raised are not changed.'}
          </p>
        </div>
      </Card>

      <Card
        header={
          <CardTitle
            title="Late fees"
            description="Charged on vouchers that pass their due date."
          />
        }
      >
      <div className="space-y-5">
        <Toggle
          checked={isEnabled}
          onChange={setIsEnabled}
          disabled={!canEdit}
          label="Charge late fees"
          description="Applied when an overdue voucher has the charge added to it."
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
            <legend className="mb-1.5 block text-sm font-medium text-ink">
              How it is charged
            </legend>
            <div className="flex flex-col gap-2">
              {LATE_FEE_TYPES.map((value) => (
                <label key={value} className="flex items-center gap-2 text-sm text-ink">
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

        <p className="rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          {summary}
        </p>

        {error !== null ? (
          <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
            {error}
          </p>
        ) : null}

        {notice !== null ? (
          <p className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
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
          <p className="text-sm text-ink-muted">
            Only a school administrator can change these settings.
          </p>
        )}
      </div>
      </Card>
    </div>
  );
}
