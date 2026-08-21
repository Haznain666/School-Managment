import { Banknote, Coins, Landmark, Scale, TrendingDown, TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { LEDGER_SOURCE_LABELS } from '@/lib/accounting';
import { getAccountingOverview, listDayBook } from '@/lib/accounting-queries';
import { formatPkr } from '@/lib/money';
import { requireSchoolPermission } from '@/lib/school-guard';

import { SetUpChartButton } from '@/components/accounting/SetUpChartButton';

export const metadata: Metadata = {
  title: 'Accounting',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MONTH_LABEL = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

/** The calendar month `today` falls in, as two `YYYY-MM-DD` strings. */
function thisMonth(today = new Date()): { from: string; to: string; label: string } {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  // Day zero of the next month is the last day of this one, and it is right
  // about February in a leap year without anybody having to think about it.
  const end = new Date(Date.UTC(year, month + 1, 0));

  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    label: MONTH_LABEL.format(start),
  };
}

/**
 * The accounting overview.
 *
 * Every figure is a sum over `ledger_entries` scoped to the caller's own
 * school, and the school comes from their verified session — there is no
 * request parameter here that could widen it to another tenant.
 */
export default async function AccountingOverviewPage() {
  const { locationId, permissions } = await requireSchoolPermission('accounting.read');
  const canWrite = permissions.includes('accounting.write');

  const month = thisMonth();
  const overview = await getAccountingOverview(locationId, month);

  if (!overview.isSetUp) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Accounting"
          description="The school's ledger, its expenses and its financial statements."
        />
        <EmptyState
          icon={Scale}
          title="This school has no chart of accounts yet"
          description={
            'Nothing can be posted until it has one, so fee payments taken now are ' +
            'not reaching the books. Setting it up creates the fifteen heads a ' +
            'Pakistani school actually uses — cash, bank, fee income, salaries, ' +
            'rent, utilities and the rest — plus the expense categories that go ' +
            'with them. Rename, re-code or add to any of it afterwards.'
          }
          action={canWrite ? <SetUpChartButton /> : undefined}
          secondaryAction={
            canWrite ? undefined : (
              <p className="text-sm text-ink-muted">
                Ask somebody who can edit the accounts to set this up.
              </p>
            )
          }
        />
      </div>
    );
  }

  const recent = await listDayBook(locationId, { limit: 8 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting"
        description={`Positions as at today; income and expenses for ${month.label}.`}
        actions={
          <Link
            href="/dashboard/reports"
            className="text-sm font-medium text-brand-primary hover:underline"
          >
            Financial statements
          </Link>
        }
      />

      <StatTileGrid>
        <StatTile
          label="Cash in hand"
          value={formatPkr(overview.cashPaise / 100)}
          detail="In the office drawer"
          icon={Banknote}
        />
        <StatTile
          label="At the bank"
          value={formatPkr(overview.bankPaise / 100)}
          detail={
            overview.chequesPaise === 0
              ? 'Cleared funds'
              : `Plus ${formatPkr(overview.chequesPaise / 100)} in uncleared cheques`
          }
          icon={Landmark}
        />
        <StatTile
          label="Held at the counters"
          value={formatPkr(overview.staffHoldingPaise / 100)}
          // Not a balance the school can spend. It is what its clerks are
          // carrying and have not yet handed in, which is the number this
          // module exists to make visible.
          detail="Taken and not yet settled"
          icon={Coins}
        />
        <StatTile
          label={`Profit — ${month.label}`}
          value={formatPkr(overview.monthProfitPaise / 100)}
          detail={`${formatPkr(overview.monthIncomePaise / 100)} in, ${formatPkr(
            overview.monthExpensePaise / 100,
          )} out`}
          icon={overview.monthProfitPaise >= 0 ? TrendingUp : TrendingDown}
          deltaMeaning={overview.monthProfitPaise >= 0 ? 'good' : 'bad'}
        />
      </StatTileGrid>

      {overview.draftExpenseCount > 0 ? (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-ink">
                {overview.draftExpenseCount}{' '}
                {overview.draftExpenseCount === 1 ? 'expense is' : 'expenses are'} waiting
                to be approved
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {formatPkr(overview.draftExpensePaise / 100)} in total. Nothing has left
                the school until somebody approves them.
              </p>
            </div>
            <Link
              href="/dashboard/accounting/expenses?status=draft"
              className="text-sm font-medium text-brand-primary hover:underline"
            >
              Review them
            </Link>
          </div>
        </Card>
      ) : null}

      <Card
        header={
          <CardTitle
            title="Latest entries"
            description={`${overview.entryCount} in the books altogether.`}
            action={
              <Link
                href="/dashboard/accounting/day-book"
                className="text-sm font-medium text-brand-primary hover:underline"
              >
                Day book
              </Link>
            }
          />
        }
      >
        {recent.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing has been posted yet. The first fee payment taken after today will
            appear here.
          </p>
        ) : (
          <Table caption="The eight most recent ledger entries">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>Entry</TableHeaderCell>
                <TableHeaderCell>Raised by</TableHeaderCell>
                <TableHeaderCell align="numeric">Amount</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {recent.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.entryDate}</TableCell>
                  <TableCell>{entry.memo}</TableCell>
                  <TableCell>{LEDGER_SOURCE_LABELS[entry.source]}</TableCell>
                  <TableCell align="numeric">
                    {formatPkr(entry.totalPaise / 100)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ActionTile
          href="/dashboard/accounting/expenses"
          title="Expenses"
          description="File a bill, approve one, or see what the school has spent."
        />
        <ActionTile
          href="/dashboard/accounting/day-book"
          title="Day book"
          description="Every entry, both sides, and the reversal if there was one."
        />
        <ActionTile
          href="/dashboard/accounting/accounts"
          title="Chart of accounts"
          description="The heads this school posts to. Rename, re-code or add."
        />
        <ActionTile
          href="/dashboard/reports/balance-sheet"
          title="Balance sheet"
          description="What the school holds, owes, and is worth — on paper."
        />
      </div>
    </div>
  );
}

function ActionTile({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-card border border-line bg-surface-raised p-4 shadow-card transition hover:border-brand-primary"
    >
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>
    </Link>
  );
}
