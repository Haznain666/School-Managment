import 'server-only';

import { formatTimeOfDay } from '@/db/schema/timetable-slots';
import type { UserRole } from '@/types/school-auth';

import { openThread } from './chat-threads';
import { formatDateOnly } from './dates';
import { notify } from './notifications';
import { getModuleFlags } from './school-queries';

/**
 * `lib/substitute-notifier.ts` — telling a teacher they are covering. Sprint 33c.
 *
 * ── Two paths, both of which already existed ─────────────────────────────
 * The spec asks for "the chat and bell paths that already exist", and that is
 * exactly what this is: no new transport, no new table, no new email template.
 *
 *   · the **bell** — one `notifications` row through `notify()`, the same door
 *     every other "a thing happened, tell somebody" in the product uses. `kind`
 *     is free-form by design on that table, so a new one needs no migration;
 *   · **chat** — a real message from the person who arranged it, through
 *     `openThread`, which runs `initiateProblem`, seats both people, writes the
 *     message, the signals and the bell entry in one transaction and wakes the
 *     recipient's client. A staff-to-staff thread is always permitted, so this
 *     is the ordinary path and not a special case.
 *
 * ── Why the chat half is conditional and the bell half is not ────────────
 * Chat is a module (`school_modules.chat`) and a school can have it switched
 * off. The bell is not, and it is the half that reaches a teacher who is on
 * their register screen rather than their inbox. So a school without chat still
 * gets told; a school with chat gets told twice, in the two places they look.
 *
 * ── It never throws at its caller ────────────────────────────────────────
 * The same rule `notify()` itself carries, for a stronger reason here: the
 * substitution is already committed by the time this runs. Turning a failed
 * message into a 500 would tell the head their arrangement had not saved when
 * it had, and the next thing they would do is arrange it again with somebody
 * else. Every failure is logged with the school and the teacher in the line.
 *
 * ── It is not emailed ────────────────────────────────────────────────────
 * Deliberate, and the same decision `lib/chat-notifications.ts` records at
 * length: chat already owns its own mail — one digest per person per hour,
 * honouring quiet hours and the per-category preference — and a third channel
 * for one event is how people turn a school's email off altogether.
 */

export interface SubstituteNotice {
  locationId: string;
  /** Who arranged it. Null when the arranger has no school account of their own. */
  arrangedBy: {
    schoolUserId: string;
    name: string;
    role: UserRole;
    /** Their own campus, as `openThread` seats a thread by. */
    branchId: string | null;
  } | null;
  coverTeacher: { schoolUserId: string; name: string };
  /** `YYYY-MM-DD`. */
  date: string;
  sectionLabel: string;
  slotName: string;
  startTime: string;
  endTime: string;
  note: string | null;
}

/** The sentence, written once so the bell and the message cannot disagree. */
export function substituteMessage(notice: SubstituteNotice): { title: string; body: string } {
  const when = `${formatDateOnly(notice.date)}, ${notice.slotName} (${formatTimeOfDay(
    notice.startTime,
  )} – ${formatTimeOfDay(notice.endTime)})`;

  return {
    title: `You are covering ${notice.sectionLabel}`,
    body:
      `You have been asked to cover ${notice.sectionLabel} on ${when}.` +
      (notice.arrangedBy === null ? '' : ` Arranged by ${notice.arrangedBy.name}.`) +
      (notice.note === null || notice.note.trim() === '' ? '' : ` ${notice.note.trim()}`),
  };
}

/**
 * Tells the covering teacher, on both paths. Never throws.
 *
 * `teacherHref` deliberately points at the teacher's **calendar** on the date
 * rather than at the timetable grid: the substitution is for one day and the
 * grid is the standing week, so a link to the grid would show them a page the
 * cover does not appear on — which reads as the notice being wrong.
 */
export async function notifySubstitute(notice: SubstituteNotice): Promise<void> {
  const { title, body } = substituteMessage(notice);

  try {
    await notify({
      audience: 'school_user',
      locationId: notice.locationId,
      schoolUserId: notice.coverTeacher.schoolUserId,
      kind: 'timetable_substitute',
      title,
      body,
      href: `/teacher/calendar?date=${notice.date}`,
      // Bell only. See the docblock: chat carries its own mail and a third
      // channel for one event is how a school's email gets switched off.
      email: null,
    });
  } catch (error) {
    console.error(
      `[substitute] could not write the bell entry for ${notice.coverTeacher.schoolUserId} at ${notice.locationId}:`,
      error,
    );
  }

  if (notice.arrangedBy === null) return;

  try {
    const flags = await getModuleFlags(notice.locationId);
    if (!flags.chat) return;

    /*
     * A new thread per arrangement, not a running one.
     *
     * Each is about a different class on a different day, and its subject says
     * so. Folding a term's cover into one conversation would make that subject
     * a lie the second time, and a teacher scrolling for "what am I covering on
     * Thursday" would be reading a transcript instead of an inbox.
     */
    const opened = await openThread({
      locationId: notice.locationId,
      actor: {
        schoolUserId: notice.arrangedBy.schoolUserId,
        name: notice.arrangedBy.name,
        role: notice.arrangedBy.role,
        branchId: notice.arrangedBy.branchId,
      },
      target: { kind: 'person', id: notice.coverTeacher.schoolUserId },
      subject: title,
      body,
    });

    if (!opened.ok) {
      console.info(
        `[substitute] chat notice not sent at ${notice.locationId}: ${opened.problem}`,
      );
    }
  } catch (error) {
    console.error(
      `[substitute] could not send the chat notice at ${notice.locationId}:`,
      error,
    );
  }
}
