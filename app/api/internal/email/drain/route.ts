import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { safeEqual } from '@/lib/crypto';
import { drainOutbox } from '@/lib/email-outbox';
import { serverEnv } from '@/lib/env';

/**
 * POST /api/internal/email/drain — send whatever is due in `email_outbox`.
 *
 * ── Why this exists when the process already drains itself ───────────────
 * `instrumentation.ts` starts an interval, and on Hostinger's single
 * long-lived Node process that is genuinely sufficient today. This route is the
 * escape hatch for the day it is not: a host cron, an uptime pinger or a second
 * machine can drive exactly the same function without any of the queue changing
 * shape. `FOR UPDATE SKIP LOCKED` is what makes running both at once safe.
 *
 * ── Why a shared secret and not the super-admin session ──────────────────
 * The caller is a cron, not a person. Requiring an operator session would mean
 * this could only be driven by hand, which is the opposite of the point.
 * `EMAIL_DRAIN_SECRET` is compared in constant time and, when it is unset, the
 * route refuses everything rather than falling open — an unauthenticated
 * endpoint that makes the server send mail is exactly the shape of thing that
 * gets a mail domain blacklisted.
 *
 * The secret goes in a header, never a query string, so it does not end up in
 * access logs or a referrer.
 *
 * ── Why it is not `/api/super-admin/...` ─────────────────────────────────
 * `middleware.ts` and the super-admin guard apply their own rules to that
 * prefix. This is machine-to-machine plumbing that belongs to no tenant and no
 * operator, so it gets its own `internal` namespace, which is also a legible
 * warning to anyone adding routes near it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SECRET_HEADER = 'x-drain-secret';

/** Bounded so one call cannot occupy the process for an hour. */
const MAX_BATCH = 50;

export async function POST(request: NextRequest) {
  try {
    // Trimmed for the same reason as the Super Admin diagnostics route: HTTP
    // strips whitespace from header values, so a panel entry with a stray
    // space could never be matched and this endpoint would silently stop
    // draining the outbox.
    const expected = serverEnv('EMAIL_DRAIN_SECRET', '').trim();

    if (expected === '') {
      return apiFailure(
        'not_configured',
        'EMAIL_DRAIN_SECRET is not set, so this endpoint is disabled.',
        503,
      );
    }

    const presented = request.headers.get(SECRET_HEADER) ?? '';

    if (!safeEqual(presented, expected)) {
      // Deliberately the same answer as a missing header: there is nothing to
      // learn here about whether a guess was close.
      return apiFailure('unauthorized', 'Not authorised.', 401);
    }

    const requested = Number.parseInt(
      new URL(request.url).searchParams.get('limit') ?? '',
      10,
    );
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), MAX_BATCH)
      : 20;

    const result = await drainOutbox(limit);

    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
