/**
 * Next.js calls `register()` once per server process, before it serves
 * anything. It is the only place this application can start background work.
 *
 * ── What runs here, and what must not ────────────────────────────────────
 * The email outbox drainer, and since Sprint 11 the announcement scheduler.
 * Anything started here runs forever in a process that also serves every
 * request, so the bar is high: it must be idempotent, it must not hold the
 * process open, and it must never throw into the runtime. Both of these meet
 * it, and both are here for the same reason — Hostinger's shared plan has no
 * cron this application can rely on.
 *
 * ── Why the guard is written exactly this way ────────────────────────────
 * `middleware.ts` exists, so Next compiles this file for the Edge runtime as
 * well — and `lib/email-outbox.ts` pulls in postgres-js and nodemailer, which
 * need TCP sockets, `fs` and `crypto`. The Edge build cannot resolve any of
 * them and fails outright; this is not theoretical, it is what the first build
 * of this sprint did.
 *
 * The dynamic import must sit inside a **positive** `=== 'nodejs'` block. Next
 * substitutes `process.env.NEXT_RUNTIME` with a literal at build time, so in
 * the Edge compilation the condition becomes `if (false)` and webpack skips
 * parsing the body — the dependency is never recorded. An early
 * `if (… !== 'nodejs') return;` reads identically to a human and does not work:
 * the parser still walks the code after it and records the import.
 */
import { describeSmtpCredentials } from './lib/smtp-credentials';
import { describeHashShape, readConfiguredHash } from './lib/super-admin-hash-shape';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    checkSuperAdminHash();
    checkSmtpCredentials();

    const { startOutboxDrainer } = await import('./lib/email-outbox');
    startOutboxDrainer();

    // Same positive `=== 'nodejs'` block, for the same reason: the import must
    // not be recorded in the Edge compilation. See the docblock above.
    const { startAnnouncementScheduler } = await import('./lib/announcement-scheduler');
    startAnnouncementScheduler();
  }
}

/**
 * Says at boot whether the Super Admin hash survived the trip into this
 * process.
 *
 * ── Why at boot, and not left to the login route ─────────────────────────
 * A damaged hash does not throw — `compare()` in bcryptjs returns false for
 * anything that is not 60 characters — so it presents as "wrong password"
 * forever, with nothing in the log. On 2026-08-11 that cost three sessions on
 * a deployment that was correct in every other respect. The information that
 * ends it is available here, before anyone attempts a sign-in, for the price
 * of one string inspection per process start.
 *
 * Never throws and never blocks startup: a malformed hash breaks Super Admin
 * sign-in, not the school portals, and taking the platform down over it would
 * be the wrong trade.
 */
function checkSuperAdminHash(): void {
  // Whichever variable the login route would use, so a green boot cannot mean
  // something different from a working sign-in.
  const shape = describeHashShape(
    readConfiguredHash(
      process.env.SUPER_ADMIN_PASSWORD_HASH,
      process.env.SUPER_ADMIN_PASSWORD_HASH_B64,
    ),
  );
  if (shape.ok) return;

  // Deliberately loud, and deliberately without the hash itself — it is
  // offline-crackable and belongs in a log no more than the password does.
  console.error(`[super-admin] ${shape.message}`);
}

/**
 * Says at boot whether the SMTP password survived the trip into this process.
 *
 * ── Why this is worth a line in every log ────────────────────────────────
 * The failure it catches presents as `535 5.7.8 authentication failed` inside a
 * queue drain — thirty seconds after the operator pressed "Invite", in a log
 * they were not watching, with a message that reads identically whether the
 * password is wrong, truncated at a `#`, or wrapped in quotes a panel stored
 * literally. Production spent from 2026-08-13 in that state while the same
 * credentials worked locally, and three sessions concluded from it that the
 * mailbox password was wrong. It never was; see `lib/smtp-credentials.ts`.
 *
 * One string inspection per process start turns that into a sentence that names
 * the actual cause, before a single message is queued.
 *
 * Never throws and never blocks startup: unsendable mail is a degraded
 * platform, not a stopped one, and the school portals do not depend on it.
 */
function checkSmtpCredentials(): void {
  // Only when SMTP is meant to be configured at all. A deployment that has
  // deliberately left it blank is a supported state and must not be nagged.
  if ((process.env.SMTP_HOST ?? '').trim() === '') return;

  const shape = describeSmtpCredentials(
    process.env.SMTP_USER,
    process.env.SMTP_PASS,
    process.env.SMTP_PASS_B64,
  );

  // Without the password itself, which belongs in a log no more than the
  // Super Admin hash does.
  if (shape.ok) console.info(`[smtp] ${shape.message}`);
  else console.error(`[smtp] ${shape.message}`);
}
