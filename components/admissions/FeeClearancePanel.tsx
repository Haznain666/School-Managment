'use client';

import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import type { AdmissionFeeState } from '@/lib/admission-fee';
import { remainingBalance } from '@/lib/fee-calculator';
import { formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * "What does this child's admission fee say, and what can I do about it?" — on
 * one student's profile.
 *
 * ── What this used to be, and what that cost ─────────────────────────────
 * Until Sprint 17 this card was headed *Admission fee* and had no connection
 * whatsoever to the school's Admission Fee head. It asked one question — has
 * somebody ticked this enrolment as paid — and offered one button, *Confirm the
 * fee was paid*, which sent the guardians their portal welcome.
 *
 * So the button was available on a student whose grade had **no admission fee
 * priced at all**, and clicking it settled an admission against an amount that
 * did not exist. Nothing was billed, nothing was owed, nothing was reported.
 * That is exactly what happened at Lahore Grammar School, and it is why the
 * card is now driven by `resolveAdmissionFee`.
 *
 * ── The ordering rule, made structural ───────────────────────────────────
 * The product owner's rule is that **you cannot confirm a payment for a fee
 * that was never billed**. It is enforced here by the `switch` below and not by
 * a condition tucked into the JSX: the confirm-payment control exists in
 * exactly two branches, `billed` and `settled`, and a reviewer can see that by
 * reading the four cases in order. A boolean prop could be got wrong by a
 * caller; a case that does not render a button cannot be.
 */

export interface FeeClearancePanelProps {
  studentProfileId: string;
  /** Resolved on the server by `resolveAdmissionFee`. */
  state: AdmissionFeeState;
  feeClearedAt: string | null;
  /** `fees.write`. Without it this is read-only. */
  canClear: boolean;
  /** Whether any guardian has an address the welcome could go to. */
  hasContactableGuardian: boolean;
}

export function FeeClearancePanel({
  studentProfileId,
  state,
  feeClearedAt,
  canClear,
  hasContactableGuardian,
}: FeeClearancePanelProps) {
  const router = useRouter();

  const [busy, setBusy] = useState<'clear' | 'generate' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const clear = async (): Promise<void> => {
    setBusy('clear');
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{
        welcomesQueued: number;
        problems: string[];
      }>(`/api/school/students/${studentProfileId}/fee-clearance`, { method: 'POST' });

      setNotice(
        [
          'Enrolment confirmed.',
          result.welcomesQueued === 0
            ? 'No parent portal welcome could be queued.'
            : `${result.welcomesQueued} parent portal welcome${
                result.welcomesQueued === 1 ? '' : 's'
              } queued.`,
          ...result.problems,
        ].join(' '),
      );

      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not confirm the enrolment.'));
    } finally {
      setBusy(null);
    }
  };

  const generate = async (): Promise<void> => {
    setBusy('generate');
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{
        challan: { challanNumber: string; totalAmount: string; creditApplied: string };
      }>(`/api/school/students/${studentProfileId}/admission-challan`, {
        method: 'POST',
      });

      setNotice(
        `Voucher ${result.challan.challanNumber} raised for ${formatPkr(
          result.challan.totalAmount,
        )}.`,
      );

      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not raise the admission voucher.'));
    } finally {
      setBusy(null);
    }
  };

  // A student with no active enrolment has no admission to charge for. The
  // profile page already applies the same rule before rendering this at all;
  // the guard is repeated because the component must be safe to place anywhere.
  if (state.kind === 'not_enrolled') return null;

  const messages = (
    <>
      {notice !== null ? (
        <p className="mt-3 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-onSubtle">
          {notice}
        </p>
      ) : null}

      {error !== null ? (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}
    </>
  );

  const confirmButton = canClear ? (
    <>
      <Button
        className="mt-4"
        variant="secondary"
        isLoading={busy === 'clear'}
        disabled={busy !== null}
        onClick={() => {
          void clear();
        }}
      >
        Confirm the fee was paid
      </Button>
      <p className="mt-2 text-xs text-ink-muted">
        For a fee taken in cash without recording it against the voucher. This
        cannot be undone — it sends the guardians their portal welcome.
      </p>
    </>
  ) : null;

  switch (state.kind) {
    /*
     * No price for this grade and year — the state LGS was in, on every one of
     * its fourteen grades for the Examination Fee.
     *
     * A danger callout rather than a warning, and no action but the link. There
     * is genuinely nothing an administrator can do from here: a voucher would
     * bill an amount nobody has decided, and confirming a payment would settle
     * an admission against one. Sending them to the price list is the only
     * honest thing this card can offer.
     */
    case 'no_amount':
      return (
        <Card
          header={
            <CardTitle
              title="Admission fee"
              description={`${state.head.name} · ${state.placement.gradeName} · ${state.placement.academicYearName}`}
            />
          }
        >
          <div
            role="alert"
            className="flex gap-3 rounded-lg bg-status-danger-subtle px-3 py-3 text-sm text-status-danger-ink"
          >
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">
                The admission fee has not been set for {state.placement.gradeName}.
              </p>
              <p className="mt-1">
                No amount exists for {state.head.name} in{' '}
                {state.placement.academicYearName}, so no voucher can be raised and
                this admission cannot be confirmed. If this grade genuinely pays no
                admission fee, enter <strong>0</strong> — a blank cell means
                &ldquo;not decided&rdquo;, not &ldquo;free&rdquo;.
              </p>
            </div>
          </div>

          <Link
            href="/dashboard/fees/structures"
            className="mt-4 inline-flex text-sm font-medium text-brand-primary hover:underline"
          >
            Set the fee structure →
          </Link>

          {messages}
        </Card>
      );

    /*
     * The school has no one-time fee head at all. Same shape as `no_amount` and
     * a different destination: there is nothing to price until there is a head
     * to price it under. After Sprint 17's provisioning seed this state exists
     * only for schools created before that deploy.
     */
    case 'no_fee_head':
      return (
        <Card header={<CardTitle title="Admission fee" />}>
          <div
            role="alert"
            className="flex gap-3 rounded-lg bg-status-danger-subtle px-3 py-3 text-sm text-status-danger-ink"
          >
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">This school has no admission fee head.</p>
              <p className="mt-1">
                Nothing can be billed for an admission until there is a one-time
                fee head to bill it under.
              </p>
            </div>
          </div>

          <Link
            href="/dashboard/fees/types"
            className="mt-4 inline-flex text-sm font-medium text-brand-primary hover:underline"
          >
            Add the fee heads →
          </Link>

          {messages}
        </Card>
      );

    /*
     * Priced and not billed. The voucher is the primary action and the
     * confirmation is **not rendered** — that is the ordering rule, and it is
     * the reason this branch exists separately from `billed`.
     */
    case 'not_billed':
      return (
        <Card
          header={
            <CardTitle
              title="Admission fee"
              description={`${state.head.name} · ${state.placement.gradeName} · ${state.placement.academicYearName}`}
            />
          }
        >
          <p className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
            Not yet billed. The student is enrolled and appears on every register
            and class list, but no admission voucher has been raised and the
            guardians have no parent portal login.
          </p>

          <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-3">
            <Figure label="Fee" value={formatPkr(state.amount)} />
            <Figure label="Discount" value={`− ${formatPkr(state.concessionAmount)}`} />
            <Figure label="Voucher total" value={formatPkr(state.netAmount)} strong />
          </dl>

          {hasContactableGuardian ? null : (
            <p className="mt-3 text-sm text-ink-muted">
              No guardian on this record has an email address, so there is nowhere
              to send a portal welcome even once the fee is paid. Add one below.
            </p>
          )}

          {canClear ? (
            <Button
              className="mt-4"
              isLoading={busy === 'generate'}
              disabled={busy !== null}
              onClick={() => {
                void generate();
              }}
            >
              Generate the admission fee voucher
            </Button>
          ) : null}

          {messages}
        </Card>
      );

    /*
     * Billed and still owing. Only now is the confirmation offered — there is a
     * voucher for it to be a confirmation *of*, and a challan number to say so
     * against.
     */
    case 'billed':
      return (
        <Card
          header={
            <CardTitle
              title="Admission fee"
              description={`${state.head.name} · ${state.placement.gradeName} · ${state.placement.academicYearName}`}
            />
          }
        >
          <p className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
            Billed on voucher{' '}
            <Link
              href={`/dashboard/fees/challans/${state.challan.id}`}
              className="font-medium underline"
            >
              {state.challan.challanNumber}
            </Link>
            , due {state.challan.dueDate}. Recording the payment against it
            confirms the admission automatically and sends the guardians their
            portal welcome.
          </p>

          <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-3">
            <Figure label="Demanded" value={formatPkr(state.challan.totalAmount)} />
            <Figure label="Received" value={formatPkr(state.challan.paidAmount)} />
            {/*
              Through `remainingBalance`, not `Number(a) - Number(b)`. Both are
              NUMERIC strings and subtracting them as doubles is exactly the
              float-rupee arithmetic `lib/money.ts` exists to prevent.
            */}
            <Figure
              label="Outstanding"
              value={formatPkr(
                remainingBalance(state.challan.totalAmount, state.challan.paidAmount),
              )}
              strong
            />
          </dl>

          {hasContactableGuardian ? null : (
            <p className="mt-3 text-sm text-ink-muted">
              No guardian on this record has an email address, so there is nowhere
              to send a portal welcome even once the fee clears. Add one below.
            </p>
          )}

          {confirmButton}
          {messages}
        </Card>
      );

    /*
     * Paid, waived, cancelled — or cleared by hand at a desk.
     *
     * The confirmation is still offered here, and only when `feeClearedAt` is
     * null. That is the narrow but real case of a voucher **waived** or
     * cancelled by the school: the fee is settled, but nothing ever moved the
     * enrolment out of `outstanding`, so the guardians are still sitting
     * without a portal login and no other screen would ever say why.
     */
    case 'settled':
      return (
        <Card header={<CardTitle title="Admission fee" />}>
          <p className="text-sm text-ink-muted">
            {feeClearedAt === null
              ? 'Settled — nothing further is owed on this admission.'
              : `Paid, so this enrolment is confirmed — recorded ${new Date(
                  feeClearedAt,
                ).toLocaleDateString('en-GB')}. Guardians with an email address have been sent their parent portal welcome.`}
          </p>

          {state.challan === null ? null : (
            <p className="mt-2 text-sm text-ink-muted">
              Voucher{' '}
              <Link
                href={`/dashboard/fees/challans/${state.challan.id}`}
                className="font-medium text-brand-primary hover:underline"
              >
                {state.challan.challanNumber}
              </Link>{' '}
              — {formatPkr(state.challan.totalAmount)}.
            </p>
          )}

          {feeClearedAt === null ? confirmButton : null}
          {messages}
        </Card>
      );
  }
}

function Figure({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className={strong ? 'mt-0.5 text-sm font-semibold text-ink' : 'mt-0.5 text-sm text-ink'}>
        {value}
      </dd>
    </div>
  );
}
