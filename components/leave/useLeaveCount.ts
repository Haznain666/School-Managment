'use client';

import { useEffect, useRef, useState } from 'react';

import { calendarSpan, dayLabel } from '@/lib/leave-quota';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * "Days used", counted by the server as the dates change. Sprint 33b, QA
 * round 1 (F5).
 *
 * Both leave forms — self-service and HR filing on somebody's behalf — call
 * `GET /api/school/leave/count`, which counts with `countLeaveFor`: the same
 * function the POST stores with. The person's own staff calendar and their
 * campus's holiday rule live on the server, so a count made here would say
 * five where the write stores four, and a form that promises one number and
 * saves another is the A6 complaint all over again.
 *
 * ── A stale answer is dropped, not shown ─────────────────────────────────
 * Changing the end date twice quickly fires two requests, and the slower one
 * can land last. Each response is checked against the request that is current
 * when it arrives; an older one is discarded.
 */

export interface LeaveCountResult {
  days: number;
  holidayDays: number;
  skipped: boolean;
  holidayProblem: string | null;
  spanProblem: string | null;
}

export interface LeaveCountState {
  /** True while a count for the current dates is in flight. */
  pending: boolean;
  result: LeaveCountResult | null;
  error: string | null;
}

export function useLeaveCount(
  startDate: string,
  endDate: string,
  staffId: string | null = null,
): LeaveCountState {
  const [state, setState] = useState<LeaveCountState>({
    pending: false,
    result: null,
    error: null,
  });
  const latest = useRef(0);

  useEffect(() => {
    const request = latest.current + 1;
    latest.current = request;

    if (calendarSpan(startDate, endDate) === 0) {
      setState({ pending: false, result: null, error: null });
      return;
    }

    setState((held) => ({ ...held, pending: true, error: null }));

    const query = new URLSearchParams({ startDate, endDate });
    if (staffId !== null && staffId !== '') query.set('staffId', staffId);

    schoolFetch<LeaveCountResult>(`/api/school/leave/count?${query.toString()}`)
      .then((result) => {
        if (latest.current !== request) return;
        setState({ pending: false, result, error: null });
      })
      .catch((caught: unknown) => {
        if (latest.current !== request) return;
        setState({
          pending: false,
          result: null,
          error: schoolErrorMessage(caught, 'Could not count those dates.'),
        });
      });
  }, [startDate, endDate, staffId]);

  return state;
}

/** The sentence under "Days used": what was counted, and what was not. */
export function countHint(state: LeaveCountState, startDate: string, endDate: string): string {
  if (calendarSpan(startDate, endDate) === 0) return 'Fills in from the dates. Half days allowed.';
  if (state.pending) return 'Counting…';
  if (state.error !== null) return state.error;
  const result = state.result;
  if (result === null) return 'Fills in from the dates. Half days allowed.';

  const holidays =
    result.holidayDays === 0
      ? ''
      : result.skipped
        ? ` — ${dayLabel(result.holidayDays)} the school is closed ${result.holidayDays === 1 ? 'is' : 'are'} not counted`
        : `, including ${dayLabel(result.holidayDays)} the school is closed`;

  return `Counted: ${dayLabel(result.days)}${holidays}. Change it for a half day.`;
}
