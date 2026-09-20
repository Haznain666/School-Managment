/**
 * Next.js calls `register()` once per server process, before it serves
 * anything. It is the only place this application can start background work.
 *
 * ── What runs here, and what must not ────────────────────────────────────
 * The email outbox drainer, the announcement scheduler (Sprint 11), the monthly
 * voucher auto-send (Sprint 18), the sibling-discount sweep (Sprint 20), the
 * chat digest (Sprint 24), and — Sprint 27 — the monthly voucher *generation*
 * and the holiday notice.
 * Anything started here runs forever in a process that also serves every
 * request, so the bar is high: it must be idempotent, it must not hold the
 * process open, and it must never throw into the runtime. All of these meet
 * it, and all are here for the same reason — Hostinger's shared plan has no
 * cron this application can rely on.
 *
 * Since Sprint 35 none of them owns a timer. Each *registers* itself with
 * `lib/scheduler.ts`, which keeps one timer per process and runs the
 * registrations only in the process holding a claimed lease — so the seven
 * processes Hostinger runs do the looking once rather than seven times. The
 * idempotence bar above is unchanged and still load-bearing: the lease is a
 * second guard, not a replacement for each sweep's own claim.
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

    /*
     * Sprint 35 — every sweep below is *registered*, and `startScheduler()`
     * below starts the one timer that runs them. Nothing here starts a timer
     * of its own any more.
     *
     * ── Why ──────────────────────────────────────────────────────────────
     * This function runs once per server process and Hostinger runs seven.
     * Each sweep used to keep a `setInterval`, so seven processes woke every
     * 30-60 seconds and asked the same questions. Measured from
     * `pg_stat_statements` on 2026-09-20, over 47.8 days: 367,329 outbox
     * reclaims returning no rows at all, 177,191 late-fee sweeps likewise, and
     * 141,437 announcement sweeps that between them found two announcements.
     *
     * The work itself was never duplicated — every unit of it is claimed with
     * a conditional `UPDATE ... RETURNING`, per CLAUDE.md. The *looking* was,
     * and with `idle_timeout: 20` in `lib/postgres.ts` every one of those ticks
     * opened a fresh connection whose type bootstrap cost 446 catalogue rows.
     * That one query was 98.6% of everything the database returned.
     *
     * `lib/scheduler.ts` holds a claimed lease, so one process looks. The
     * per-item claims stay exactly where they were: a lease can expire while
     * its holder is mid-send, and two leaders for a few seconds must not be
     * able to produce a double send.
     *
     * Same positive `=== 'nodejs'` block as before, for the same reason: these
     * imports must not be recorded in the Edge compilation. See the docblock
     * at the top of this file.
     */
    const { registerOutboxSweeps } = await import('./lib/email-outbox');
    registerOutboxSweeps();

    const { registerAnnouncementSweep } = await import('./lib/announcement-scheduler');
    registerAnnouncementSweep();

    // Sprint 18. The monthly voucher email, off at every school until one
    // turns it on.
    const { registerVoucherAutoSendSweep } = await import('./lib/voucher-auto-send');
    registerVoucherAutoSendSweep();

    // Sprint 27. The other half of the same idea and the sharper one: this
    // raises **next month's** vouchers rather than emailing this month's, so a
    // duplicate is a document in a register and not a repeated email.
    const { registerVoucherAutoGenerateSweep } = await import('./lib/voucher-auto-generate');
    registerVoucherAutoGenerateSweep();

    // Sprint 20, item 9b. The backstop that closes a sibling discount once a
    // family is down to one child here — the two synchronous hooks do the work
    // when somebody is watching, and this catches the paths nobody thought of.
    const { registerSiblingDiscountSweep } = await import('./lib/sibling-discounts');
    registerSiblingDiscountSweep();

    // Sprint 24. The unread-chat digest, the signal prune and the grant expiry.
    // `ROADMAP.md` is explicit that chat must not ship without something that
    // reaches a parent who has not opened the portal.
    const { registerChatDigestSweep } = await import('./lib/chat-digest');
    registerChatDigestSweep();

    // Sprint 27. The day-before holiday notice. Claimed with an
    // `INSERT ... ON CONFLICT DO NOTHING RETURNING` rather than a conditional
    // UPDATE — the same rule in the shape a first-time event takes.
    const { registerHolidayNoticeSweep } = await import('./lib/holiday-notifier');
    registerHolidayNoticeSweep();

    // Sprint 33b. Probation ends on a date and nothing else in the product
    // looks at that date, so without this a person stays on probation until
    // somebody happens to open their record. Each person is claimed with a
    // conditional UPDATE on `probation_notified_at`, and the claim is handed
    // back on a throw, because a claim kept after a failure is a reminder the
    // school believes it received.
    const { registerProbationSweep } = await import('./lib/probation-notifier');
    registerProbationSweep();

    // Last, and only once everything above is registered: `startScheduler()`
    // logs the list it is about to run, and a sweep registered after it would
    // run without ever appearing in that line.
    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
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
