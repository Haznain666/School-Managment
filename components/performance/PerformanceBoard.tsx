'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import type { Board } from '@/lib/kpi-board';
import { formatPercent } from '@/lib/kpis';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import { cn } from '@/lib/utils';
import { ROLE_LABELS } from '@/types/school-auth';

/**
 * The Staff performance board — Sprint 32.
 *
 * ── The month is fetched, never refreshed ────────────────────────────────
 * Changing month asks `/api/school/kpis/performance`, which calls the same
 * `buildBoard` the page rendered with, and replaces the rows. While it is on
 * its way the table dims and says so. There is no `router.refresh()` here:
 * on a hard-loaded page it does nothing (§5ca), and this is a page people
 * reach from a bookmark.
 *
 * ── Finance sees one column ──────────────────────────────────────────────
 * A caller holding `kpis.overall` alone gets rows with no monthly figure in
 * them at all — the server leaves it out — and the monthly column is not drawn.
 */

function average(values: Array<number | null>): number | null {
  const real = values.filter((value): value is number => value !== null);
  if (real.length === 0) return null;
  return Math.round((real.reduce((sum, value) => sum + value, 0) / real.length) * 10) / 10;
}

export function PerformanceBoard({ initial }: { initial: Board }) {
  const [board, setBoard] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState('');

  const changeMonth = async (month: string): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const payload = await schoolFetch<{ board: Board }>(
        `/api/school/kpis/performance?month=${encodeURIComponent(month)}`,
      );
      setBoard(payload.board);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'That month could not be loaded.'));
    } finally {
      setPending(false);
    }
  };

  const roles = useMemo(
    () => [...new Set(board.rows.map((row) => row.role))].sort(),
    [board.rows],
  );
  const rows = role === '' ? board.rows : board.rows.filter((row) => row.role === role);
  const showPrincipal = rows.some((row) => row.principalName !== null);
  const monthLabel = board.months.find((month) => month.key === board.month)?.label ?? board.month;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {board.months.length > 0 ? (
          <Select
            label="Month"
            value={board.month}
            disabled={pending}
            options={board.months.map((month) => ({ value: month.key, label: month.label }))}
            onChange={(event) => void changeMonth(event.target.value)}
            hint={board.year === null ? undefined : `Academic year ${board.year.name}`}
          />
        ) : null}
        <Select
          label="Role"
          value={role}
          options={[
            { value: '', label: 'Every role' },
            ...roles.map((value) => ({ value, label: ROLE_LABELS[value] })),
          ]}
          onChange={(event) => setRole(event.target.value)}
        />
      </div>

      {board.year === null ? (
        <p className="rounded-control border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          No academic year covers this month, so there is nothing to score against. Add one under
          Admissions → Academic Years.
        </p>
      ) : null}

      {error === null ? null : (
        <p className="rounded-control border border-status-danger-line bg-status-danger-surface px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      )}

      <StatTileGrid>
        <StatTile label="Staff in view" value={rows.length.toLocaleString()} />
        {board.overallOnly ? null : (
          <StatTile
            label={`Rated in ${monthLabel}`}
            value={rows.filter((row) => row.monthlyRated > 0).length.toLocaleString()}
            detail={`of ${rows.length.toLocaleString()}`}
          />
        )}
        {board.overallOnly ? null : (
          <StatTile
            label="Average monthly overall"
            value={formatPercent(average(rows.map((row) => row.monthly)))}
            detail={monthLabel}
          />
        )}
        <StatTile
          label="Average yearly overall"
          value={formatPercent(average(rows.map((row) => row.yearly)))}
          detail={board.year?.name ?? undefined}
        />
      </StatTileGrid>

      {rows.length === 0 ? (
        <EmptyState
          title="Nobody to show yet"
          description="Staff appear here once they are in your reach. A principal sees the teachers who fall under them; a coordinator sees the teachers assigned to them."
        />
      ) : (
        <Card className={cn('p-0 transition-opacity', pending && 'opacity-60')} aria-busy={pending}>
          {pending ? (
            <p className="px-4 pt-3 text-sm text-ink-muted" role="status">
              Loading {board.months.length > 0 ? 'the month' : 'scores'}…
            </p>
          ) : null}
          <Table caption="Staff performance">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Campus</TableHeaderCell>
                {showPrincipal ? <TableHeaderCell>Principal</TableHeaderCell> : null}
                {board.overallOnly ? null : (
                  <TableHeaderCell align="numeric">{monthLabel}</TableHeaderCell>
                )}
                <TableHeaderCell align="numeric">Yearly overall</TableHeaderCell>
                {board.overallOnly ? null : <TableHeaderCell align="numeric">KPIs</TableHeaderCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.userId}>
                  <TableCell>
                    {row.visibility === 'full' ? (
                      <Link
                        href={`/dashboard/performance/staff/${row.userId}`}
                        className="font-medium text-brand-primary hover:underline"
                      >
                        {row.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">{row.name}</span>
                    )}
                    {row.canRate ? (
                      <Badge variant="brand" className="ml-2">
                        You rate
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{ROLE_LABELS[row.role]}</TableCell>
                  <TableCell>{row.branchName ?? 'Every campus'}</TableCell>
                  {showPrincipal ? <TableCell>{row.principalName ?? '—'}</TableCell> : null}
                  {board.overallOnly ? null : (
                    <TableCell align="numeric">
                      {row.visibility === 'full' ? formatPercent(row.monthly) : '—'}
                    </TableCell>
                  )}
                  <TableCell align="numeric">{formatPercent(row.yearly)}</TableCell>
                  {board.overallOnly ? null : (
                    <TableCell align="numeric">{row.kpiCount.toLocaleString()}</TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
