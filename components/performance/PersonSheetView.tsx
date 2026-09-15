'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { Textarea } from '@/components/ui/Textarea';
import { formatDateOnly, formatDateTime } from '@/lib/dates';
import type { PersonSheet, SheetKpi } from '@/lib/kpi-board';
import {
  KPI_PERIOD_LABELS,
  MAX_RATING_COMMENT_LENGTH,
  formatPercent,
  monthLabel,
} from '@/lib/kpis';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import { cn } from '@/lib/utils';
import { ROLE_LABELS, type UserRole } from '@/types/school-auth';

/**
 * One person's KPIs, ratings and history — Sprint 32.
 *
 * ── Saving a rating replaces the sheet ───────────────────────────────────
 * The route answers with the whole sheet, recomputed on the server, so the
 * counting score, both overalls and the history move in the same beat as the
 * save — on a hard-loaded page, with no refresh involved (§5ca). Each row has
 * its own pending state; rating Punctuality does not grey out the rest.
 *
 * ── The counting score is labelled with who gave it ──────────────────────
 * Rule 5 makes the senior rater's score count. A coordinator who rated a
 * teacher 9 and sees 7 needs to read *Principal* beside the 7, or the screen
 * looks broken rather than senior.
 */

interface Draft {
  score: string;
  comment: string;
}

function draftsFrom(sheet: PersonSheet): Record<string, Draft> {
  const drafts: Record<string, Draft> = {};
  for (const kpi of sheet.kpis) {
    drafts[kpi.id] = {
      score: kpi.mine === null ? '' : String(kpi.mine.score),
      comment: kpi.mine?.comment ?? '',
    };
  }
  return drafts;
}

function raterLabel(role: string): string {
  return ROLE_LABELS[role as UserRole] ?? role;
}

const SCORE_OPTIONS = Array.from({ length: 10 }, (_, index) => ({
  value: String(index + 1),
  label: `${String(index + 1)} / 10`,
}));

export function PersonSheetView({
  initial,
  apiPath,
}: {
  initial: PersonSheet;
  /** `/api/school/kpis/people/<id>` or `/api/school/kpis/people/me`. */
  apiPath: string;
}) {
  const [sheet, setSheet] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => draftsFrom(initial));
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const replace = (next: PersonSheet): void => {
    setSheet(next);
    setDrafts(draftsFrom(next));
  };

  const changeMonth = async (month: string): Promise<void> => {
    setLoadingMonth(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await schoolFetch<{ sheet: PersonSheet }>(
        `${apiPath}?month=${encodeURIComponent(month)}`,
      );
      replace(payload.sheet);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'That month could not be loaded.'));
    } finally {
      setLoadingMonth(false);
    }
  };

  const save = async (kpi: SheetKpi): Promise<void> => {
    const draft = drafts[kpi.id];
    if (draft === undefined || draft.score === '') {
      setError(`Choose a score for ${kpi.name} first.`);
      return;
    }

    setSavingId(kpi.id);
    setError(null);
    setNotice(null);

    try {
      const payload = await schoolFetch<{ sheet: PersonSheet }>('/api/school/kpis/ratings', {
        method: 'POST',
        body: JSON.stringify({
          kpiId: kpi.id,
          ratedUserId: sheet.person.userId,
          month: sheet.month,
          score: Number(draft.score),
          comment: draft.comment,
        }),
      });
      replace(payload.sheet);
      setNotice(`${kpi.name}: ${draft.score}/10 saved for ${sheet.person.name}.`);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The rating could not be saved.'));
    } finally {
      setSavingId(null);
    }
  };

  const currentMonth = monthLabel(sheet.month);
  const full = sheet.visibility === 'full';

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {sheet.months.length > 0 ? (
          <Select
            label="Month"
            value={sheet.month}
            disabled={loadingMonth || savingId !== null}
            options={sheet.months.map((month) => ({ value: month.key, label: month.label }))}
            onChange={(event) => void changeMonth(event.target.value)}
            hint={sheet.year === null ? undefined : `Academic year ${sheet.year.name}`}
          />
        ) : null}
        <div className="sm:col-span-2 text-sm text-ink-muted sm:self-end sm:pb-2">
          {ROLE_LABELS[sheet.person.role]}
          {sheet.person.branchName === null ? '' : ` · ${sheet.person.branchName}`}
          {sheet.principalName === null ? '' : ` · Principal: ${sheet.principalName}`}
        </div>
      </div>

      {loadingMonth ? (
        <p role="status" className="text-sm text-ink-muted">
          Loading the month…
        </p>
      ) : null}

      {error === null ? null : (
        <p className="rounded-control border border-status-danger-line bg-status-danger-surface px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      )}
      {notice === null ? null : (
        <p
          role="status"
          className="rounded-control bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink"
        >
          {notice}
        </p>
      )}

      <StatTileGrid className={cn(loadingMonth && 'opacity-60')}>
        {full ? (
          <StatTile
            label={`Monthly overall · ${currentMonth}`}
            value={formatPercent(sheet.summary.monthly)}
            detail={`${String(sheet.summary.monthlyRated)} KPI${sheet.summary.monthlyRated === 1 ? '' : 's'} rated`}
          />
        ) : null}
        <StatTile
          label={`Yearly overall${sheet.year === null ? '' : ` · ${sheet.year.name}`}`}
          value={formatPercent(sheet.summary.yearly)}
          detail={`${String(sheet.summary.yearlyRated)} score${sheet.summary.yearlyRated === 1 ? '' : 's'} so far`}
        />
      </StatTileGrid>

      {!full ? (
        <p className="rounded-control border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          You can see this person’s yearly overall only — not their monthly KPIs or the comments
          behind them.
        </p>
      ) : (
        <>
          <Card
            className={cn(loadingMonth && 'opacity-60')}
            header={
              <CardTitle
                title="KPIs"
                description={
                  sheet.canRate
                    ? `Rate each out of 10 for ${currentMonth}. Annual KPIs are rated once for the year. Changing a rating keeps the earlier one in the history.`
                    : sheet.isSelf
                      ? 'Your KPIs and the score that counts for each.'
                      : (sheet.refusal ?? 'You can read these ratings but not enter them.')
                }
              />
            }
          >
            {sheet.kpis.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No KPIs have been defined for {ROLE_LABELS[sheet.person.role]} yet.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {sheet.kpis.map((kpi) => {
                  const draft = drafts[kpi.id] ?? { score: '', comment: '' };
                  const saving = savingId === kpi.id;
                  return (
                    <li key={kpi.id} className="grid gap-4 py-4 lg:grid-cols-[1fr_1fr]">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-ink">{kpi.name}</p>
                          <Badge variant={kpi.period === 'monthly' ? 'info' : 'neutral'}>
                            {kpi.period === 'monthly' ? currentMonth : KPI_PERIOD_LABELS.annual}
                          </Badge>
                        </div>
                        {kpi.description === null ? null : (
                          <p className="mt-1 text-sm text-ink-muted">{kpi.description}</p>
                        )}
                        <p className="mt-2 text-sm text-ink">
                          {kpi.counting === null ? (
                            <span className="text-ink-muted">Not rated yet.</span>
                          ) : (
                            <>
                              <span className="font-semibold tabular-nums">
                                {kpi.counting.score}/10
                              </span>{' '}
                              <span className="text-ink-muted">
                                counts — {kpi.counting.raterName} ({raterLabel(kpi.counting.raterRole)})
                              </span>
                            </>
                          )}
                        </p>
                        {kpi.counting?.comment == null ? null : (
                          <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">
                            “{kpi.counting.comment}”
                          </p>
                        )}
                      </div>

                      {sheet.canRate ? (
                        <div className="space-y-3">
                          <Select
                            label={`Your rating for ${kpi.name}`}
                            value={draft.score}
                            placeholder="Choose a score"
                            disabled={saving}
                            options={SCORE_OPTIONS}
                            onChange={(event) =>
                              setDrafts({
                                ...drafts,
                                [kpi.id]: { ...draft, score: event.target.value },
                              })
                            }
                          />
                          <Textarea
                            label="Comment"
                            rows={2}
                            value={draft.comment}
                            disabled={saving}
                            maxLength={MAX_RATING_COMMENT_LENGTH}
                            onChange={(event) =>
                              setDrafts({
                                ...drafts,
                                [kpi.id]: { ...draft, comment: event.target.value },
                              })
                            }
                          />
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              isLoading={saving}
                              disabled={savingId !== null && !saving}
                              onClick={() => void save(kpi)}
                            >
                              {kpi.mine === null ? 'Save rating' : 'Change rating'}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card header={<CardTitle title="History" description="Every rating entered this academic year, newest first. Changed and outranked ratings are kept and marked." />}>
            <Table caption="Rating history">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Entered</TableHeaderCell>
                  <TableHeaderCell>KPI</TableHeaderCell>
                  <TableHeaderCell>Period</TableHeaderCell>
                  <TableHeaderCell align="numeric">Score</TableHeaderCell>
                  <TableHeaderCell>By</TableHeaderCell>
                  <TableHeaderCell>Comment</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sheet.history.length === 0 ? (
                  <TableEmptyRow colSpan={6}>Nothing rated this academic year yet.</TableEmptyRow>
                ) : (
                  sheet.history.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
                      <TableCell>{entry.kpiName}</TableCell>
                      <TableCell>{entry.month === null ? 'Year' : monthLabel(entry.month)}</TableCell>
                      <TableCell align="numeric">
                        {entry.score}/10{' '}
                        {entry.counts ? <Badge variant="success">Counts</Badge> : null}
                      </TableCell>
                      <TableCell>
                        {entry.raterName}
                        <span className="block text-xs text-ink-muted">{raterLabel(entry.raterRole)}</span>
                      </TableCell>
                      <TableCell>
                        <span className="whitespace-pre-line text-sm">{entry.comment ?? '—'}</span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          {sheet.profile === null ? null : <ProfilePanel sheet={sheet} />}
        </>
      )}
    </div>
  );
}

/**
 * Rule 8's view of a supervised teacher: everything except salary. The server
 * built this from an allow-list; the panel only lays out what arrived.
 */
function ProfilePanel({ sheet }: { sheet: PersonSheet }) {
  const profile = sheet.profile;
  if (profile === null) return null;

  const facts: Array<[string, string | null]> = [
    ['Designation', profile.designation],
    ['Department', profile.department],
    ['Joined', profile.joinedOn === null ? null : formatDateOnly(profile.joinedOn)],
    ['Qualification', profile.qualification],
    ['Email', profile.email],
    ['Phone', profile.phone],
  ];

  return (
    <Card header={<CardTitle title={`About ${sheet.person.name}`} description="Their classes, register, leave and lesson plans. Salary is not shown here." />}>
      <div className="grid gap-6 lg:grid-cols-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-ink">{value ?? '—'}</dd>
            </div>
          ))}
        </dl>

        <div>
          <p className="mb-2 text-sm font-medium text-ink">Register · {monthLabel(sheet.month)}</p>
          {profile.attendance.length === 0 ? (
            <p className="text-sm text-ink-muted">No register entries this month.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {profile.attendance.map((row) => (
                <li key={row.status}>
                  <Badge variant={row.status === 'present' ? 'success' : row.status === 'absent' ? 'danger' : 'neutral'}>
                    {row.status.replace('_', ' ')}: {row.days}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-ink">Timetable</p>
          {profile.classes.length === 0 ? (
            <p className="text-sm text-ink-muted">No timetabled periods.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {profile.classes.map((row) => (
                <li key={`${row.label}-${row.subject}`} className="flex justify-between gap-4">
                  <span className="text-ink">
                    {row.label} · {row.subject}
                  </span>
                  <span className="tabular-nums text-ink-muted">
                    {row.periods} period{row.periods === 1 ? '' : 's'} a week
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-ink">Leave</p>
            {profile.leave.length === 0 ? (
              <p className="text-sm text-ink-muted">No leave requests.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {profile.leave.map((row) => (
                  <li key={`${row.from}-${row.type}`} className="flex justify-between gap-4">
                    <span className="text-ink">
                      {row.type}: {formatDateOnly(row.from)} – {formatDateOnly(row.to)}
                    </span>
                    <span className="capitalize text-ink-muted">{row.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-ink">Lesson plans</p>
            {profile.lessonPlans.length === 0 ? (
              <p className="text-sm text-ink-muted">No lesson plans filed.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {profile.lessonPlans.map((row) => (
                  <li key={`${row.weekStarting}-${row.title}`} className="flex justify-between gap-4">
                    <span className="text-ink">
                      {formatDateOnly(row.weekStarting)} · {row.title}
                    </span>
                    <span className="capitalize text-ink-muted">{row.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
