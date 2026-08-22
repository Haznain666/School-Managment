import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { NextResponse } from 'next/server';

/**
 * GET /api/internal/build — which build is actually running.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * The deploy workflow needs to answer one question: *is the artifact I just
 * uploaded the one now serving requests?* It used to answer it by reading the
 * build id out of `/super-admin/login`, which was wrong in a way that made the
 * check worse than useless — that page is prerendered and the CDN holds it with
 * `s-maxage=31536000`. Measured on 2026-08-21 it was **30.4 hours stale**, and
 * no request header would bust it. The check was comparing two cache entries
 * and reporting them as a live deploy.
 *
 * A route handler cannot be prerendered and is served `no-store`, so this
 * answers from the running process every time.
 *
 * ── Why the value comes from a file and not an env var ───────────────────
 * `.next/BUILD_ID` is written by `next build` and shipped inside the standalone
 * output, so it is the identity of *this artifact* — not of whatever the panel's
 * environment happens to say. An env var could be edited after the fact; this
 * cannot be wrong without the build itself being wrong.
 *
 * ── Why it needs no diagnostics secret ───────────────────────────────────
 * Unlike its siblings in this directory, it discloses nothing. The build id is
 * already embedded in the HTML of every prerendered page this app serves — it
 * is the string the old check was reading *from public HTML*. Gating it would
 * mean a second secret on the deploy workflow to read a value anyone can
 * already curl off the homepage.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * When this process started, fixed at module load.
 *
 * The build id says *what* is running; this says whether it has been restarted.
 * A deploy that uploads an identical artifact produces the same build id, and
 * then this is the only thing that moves.
 */
const START_TIME = new Date().toISOString();

export async function GET(): Promise<NextResponse> {
  let buildId = 'unknown';

  try {
    // `process.cwd()` is the standalone root on the host, and the repo root in
    // development. `.next/BUILD_ID` is in the same place relative to both.
    buildId = (await readFile(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8')).trim();
  } catch {
    // Deliberately not an error. A missing BUILD_ID means an unusual layout,
    // not a broken deployment, and the caller distinguishes "unknown" from a
    // real id perfectly well.
  }

  return NextResponse.json(
    { buildId, startedAt: START_TIME },
    {
      status: 200,
      // Belt and braces. `force-dynamic` already prevents prerendering, but this
      // route exists precisely because something upstream cached a page it
      // should not have, and a stale answer here would hide the next such bug.
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
    },
  );
}
