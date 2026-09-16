import 'server-only';

import { and, eq, isNotNull, isNull, lte, inArray } from 'drizzle-orm';

import { schoolUsers, schools, staff, staffFullName } from '@/db/schema';

import { describeError } from './describe-error';
import { db } from './drizzle';
import { enqueueEmail } from './email-outbox';

/**
 * Telling HR that somebody's probation has ended (Sprint 33b, decision 4).
 *
 * ── Claimed, not checked ─────────────────────────────────────────────────
 * `instrumentation.ts` starts one of these per server process and production
 * runs **seven** — seven distinct 60-second offsets inside the same minute, in
 * the log. A read followed by an `if` lets all seven pass the same test and
 * send HR the same email seven times about the same person.
 *
 * So a person is claimed with a conditional `UPDATE … RETURNING`:
 * `probation_notified_at` moves from null to now **only where it is still
 * null**, and Postgres decides that on one row under one lock. Exactly one
 * process gets the row back; the other six get nothing and do nothing.
 * CLAUDE.md's rule, and this is the whole of it.
 *
 * **Claim first, then hand it back on a throw.** The claim moves before the
 * mail is queued, so a failure that did not revert would be a probation the
 * school believes it was told about and nobody was — and the person stays on
 * probation for ever, because nothing else in the product looks at that date.
 * `releaseClaim` is the revert, and it is the same contract the voucher
 * sweepers and the holiday notifier have.
 *
 * ── Cross-tenant by design ───────────────────────────────────────────────
 * Like the chat digest, this sweep belongs to no school: it claims across every
 * tenant in one statement and then mails per school. There is no `locationId`
 * to scope it by, and inventing one would mean a query per school per minute.
 */

/** How often the sweep looks. Probation ends on a date, not at a moment. */
const SWEEP_SECONDS = 900;

let sweepTimer: NodeJS.Timeout | null = null;
let sweeping = false;

/** One person the sweep has taken ownership of telling HR about. */
export interface ProbationClaim {
  staffId: string;
  locationId: string;
  name: string;
  employeeCode: string;
  endsOn: string;
  branchId: string | null;
}

/** Today in UTC, as the `date` columns hold it. */
function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Takes the notification for everybody whose probation has ended.
 *
 * The `WHERE` is the whole design: still on probation, has an end date, that
 * date has arrived, and nobody has been told. Any process losing the race
 * simply gets fewer rows back.
 *
 * `lte`, not a raw `sql` template. CLAUDE.md's rule, and the reason is the one
 * that kept scheduled announcements from ever releasing: an operator maps the
 * value for the driver, a template hands it over raw.
 */
export async function claimEndedProbations(now: Date = new Date()): Promise<ProbationClaim[]> {
  const rows = await db
    .update(staff)
    .set({ probationNotifiedAt: now })
    .where(
      and(
        eq(staff.isOnProbation, true),
        isNotNull(staff.probationEndsOn),
        lte(staff.probationEndsOn, todayIso(now)),
        isNull(staff.probationNotifiedAt),
        eq(staff.status, 'active'),
      ),
    )
    .returning({
      staffId: staff.id,
      locationId: staff.locationId,
      firstName: staff.firstName,
      lastName: staff.lastName,
      employeeCode: staff.employeeCode,
      endsOn: staff.probationEndsOn,
      branchId: staff.branchId,
    });

  return rows.map((row) => ({
    staffId: row.staffId,
    locationId: row.locationId,
    name: staffFullName(row),
    employeeCode: row.employeeCode,
    // The `WHERE` has already excluded null, and the map keeps TypeScript
    // honest without a non-null assertion.
    endsOn: row.endsOn ?? todayIso(now),
    branchId: row.branchId,
  }));
}

/**
 * Hands a claim back, so a failure to queue the mail is not recorded as having
 * told anybody.
 *
 * Set to **null**, which is the value the claim tests for. Recovering whatever
 * it held before would mean reading it first, and a read-then-write is the
 * shape this design exists to avoid.
 */
export async function releaseClaim(claim: ProbationClaim): Promise<void> {
  await db
    .update(staff)
    .set({ probationNotifiedAt: null })
    .where(eq(staff.id, claim.staffId));
}

/**
 * Who hears about it: HR at that school, or the owner when there is no HR.
 *
 * The fallback matters more than it looks. A school with no `hr_manager`
 * account is the common small school, and a notification with no recipient is
 * a claim taken, a row marked told, and nobody told.
 */
export async function probationRecipients(locationId: string): Promise<string[]> {
  const rows = await db
    .select({ role: schoolUsers.role, email: schoolUsers.email })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.isActive, true),
        inArray(schoolUsers.role, ['hr_manager', 'school_admin']),
      ),
    );

  const usable = rows.filter(
    (row): row is { role: string; email: string } =>
      typeof row.email === 'string' && row.email.trim() !== '',
  );

  const hr = usable.filter((row) => row.role === 'hr_manager').map((row) => row.email);
  return hr.length > 0 ? hr : usable.map((row) => row.email);
}

/** The message, as a school would write it. Exported so a check can read it. */
export function buildProbationEmail(input: {
  name: string;
  employeeCode: string;
  endsOn: string;
  schoolName: string;
}): { subject: string; text: string } {
  return {
    subject: `Probation ended — ${input.name}`,
    text: [
      `${input.name} (${input.employeeCode}) finished their probation period on ${input.endsOn}.`,
      '',
      'Nothing has been changed on their record. Two things are waiting on a decision:',
      '',
      '  • confirm them, which sets the date their leave starts accruing from; or',
      '  • extend the probation — up to 180 calendar days in total, including',
      '    the days already served.',
      '',
      `Open ${input.schoolName}'s HR screen, find them under Staff, and record which.`,
      '',
      'This is the only reminder that will be sent for this person.',
    ].join('\n'),
  };
}

/** One school's name, for the email. Falls back rather than throwing. */
async function schoolName(locationId: string): Promise<string> {
  const rows = await db
    .select({ name: schools.name })
    .from(schools)
    .where(eq(schools.locationId, locationId))
    .limit(1);

  return rows[0]?.name ?? 'your school';
}

/** One pass: claim everybody due, and mail their school's HR. */
export async function sweepProbations(now: Date = new Date()): Promise<number> {
  const claims = await claimEndedProbations(now);
  let sent = 0;

  for (const claim of claims) {
    try {
      const [recipients, name] = await Promise.all([
        probationRecipients(claim.locationId),
        schoolName(claim.locationId),
      ]);

      if (recipients.length === 0) {
        // Nobody to tell. The claim is handed back rather than kept: the day
        // this school invites an HR manager, the reminder should still arrive.
        await releaseClaim(claim);
        continue;
      }

      const message = buildProbationEmail({
        name: claim.name,
        employeeCode: claim.employeeCode,
        endsOn: claim.endsOn,
        schoolName: name,
      });

      for (const to of recipients) {
        await enqueueEmail({
          locationId: claim.locationId,
          to,
          subject: message.subject,
          text: message.text,
        });
      }

      sent += 1;
    } catch (error) {
      console.error('[probation] could not tell HR:', describeError(error));
      // Claim first, revert on failure. Without this the school believes it
      // was told and the person stays on probation with nothing to say why.
      await releaseClaim(claim).catch(() => undefined);
    }
  }

  return sent;
}

/**
 * Starts the sweep. Called once per server process from `instrumentation.ts`.
 *
 * Never throws into the runtime and never holds the process open: the same bar
 * every other timer in that file meets.
 */
export function startProbationNotifier(): void {
  if (sweepTimer !== null) return;

  sweepTimer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;

    void sweepProbations()
      .then((sent) => {
        if (sent > 0) console.info(`[probation] told HR about ${String(sent)} person(s)`);
      })
      .catch((error: unknown) => {
        console.error('[probation] sweep failed:', describeError(error));
      })
      .finally(() => {
        sweeping = false;
      });
  }, SWEEP_SECONDS * 1000);

  sweepTimer.unref?.();
}
