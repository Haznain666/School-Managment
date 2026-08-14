/**
 * Executes every dashboard aggregate against the real database.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * The dashboard queries carry hand-written SQL fragments — `filter (where …)`,
 * `case when … end`, `to_char`, `::date - 30`. TypeScript checks none of that;
 * a typo inside a `sql` template compiles perfectly and fails at the first
 * request, which on these screens means the dashboard a head teacher opens.
 * Nothing else in this repo would have caught it before a browser did, and the
 * portals cannot be signed into from a development machine (STATE.md §5d).
 *
 * So each query is run once. It is passed a location id that matches no school,
 * which is the point: every aggregate returns empty or zero, no real school's
 * data is read, and the SQL still has to parse, resolve every column and
 * execute. Syntax and schema errors surface; nothing else is touched.
 *
 *     npm run check-dashboard
 *
 * Reads `DATABASE_URL` from the main checkout's `.env.local`, because the
 * worktree has no env of its own.
 */

import { readFileSync } from 'node:fs';

import {
  getAdmissionsFunnel,
  getAgingBuckets,
  getAttendanceByClass,
  getAttendanceTrend,
  getClassStrength,
  getCollectionTrend,
  getFeeStatusSplit,
  getTodaySnapshot,
} from '../lib/dashboard-queries';

/** A syntactically valid id that belongs to no tenant. */
const NOBODY = '00000000-0000-0000-0000-000000000000';

function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL !== undefined) return;

  for (const candidate of [
    'D:/School-Management-System/.env.local',
    '../../../.env.local',
    '.env.local',
  ]) {
    try {
      const text = readFileSync(candidate, 'utf8');
      const match = /^DATABASE_URL=(.*)$/m.exec(text);
      if (match?.[1] !== undefined) {
        process.env.DATABASE_URL = match[1].trim().replace(/^['"]|['"]$/g, '');
        console.log(`  using DATABASE_URL from ${candidate}`);
        return;
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('DATABASE_URL not found — set it, or run from a checkout with .env.local');
}

const CHECKS: Array<[string, () => Promise<unknown>]> = [
  ['getCollectionTrend', () => getCollectionTrend(NOBODY)],
  ['getFeeStatusSplit', () => getFeeStatusSplit(NOBODY)],
  ['getAgingBuckets', () => getAgingBuckets(NOBODY)],
  ['getAttendanceTrend', () => getAttendanceTrend(NOBODY)],
  ['getAttendanceByClass', () => getAttendanceByClass(NOBODY)],
  ['getClassStrength', () => getClassStrength(NOBODY)],
  ['getAdmissionsFunnel', () => getAdmissionsFunnel(NOBODY)],
  ['getTodaySnapshot', () => getTodaySnapshot(NOBODY)],
];

async function main(): Promise<void> {
  loadDatabaseUrl();

  let failed = 0;

  for (const [name, run] of CHECKS) {
    try {
      const started = Date.now();
      const result = await run();
      const shape = Array.isArray(result)
        ? `${result.length} row(s)`
        : result === null
          ? 'null'
          : typeof result === 'object'
            ? Object.keys(result as object).join(', ')
            : String(result);
      console.log(`  ok   ${name.padEnd(22)} ${String(Date.now() - started).padStart(5)}ms  ${shape}`);
    } catch (caught) {
      failed += 1;
      console.log(`  FAIL ${name}`);
      console.log(`       ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  console.log(
    failed === 0
      ? `\nPASS — ${CHECKS.length} aggregates executed against the real schema.`
      : `\nFAIL — ${failed} of ${CHECKS.length} could not execute.`,
  );

  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
