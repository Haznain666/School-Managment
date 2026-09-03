import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { chatMessages } from '@/db/schema/chat-messages';
import { chatReports } from '@/db/schema/chat-reports';
import { schoolUsers } from '@/db/schema/school-users';
import { schools } from '@/db/schema/schools';

import { getChatSchoolSettings } from './chat-queries';
import { db } from './drizzle';
import { enqueueEmail } from './email-outbox';

/**
 * The escalation path, and the only thing in this module that does not wait.
 *
 * ── Why this is separate from moderation ─────────────────────────────────
 * A reported message goes to a queue somebody opens on Monday. A pupil writing
 * something about self-harm at two in the morning is the most important message
 * this system will ever carry, and a queue is the wrong shape for it entirely.
 *
 * So a match here does three things at the moment the message is written: the
 * message is flagged, a `chat_reports` row is created with
 * `severity = 'safeguarding'`, and an email is queued to the school's
 * designated lead. Nothing about it is silent to the pupil either — the thread
 * tells them a member of staff has been told, because a child who has just said
 * the hardest thing they will ever type should not be met with nothing.
 *
 * ── The message is never blocked ─────────────────────────────────────────
 * A match flags; it does not refuse. Refusing would teach a distressed pupil
 * that the school's own channel rejects them for saying it, which is the exact
 * opposite of what the feature is for. `flagged_at` is a routing decision, not
 * a moderation verdict.
 *
 * ── What this is not ─────────────────────────────────────────────────────
 * It is a keyword scan, and keyword scans miss things and misfire. It is a
 * floor rather than a system: it catches the phrasings people actually use when
 * they are in trouble, and it is deliberately biased towards a false positive,
 * because the cost of one is a member of staff reading a message that turned
 * out to be fine.
 */

/**
 * Phrasings that route straight to the safeguarding lead.
 *
 * Deliberately phrase-level rather than word-level. A word list containing
 * "hurt" or "die" flags a football injury and a history essay, and a lead who
 * is emailed about those stops reading the emails — which is the failure mode
 * that matters, because it is silent and it arrives before the real one.
 */
const SAFEGUARDING_PHRASES: readonly RegExp[] = [
  /\bkill (?:myself|my self)\b/i,
  /\bkilling myself\b/i,
  /\bend (?:my|it all)\b.{0,12}\b(?:life|now)\b/i,
  /\bwant to die\b/i,
  /\bwanna die\b/i,
  /\bsuicid(?:e|al)\b/i,
  /\bhurt(?:ing)? myself\b/i,
  /\bharm(?:ing)? myself\b/i,
  /\bcut(?:ting)? myself\b/i,
  /\bself[- ]harm/i,
  /\bhe (?:hits|beats|touches) me\b/i,
  /\bshe (?:hits|beats|touches) me\b/i,
  /\bthey (?:hit|beat|touch) me\b/i,
  /\b(?:beats?|beating) me at home\b/i,
  /\bnot safe at home\b/i,
  /\bafraid to go home\b/i,
  /\bscared to go home\b/i,
  /\btouched me\b/i,
  /\bdon'?t want to live\b/i,
  /\bno (?:point|reason) (?:in )?living\b/i,
];

/**
 * Why a message needs a member of staff now, or null.
 *
 * Returns the phrase that matched rather than a boolean, so the report says
 * what triggered it and a lead can judge it in one line without opening the
 * thread — and so a misfiring pattern can be found and removed.
 */
export function safeguardingProblem(body: string): string | null {
  for (const pattern of SAFEGUARDING_PHRASES) {
    const match = pattern.exec(body);
    if (match !== null) {
      return `Automatic safeguarding flag: matched "${match[0]}"`;
    }
  }

  return null;
}

/** What the pupil is told, in the thread, when their message is flagged. */
export const SAFEGUARDING_ACKNOWLEDGEMENT =
  'A member of staff has been told about this message and will be in touch. ' +
  'If you are in danger right now, please find an adult you trust straight away.';

/**
 * Raises the report and queues the email.
 *
 * ── Claimed, not checked ─────────────────────────────────────────────────
 * `escalated_at` is set by a conditional `UPDATE … RETURNING` before the email
 * is queued. Production runs seven Node processes and any of them may be the
 * one handling a retry; without the claim, seven of them queue seven emails to
 * a safeguarding lead about one message, which is how a lead learns to filter
 * them.
 *
 * Never throws at its caller. A message that could not be escalated must still
 * be *stored* — losing the pupil's words because the mail queue was unhappy is
 * strictly worse than an escalation that has to be found in the queue. This
 * follows `lib/notifications.ts`, which makes the same trade for the same
 * reason and says so.
 */
export async function escalate(input: {
  locationId: string;
  conversationId: string;
  messageId: string;
  reason: string;
}): Promise<void> {
  try {
    const created = await db
      .insert(chatReports)
      .values({
        locationId: input.locationId,
        messageId: input.messageId,
        conversationId: input.conversationId,
        reportedBy: null,
        source: 'scan',
        severity: 'safeguarding',
        reason: input.reason,
        status: 'open',
      })
      .returning({ id: chatReports.id });

    const reportId = created[0]?.id;
    if (reportId === undefined) return;

    const claimed = await db
      .update(chatReports)
      .set({ escalatedAt: new Date() })
      .where(and(eq(chatReports.id, reportId), isNull(chatReports.escalatedAt)))
      .returning({ id: chatReports.id });

    if (claimed.length === 0) return;

    for (const address of await safeguardingRecipients(input.locationId)) {
      await enqueueEmail({
        locationId: input.locationId,
        to: address,
        subject: 'Urgent: a student message needs your attention',
        text:
          'A message sent through the school chat has been automatically flagged ' +
          'for safeguarding review.\n\n' +
          `${input.reason}\n\n` +
          'Open the moderation queue in the school portal to read it in context. ' +
          'This message was flagged by an automatic scan and has not been read by ' +
          'anyone yet.\n',
      });
    }
  } catch (error) {
    console.error('[chat] safeguarding escalation failed', error);
  }
}

/**
 * Who hears about it.
 *
 * The named lead when the school has set one; otherwise every active
 * administrator. A school that has not named a lead gets a worse answer than
 * one that has, and a much better answer than nobody — and the settings screen
 * says exactly that beside the field.
 */
async function safeguardingRecipients(locationId: string): Promise<string[]> {
  const settings = await getChatSchoolSettings(locationId);
  if (settings.safeguardingLeadEmail !== null && settings.safeguardingLeadEmail !== '') {
    return [settings.safeguardingLeadEmail];
  }

  const admins = await db
    .select({ email: schoolUsers.email })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.role, 'school_admin'),
        eq(schoolUsers.isActive, true),
      ),
    );

  return admins
    .map((row) => row.email)
    .filter((email): email is string => email !== null && email !== '');
}

/** The school's own name, for an email that has to identify itself. */
export async function schoolName(locationId: string): Promise<string> {
  const rows = await db
    .select({ name: schools.name })
    .from(schools)
    .where(eq(schools.locationId, locationId))
    .limit(1);

  return rows[0]?.name ?? 'Your school';
}

/** Whether a message is currently flagged, for the moderation queue's badge. */
export async function isFlagged(locationId: string, messageId: string): Promise<boolean> {
  const rows = await db
    .select({ flaggedAt: chatMessages.flaggedAt })
    .from(chatMessages)
    .where(and(eq(chatMessages.locationId, locationId), eq(chatMessages.id, messageId)))
    .limit(1);

  return rows[0]?.flaggedAt != null;
}
