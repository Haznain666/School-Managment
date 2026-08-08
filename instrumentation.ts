/**
 * Next.js calls `register()` once per server process, before it serves
 * anything. It is the only place this application can start background work.
 *
 * ── What runs here, and what must not ────────────────────────────────────
 * Only the email outbox drainer. Anything started here runs forever in a
 * process that also serves every request, so the bar is high: it must be
 * idempotent, it must not hold the process open, and it must never throw into
 * the runtime.
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
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startOutboxDrainer } = await import('./lib/email-outbox');
    startOutboxDrainer();
  }
}
