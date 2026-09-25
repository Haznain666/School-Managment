import 'server-only';

import { eq } from 'drizzle-orm';

import { notifications, superAdminUsers } from '@/db/schema';

import { db } from './drizzle';
import { enqueueEmail } from './email-outbox';
import { serverEnv } from './env';
import { shortDate } from './platform-billing';
import {
  sweepInvoiceGeneration,
  sweepOverdueBlocking,
  sweepTrialReminders,
  type TrialReminder,
} from './platform-billing-queries';
import { registerSweep } from './scheduler';

/**
 * The three billing sweeps — Sprint 35, §4–§6.
 *
 * Registered with `lib/scheduler.ts` and started by it; nothing here owns a
 * timer (CLAUDE.md, "one timer, one leader"). Each sweep's *work* is claimed
 * per item in `lib/platform-billing-queries.ts` — the lease is a second guard,
 * not a replacement, because a lease can change hands mid-tick.
 *
 * ── The intervals are matched to how often the work exists ───────────────
 * Invoices appear once a month and trial reminders once a day at most, so an
 * hour is already generous for both: at worst a reminder goes out fifty-nine
 * minutes after midnight. Blocking is the one a customer feels, in both
 * directions — nobody should stay open long past their grace, and the sweep
 * is also what notices the first tick of the 13th — so fifteen minutes. None of
 * these was chosen by "how soon would I like to know", which is the reasoning
 * CLAUDE.md records as having cost 98.6% of the database's egress.
 */

const INVOICE_SWEEP_SECONDS = 60 * 60;
const BLOCKING_SWEEP_SECONDS = 15 * 60;
const REMINDER_SWEEP_SECONDS = 60 * 60;

/** Every active super admin's address. The owner included, always. */
async function superAdminAddresses(): Promise<string[]> {
  try {
    const rows = await db
      .select({ email: superAdminUsers.email })
      .from(superAdminUsers)
      .where(eq(superAdminUsers.isActive, true));
    if (rows.length > 0) return rows.map((row) => row.email);
  } catch (error) {
    console.error('[billing] could not read the super admins; falling back to the owner:', error);
  }

  const owner = serverEnv('SUPER_ADMIN_EMAIL', '').trim();
  return owner === '' ? [] : [owner];
}

/**
 * One bell entry for the platform, and one email per active operator.
 *
 * The bell is written once rather than per operator: `super_admin`
 * notifications are shared by every operator by design (see
 * `db/schema/notifications.ts`), so one row per operator would show each of
 * them the same reminder several times.
 */
async function sendTrialReminder(reminder: TrialReminder): Promise<void> {
  const when =
    reminder.daysLeft <= 0
      ? 'today'
      : reminder.daysLeft === 1
        ? 'tomorrow'
        : `in ${String(reminder.daysLeft)} days`;

  const title = `${reminder.schoolName}: trial ends ${when}`;
  const body =
    `The free trial for ${reminder.schoolName} ends on ${shortDate(reminder.trialEndsOn)}. ` +
    'Billing starts the day after, and the first invoice is raised on the 1st of the following month.';
  const href = `/super-admin/schools/${reminder.schoolId}/billing`;

  await db
    .insert(notifications)
    .values({
      audience: 'super_admin',
      locationId: reminder.locationId,
      schoolUserId: null,
      kind: 'billing_trial',
      title,
      body,
      href,
    });

  const base = serverEnv('INVITE_LINK_BASE_URL', '').trim().replace(/\/+$/, '');
  // Past the bell, nothing throws: a throw hands the claim back and the next
  // tick would repeat the bell and every email already queued. The outbox
  // retries its own deliveries; a failure to *queue* one is logged.
  for (const to of await superAdminAddresses()) {
    try {
      await enqueueEmail({
        locationId: reminder.locationId,
        to,
        subject: `${title} · SchoolHub`,
        text: `${body}\n\n${base === '' ? href : `${base}${href}`}\n`,
      });
    } catch (error) {
      console.error(`[billing] could not queue the trial reminder for ${to}:`, error);
    }
  }
}

export function registerPlatformBillingSweeps(): void {
  registerSweep('platform-invoices', INVOICE_SWEEP_SECONDS, async () => {
    const created = await sweepInvoiceGeneration(new Date());
    if (created > 0) console.info(`[billing] raised ${String(created)} draft invoice(s)`);
  });

  registerSweep('platform-blocking', BLOCKING_SWEEP_SECONDS, async () => {
    const blocked = await sweepOverdueBlocking(new Date());
    if (blocked > 0) console.info(`[billing] blocked ${String(blocked)} school(s) past grace`);
  });

  registerSweep('platform-trial-reminders', REMINDER_SWEEP_SECONDS, async () => {
    const sent = await sweepTrialReminders(new Date(), sendTrialReminder);
    if (sent > 0) console.info(`[billing] sent ${String(sent)} trial reminder(s)`);
  });
}
