import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { redirect } from 'next/navigation';

import { SuspendedSignOut } from '@/app/(public)/suspended/SuspendedSignOut';
import { Card } from '@/components/ui/Card';
import { paletteToCSSVars } from '@/lib/branding';
import { formatMoneyMinor } from '@/lib/money';
import { getSuspendedView } from '@/lib/platform-billing-queries';
import { readSchoolSession } from '@/lib/school-auth';
import { getCurrentSchoolBranding, getSchoolHeaders } from '@/lib/school-tenant';
import { ROLE_HOME_ROUTES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Account suspended',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * `/suspended` — where everybody at a blocked school lands. Sprint 35, §6.
 *
 * The guards send every portal request here while `schools.access_blocked_at`
 * is set (`lib/school-guard.ts`), and every `/api/school/**` route refuses with
 * `school_suspended` (`lib/api-auth.ts`). This page is the one screen that
 * still answers, and it answers two audiences differently:
 *
 *   · **the school administrator** sees what is owed — every finalized invoice
 *     with a balance, the amount due, the due date — and the platform's bank
 *     accounts, and can download each invoice as the same PDF the platform
 *     emailed. They are the person who can end the suspension, so they are the
 *     one person shown how.
 *   · **everybody else** — staff, students, parents — sees one sentence and a
 *     sign-out button. The school's finances are not theirs to read.
 *
 * Nothing on it states how much must be paid to reopen (E6). "Amount due" is
 * the balance; the rule that decides the block stays on the server.
 *
 * Not blocked, or not signed in: sent where they belong, so a stale tab left on
 * this page does not keep telling somebody their school is closed.
 */
export default async function SuspendedPage() {
  const { locationId, slug } = await getSchoolHeaders();
  if (locationId === null || locationId === '') redirect('/school-not-found');

  const claims = await readSchoolSession();
  if (claims === null || claims.locationId !== locationId) {
    redirect(slug === null || slug === '' ? '/login' : `/login?school=${encodeURIComponent(slug)}`);
  }

  if (!claims.accessBlocked) redirect(ROLE_HOME_ROUTES[claims.role]);

  const school = await getCurrentSchoolBranding();
  const brandStyle = paletteToCSSVars(school?.palette ?? null) as unknown as CSSProperties;
  const isAdmin = claims.role === 'school_admin';
  const view = isAdmin ? await getSuspendedView(locationId) : null;

  return (
    <main
      style={brandStyle}
      className="flex min-h-screen items-start justify-center bg-surface-sunken px-4 py-12 sm:items-center"
    >
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-ink">{school?.name ?? 'Your school'}</h1>
          <p className="mt-3 text-base text-ink">
            This school&apos;s account is currently suspended. Please contact the school
            administration.
          </p>
        </div>

        {view !== null ? (
          <>
            <Card>
              <div className="space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-ink">What is owed</h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    Access returns for everybody at the school once payment is received.
                    Quote the invoice number as the payment reference.
                  </p>
                </div>

                {view.invoices.length === 0 ? (
                  <p className="text-sm text-ink-muted">
                    There is no unpaid invoice on file. Contact SchoolHub to restore access.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {view.invoices.map((invoice) => (
                      <li
                        key={invoice.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3"
                      >
                        <div>
                          <p className="font-mono text-sm font-medium text-ink">
                            {invoice.invoiceNumber}
                          </p>
                          <p className="text-sm text-ink-muted">
                            {invoice.periodLabel} · due {invoice.dueDate}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                            {formatMoneyMinor(invoice.amountDueMinor, invoice.currency)}
                          </span>
                          <a
                            href={`/api/school/billing/invoices/${invoice.id}/pdf`}
                            className="rounded-control border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-hover"
                          >
                            Download PDF
                          </a>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            <Card>
              <div className="space-y-3">
                <h2 className="text-base font-semibold text-ink">Pay by bank transfer</h2>
                {view.bankAccounts.length === 0 ? (
                  <p className="text-sm text-ink-muted">Contact SchoolHub for payment details.</p>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {view.bankAccounts.map((account) => (
                      <div key={account.id} className="rounded-card border border-line p-4 text-sm">
                        <p className="font-semibold text-ink">{account.bankName}</p>
                        <p className="mt-1 text-ink-muted">{account.accountTitle}</p>
                        <p className="mt-2 text-ink">
                          Account <span className="font-mono">{account.accountNumber}</span>
                        </p>
                        <p className="text-ink">
                          IBAN <span className="font-mono">{account.iban}</span>
                        </p>
                        {account.branchName !== null || account.city !== null ? (
                          <p className="mt-1 text-ink-muted">
                            {[account.branchName, account.branchCode, account.city]
                              .filter((part) => part !== null && part !== '')
                              .join(' · ')}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </>
        ) : null}

        <div className="flex justify-center">
          <SuspendedSignOut schoolSlug={slug} />
        </div>
      </div>
    </main>
  );
}
