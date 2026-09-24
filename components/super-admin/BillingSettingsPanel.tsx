'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import { INVOICE_BADGE } from '@/components/super-admin/invoice-badge';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { formatMoneyMinor, fromPaise, toPaise } from '@/lib/money';
import {
  convertMinor,
  monthlyEstimate,
  rateToUnits,
  shortDate,
  trialEndsOn,
  type BillingCurrency,
  type BillingEnvironment,
  type InvoiceDisplayStatus,
} from '@/lib/platform-billing';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

/**
 * The Billing tab — Sprint 35, §2.
 *
 * Everything that decides what a school pays, on one screen, with the monthly
 * estimate recomputed as it is typed. The estimate comes from
 * `monthlyEstimate` in `lib/platform-billing.ts` — the same function the check
 * script asserts the spec's USD 162.00 example against — so what this screen
 * promises and what the generator bills cannot drift apart.
 *
 * ── Two changes ask first ────────────────────────────────────────────────
 * Going Live starts the trial and, after it, the invoices; the date shown in
 * the confirmation is the one that will be stored. Changing the invoice
 * currency changes what every future invoice says. Both are one click to do
 * and awkward to explain to a school afterwards, so both are confirmed.
 *
 * ── What is never on it ──────────────────────────────────────────────────
 * The rule that decides when a paid-in-part invoice stops blocking (E6). The
 * access card says Active or Blocked, and why in the history below it; the
 * rule itself is server-side only.
 */

export interface BillingOverviewData {
  school: { id: string; name: string; slug: string; locationId: string; accessBlockedAt: string | null };
  settings: {
    environment: BillingEnvironment;
    liveSince: string | null;
    billingCurrency: BillingCurrency;
    invoiceCurrency: BillingCurrency;
    usdToPkrRate: string | null;
    trialDays: number;
    graceDays: number;
    trialEndsOn: string | null;
    invoiceEmail: string | null;
  };
  roles: { role: string; label: string; count: number; rateMinor: number }[];
  modules: { key: string; label: string; enabled: boolean; included: boolean; rateMinor: number }[];
  invoices: {
    id: string;
    invoiceNumber: string;
    periodStart: string;
    currency: BillingCurrency;
    totalMinor: number;
    receivedMinor: number;
    status: InvoiceDisplayStatus;
    statusLabel: string;
    dueDate: string;
  }[];
  adminEmail: string | null;
  events: { action: string; reason: string; actor: string; at: string }[];
  today: string;
}

export interface BillingSettingsPanelProps {
  initial: BillingOverviewData;
  canEdit: boolean;
  canGenerate: boolean;
}

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD — US dollar' },
  { value: 'PKR', label: 'PKR — Pakistani rupee' },
];

const ENVIRONMENT_OPTIONS = [
  { value: 'sandbox', label: 'Sandbox — no invoices, no blocking' },
  { value: 'live', label: 'Live — invoiced monthly in arrears' },
];

const REASON_LABELS: Record<string, string> = {
  manual: 'by hand',
  overdue: 'invoice past its grace period',
  payment: 'payment received',
};

/** A minor-unit amount as the operator would type it: `1`, `2.5`, `50`. */
function asInput(minor: number): string {
  return minor === 0 ? '' : String(fromPaise(minor));
}

function isAmount(text: string): boolean {
  return text.trim() === '' || /^\d{1,9}(\.\d{1,2})?$/.test(text.trim());
}

export function BillingSettingsPanel({ initial, canEdit, canGenerate }: BillingSettingsPanelProps) {
  const [data, setData] = useState(initial);

  const [environment, setEnvironment] = useState<BillingEnvironment>(initial.settings.environment);
  const [billingCurrency, setBillingCurrency] = useState<BillingCurrency>(initial.settings.billingCurrency);
  const [invoiceCurrency, setInvoiceCurrency] = useState<BillingCurrency>(initial.settings.invoiceCurrency);
  const [rate, setRate] = useState(initial.settings.usdToPkrRate ?? '');
  const [trialDays, setTrialDays] = useState(String(initial.settings.trialDays));
  const [graceDays, setGraceDays] = useState(String(initial.settings.graceDays));
  const [invoiceEmail, setInvoiceEmail] = useState(initial.settings.invoiceEmail ?? '');
  const [roleRates, setRoleRates] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.roles.map((role) => [role.role, asInput(role.rateMinor)])),
  );
  const [moduleRates, setModuleRates] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.modules.map((entry) => [entry.key, asInput(entry.rateMinor)])),
  );

  const [confirmLive, setConfirmLive] = useState(false);
  const [pendingCurrency, setPendingCurrency] = useState<BillingCurrency | null>(null);
  const [confirmAccess, setConfirmAccess] = useState<'block' | 'unblock' | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isChangingAccess, setIsChangingAccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const today = data.today;
  const currenciesDiffer = billingCurrency !== invoiceCurrency;
  const trialNumber = Number.parseInt(trialDays, 10);
  const previewLiveSince =
    environment === 'live' ? (data.settings.liveSince ?? today) : null;
  const previewTrialEnd = trialEndsOn(
    previewLiveSince,
    Number.isFinite(trialNumber) && trialNumber > 0 ? trialNumber : 0,
  );

  const estimate = useMemo(
    () =>
      monthlyEstimate(
        data.roles.map((role) => ({
          role: role.role,
          label: role.label,
          count: role.count,
          rateMinor: isAmount(roleRates[role.role] ?? '') ? toPaise(roleRates[role.role]) : 0,
        })),
        data.modules
          .filter((entry) => entry.enabled && !entry.included)
          .map((entry) => ({
            key: entry.key,
            label: entry.label,
            rateMinor: isAmount(moduleRates[entry.key] ?? '') ? toPaise(moduleRates[entry.key]) : 0,
          })),
      ),
    [data.roles, data.modules, roleRates, moduleRates],
  );

  const convertedEstimate = useMemo(() => {
    if (!currenciesDiffer) return null;
    const units = rateToUnits(rate);
    if (units === null) return null;
    return convertMinor(estimate.totalMinor, billingCurrency, invoiceCurrency, units);
  }, [currenciesDiffer, rate, estimate.totalMinor, billingCurrency, invoiceCurrency]);

  const save = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const next = await superAdminFetch<BillingOverviewData>(
        `/api/super-admin/schools/${data.school.id}/billing`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            environment,
            billingCurrency,
            invoiceCurrency,
            usdToPkrRate: currenciesDiffer ? rate : '',
            trialDays,
            graceDays,
            invoiceEmail,
            roleRates,
            moduleRates: Object.fromEntries(
              data.modules
                .filter((entry) => !entry.included)
                .map((entry) => [entry.key, moduleRates[entry.key] ?? '']),
            ),
          }),
        },
      );
      setData(next);
      setEnvironment(next.settings.environment);
      setNotice('Billing settings saved.');
    } catch (caught) {
      setError(caught instanceof SuperAdminApiError ? caught.message : 'Could not save billing settings.');
    } finally {
      setIsSaving(false);
    }
  }, [
    data.school.id,
    data.modules,
    environment,
    billingCurrency,
    invoiceCurrency,
    currenciesDiffer,
    rate,
    trialDays,
    graceDays,
    invoiceEmail,
    roleRates,
    moduleRates,
  ]);

  const reload = useCallback(async () => {
    const next = await superAdminFetch<BillingOverviewData>(
      `/api/super-admin/schools/${data.school.id}/billing`,
    );
    setData(next);
  }, [data.school.id]);

  const generate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await superAdminFetch<{ status: string; invoiceId: string | null; period: string }>(
        `/api/super-admin/schools/${data.school.id}/billing/generate`,
        { method: 'POST' },
      );
      setNotice(
        result.status === 'created'
          ? `Draft invoice raised for ${result.period}.`
          : `The invoice for ${result.period} already exists.`,
      );
      await reload();
    } catch (caught) {
      setError(caught instanceof SuperAdminApiError ? caught.message : 'Could not generate the invoice.');
    } finally {
      setIsGenerating(false);
    }
  }, [data.school.id, reload]);

  const changeAccess = useCallback(
    async (action: 'block' | 'unblock') => {
      setIsChangingAccess(true);
      setError(null);
      setNotice(null);
      try {
        const result = await superAdminFetch<{ changed: boolean }>(
          `/api/super-admin/schools/${data.school.id}/billing/access`,
          { method: 'POST', body: JSON.stringify({ action }) },
        );
        setNotice(
          result.changed
            ? action === 'block'
              ? 'The school is blocked. Its administrator has been emailed.'
              : 'The school is unblocked. Its administrator has been emailed.'
            : 'Nothing changed — the school was already in that state.',
        );
        setConfirmAccess(null);
        await reload();
      } catch (caught) {
        setError(caught instanceof SuperAdminApiError ? caught.message : 'Could not change access.');
      } finally {
        setIsChangingAccess(false);
      }
    },
    [data.school.id, reload],
  );

  const blocked = data.school.accessBlockedAt !== null;
  const disabled = !canEdit || isSaving;

  return (
    <div className="space-y-6">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}
      {notice !== null ? (
        <p role="status" className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      <Card header={<CardTitle title="Environment and currency" />}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Select
              label="Environment"
              options={ENVIRONMENT_OPTIONS}
              value={environment}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value === 'live' ? 'live' : 'sandbox';
                if (next === 'live' && data.settings.environment !== 'live') {
                  setConfirmLive(true);
                  return;
                }
                setEnvironment(next);
              }}
            />
            <p className="mt-1.5 text-xs text-ink-muted">
              {environment === 'live'
                ? `Live since ${shortDate(previewLiveSince ?? today)}.`
                : 'Sandbox schools are never invoiced, reminded or blocked.'}
            </p>
          </div>

          <Input
            label="Invoice email"
            type="email"
            value={invoiceEmail}
            disabled={disabled}
            placeholder={data.adminEmail ?? 'admin@school.edu.pk'}
            hint="Where invoices go by default. Sending one elsewhere makes that the new default."
            onChange={(event) => {
              setInvoiceEmail(event.target.value);
            }}
          />

          <Select
            label="Billing currency"
            options={CURRENCY_OPTIONS}
            value={billingCurrency}
            disabled={disabled}
            hint="The currency the rates below are in."
            onChange={(event) => {
              const next = event.target.value === 'PKR' ? 'PKR' : 'USD';
              setBillingCurrency(next);
              if (data.invoices.length === 0 && invoiceCurrency === billingCurrency) {
                // A school never invoiced has nothing to confuse: keep the two
                // together until somebody deliberately separates them.
                setInvoiceCurrency(next);
              }
            }}
          />

          <Select
            label="Invoice currency"
            options={CURRENCY_OPTIONS}
            value={invoiceCurrency}
            disabled={disabled}
            hint="The currency invoices are issued in."
            onChange={(event) => {
              const next = event.target.value === 'PKR' ? 'PKR' : 'USD';
              if (next !== invoiceCurrency) setPendingCurrency(next);
            }}
          />

          {currenciesDiffer ? (
            <Input
              label="USD → PKR rate"
              inputMode="decimal"
              value={rate}
              disabled={disabled}
              placeholder="e.g. 280.5"
              hint="PKR per 1 USD. Amounts are worked out in the billing currency and converted at this rate."
              error={rate.trim() !== '' && rateToUnits(rate) === null ? 'Enter a positive number.' : undefined}
              onChange={(event) => {
                setRate(event.target.value);
              }}
            />
          ) : null}
        </div>
      </Card>

      <Card header={<CardTitle title="Trial and grace" />}>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="Trial period (days)"
            inputMode="numeric"
            value={trialDays}
            disabled={disabled}
            hint={
              previewTrialEnd === null
                ? environment === 'live'
                  ? 'No trial: billing starts the day the school went Live.'
                  : 'The trial starts on the day the school is switched to Live.'
                : `Last free day: ${shortDate(previewTrialEnd)}.`
            }
            onChange={(event) => {
              setTrialDays(event.target.value.replace(/\D/g, ''));
            }}
          />
          <Input
            label="Grace period (days)"
            inputMode="numeric"
            value={graceDays}
            disabled={disabled}
            hint="Days after the 10th before an unpaid invoice blocks the school."
            onChange={(event) => {
              setGraceDays(event.target.value.replace(/\D/g, ''));
            }}
          />
        </div>
      </Card>

      <Card
        header={
          <CardTitle
            title="Rates"
            description={`Per month, in ${billingCurrency}. Parents are never billed.`}
          />
        }
      >
        <div className="space-y-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="py-2 font-semibold">Role</th>
                <th className="py-2 text-right font-semibold">Users</th>
                <th className="py-2 text-right font-semibold">Rate per user</th>
                <th className="py-2 text-right font-semibold">Line total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.roles.map((role) => {
                const text = roleRates[role.role] ?? '';
                const valid = isAmount(text);
                return (
                  <tr key={role.role}>
                    <td className="py-2 text-ink">{role.label}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{role.count}</td>
                    <td className="py-1.5 text-right">
                      <div className="ml-auto w-28">
                        <Input
                          label={`${role.label} rate`}
                          hideLabel
                          inputMode="decimal"
                          value={text}
                          disabled={disabled}
                          placeholder="0"
                          error={valid ? undefined : 'Amount'}
                          onChange={(event) => {
                            setRoleRates((current) => ({ ...current, [role.role]: event.target.value }));
                          }}
                        />
                      </div>
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {formatMoneyMinor(valid ? role.count * toPaise(text) : 0, billingCurrency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="py-2 font-semibold">Module</th>
                <th className="py-2 text-right font-semibold">Monthly rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.modules
                .filter((entry) => entry.included || entry.enabled)
                .map((entry) => {
                  const text = moduleRates[entry.key] ?? '';
                  return (
                    <tr key={entry.key}>
                      <td className="py-2 text-ink">{entry.label}</td>
                      <td className="py-1.5 text-right">
                        {entry.included ? (
                          <Badge variant="success">Included</Badge>
                        ) : (
                          <div className="ml-auto w-28">
                            <Input
                              label={`${entry.label} rate`}
                              hideLabel
                              inputMode="decimal"
                              value={text}
                              disabled={disabled}
                              placeholder="0"
                              error={isAmount(text) ? undefined : 'Amount'}
                              onChange={(event) => {
                                setModuleRates((current) => ({ ...current, [entry.key]: event.target.value }));
                              }}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <p className="text-xs text-ink-muted">
            Only modules switched on for this school are listed. A module switched off carries no
            charge.
          </p>

          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-surface-sunken px-4 py-3">
            <span className="text-sm font-medium text-ink">Monthly estimate</span>
            <span className="text-right">
              <span className="font-mono text-lg font-semibold tabular-nums text-ink">
                {formatMoneyMinor(estimate.totalMinor, billingCurrency)}
              </span>
              {convertedEstimate !== null ? (
                <span className="block text-xs text-ink-muted">
                  about {formatMoneyMinor(convertedEstimate, invoiceCurrency)} on the invoice
                </span>
              ) : null}
            </span>
          </div>
        </div>
      </Card>

      {canEdit ? (
        <div className="flex flex-wrap gap-3">
          <Button isLoading={isSaving} onClick={() => void save()}>
            Save billing settings
          </Button>
        </div>
      ) : null}

      <Card
        header={
          <CardTitle
            title="Access"
            action={<Badge variant={blocked ? 'danger' : 'success'}>{blocked ? 'Blocked' : 'Active'}</Badge>}
          />
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            {blocked
              ? `Blocked since ${new Date(data.school.accessBlockedAt ?? '').toLocaleString('en-GB')}. Everybody at the school sees a suspended notice; the school administrator sees what is owed.`
              : 'Open. A Live school is blocked automatically when a finalized invoice is still unpaid after the due date and the grace period.'}
          </p>
          {canEdit ? (
            <Button
              variant={blocked ? 'secondary' : 'danger'}
              onClick={() => {
                setConfirmAccess(blocked ? 'unblock' : 'block');
              }}
            >
              {blocked ? 'Unblock' : 'Block'}
            </Button>
          ) : null}

          {data.events.length > 0 ? (
            <ul className="space-y-1 border-t border-line pt-3 text-xs text-ink-muted">
              {data.events.map((event) => (
                <li key={`${event.at}-${event.action}`}>
                  {new Date(event.at).toLocaleString('en-GB')} — {event.action},{' '}
                  {REASON_LABELS[event.reason] ?? event.reason} ({event.actor})
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Card>

      <Card
        header={
          <CardTitle
            title="Invoices"
            description="Raised on the 1st for the month before, in arrears."
            action={
              canGenerate ? (
                <Button
                  variant="secondary"
                  size="sm"
                  isLoading={isGenerating}
                  onClick={() => void generate()}
                >
                  Generate now
                </Button>
              ) : undefined
            }
          />
        }
      >
        {data.invoices.length === 0 ? (
          <p className="text-sm text-ink-muted">No invoices yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <Link
                  href={`/super-admin/billing/invoices/${invoice.id}`}
                  className="font-mono text-sm font-medium text-brand-primary hover:underline"
                >
                  {invoice.invoiceNumber}
                </Link>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-sm tabular-nums text-ink">
                    {formatMoneyMinor(invoice.totalMinor, invoice.currency)}
                  </span>
                  <Badge variant={INVOICE_BADGE[invoice.status]}>{invoice.statusLabel}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={confirmLive}
        onClose={() => {
          setConfirmLive(false);
        }}
        title="Switch this school to Live?"
        description={`Live from ${shortDate(today)}. The trial starts today, and invoices follow it.`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmLive(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setEnvironment('live');
                setConfirmLive(false);
              }}
            >
              Go Live
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Nothing is saved until you press Save billing settings. A Live school is invoiced on the
          1st of each month for the month before, and blocked if a finalized invoice stays unpaid
          past its grace period.
        </p>
      </Modal>

      <Modal
        open={pendingCurrency !== null}
        onClose={() => {
          setPendingCurrency(null);
        }}
        title={`Issue invoices in ${pendingCurrency ?? ''}?`}
        description="Every invoice raised from now on will be in this currency. Invoices already raised keep theirs."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPendingCurrency(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pendingCurrency !== null) setInvoiceCurrency(pendingCurrency);
                setPendingCurrency(null);
              }}
            >
              Change currency
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          When the invoice currency differs from the billing currency, a USD → PKR rate is required.
        </p>
      </Modal>

      <Modal
        open={confirmAccess !== null}
        onClose={() => {
          setConfirmAccess(null);
        }}
        title={confirmAccess === 'block' ? `Block ${data.school.name}?` : `Unblock ${data.school.name}?`}
        description={
          confirmAccess === 'block'
            ? 'Everybody at the school will see a suspended notice until it is unblocked.'
            : 'Everybody at the school gets their access back immediately.'
        }
        footer={
          <>
            <Button
              variant="secondary"
              disabled={isChangingAccess}
              onClick={() => {
                setConfirmAccess(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={confirmAccess === 'block' ? 'danger' : 'primary'}
              isLoading={isChangingAccess}
              onClick={() => {
                if (confirmAccess !== null) void changeAccess(confirmAccess);
              }}
            >
              {confirmAccess === 'block' ? 'Block school' : 'Unblock school'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">The school administrator is emailed either way.</p>
      </Modal>
    </div>
  );
}
