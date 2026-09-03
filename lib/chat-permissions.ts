import {
  type GrantEffect,
  type GrantScopeType,
  SCOPE_SPECIFICITY,
} from '@/db/schema/chat-grants';

/**
 * Who may say what to whom, decided without touching the database.
 *
 * This module is deliberately free of `server-only` and of any database import,
 * for the same reason `lib/permissions.ts` is: the browser has to be able to
 * render exactly what the server will enforce. A "Message" button that appears
 * and then fails is worse than one that was never drawn, and a second copy of
 * these rules written for the client is the way the two drift apart.
 *
 * `lib/chat-queries.ts` is the half that talks to Postgres — it derives a
 * person's scopes and their reachable list and then hands them here.
 *
 * ── The shape of the thing ───────────────────────────────────────────────
 * Reachability is **derived**, never listed. A pupil has no directory, no
 * search that returns a person, and no way to name somebody the school's own
 * data does not already connect them to. That is not a feature of the UI; it is
 * why the abuses this module was specified to prevent have no surface to happen
 * on.
 *
 * Two of them are not enforced here at all. Pupil-to-pupil and parent-to-parent
 * messaging are refused by two partial unique indexes on `chat_participants`,
 * which is a stronger guarantee than anything a resolver can offer: a resolver
 * is bypassed by the next route that forgets to call it.
 */

/** Pakistan Standard Time, and why this is a constant rather than a column.
 *
 * Every school on this platform is in one timezone, and the quiet-hours and
 * contact-window questions are about the wall clock in the staff room: eight in
 * the evening means eight in the evening *there*. Reading the Node process's
 * own zone would answer them differently on a Hostinger box than on a laptop,
 * which is the hazard `lib/admissions-queries.ts` names when it insists on the
 * database's clock for the academic year.
 *
 * When a school outside PKT arrives this becomes a column on
 * `chat_school_settings` and this constant becomes its default. Until then a
 * column would be a setting nobody can answer differently.
 */
export const SCHOOL_TIME_ZONE = 'Asia/Karachi';

/** Minutes since midnight, on the school's wall clock rather than the server's. */
export function minutesOfDay(at: Date, timeZone: string = SCHOOL_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');

  return hour * 60 + minute;
}

/** `20:00`, for a message that has to tell somebody when they may write again. */
export function formatMinutesOfDay(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------------
 * Grants
 * --------------------------------------------------------------------- */

/** One scope a person falls inside — their own id, their section, their grade. */
export interface ScopeKey {
  type: GrantScopeType;
  id: string;
}

/** The columns of `chat_grants` that resolution actually reads. */
export interface GrantLike {
  scopeType: GrantScopeType;
  scopeId: string;
  effect: GrantEffect;
  grantedByRank: number;
  startsAt: Date;
  endsAt: Date | null;
  revokedAt: Date | null;
  reason: string | null;
}

export interface GrantDecision {
  /** Whether a live grant permits initiating. False is not a refusal on its
   *  own — the default is reply-only, and `matched` says which it is. */
  allowed: boolean;
  /** The grant that decided it, or null when nothing matched and the default
   *  applied. */
  matched: GrantLike | null;
  /** Why, in words a clerk can read. Null when a grant allowed it. */
  reason: string | null;
}

function isLive(grant: GrantLike, now: Date): boolean {
  if (grant.revokedAt !== null) return false;
  if (grant.startsAt.getTime() > now.getTime()) return false;
  return grant.endsAt === null || grant.endsAt.getTime() > now.getTime();
}

function mostSpecific(grants: GrantLike[]): GrantLike | null {
  let best: GrantLike | null = null;

  for (const grant of grants) {
    if (best === null || SCOPE_SPECIFICITY[grant.scopeType] > SCOPE_SPECIFICITY[best.scopeType]) {
      best = grant;
    }
  }

  return best;
}

/**
 * Whether a live grant opens initiation for somebody, given every scope they
 * fall inside.
 *
 * ── Most specific deny, then most specific allow, then the default ───────
 * And rank is compared *before* specificity, which is the part that makes a ban
 * mean something. The scenario it exists for: the Principal bans a parent, and
 * a teacher then opens the whole class for an activity. If specificity alone
 * decided it, a section-scoped teacher allow would beat a school-scoped
 * principal deny and the teacher would have quietly un-banned somebody the
 * principal banned — silently, with nobody told the ban had stopped applying.
 *
 * So: an allow issued below the highest live deny's rank is discarded outright.
 * What remains competes on specificity, and a deny wins a tie.
 *
 * The same rank may still overturn itself. A principal who bans a parent
 * school-wide and then allows that one parent by name has issued a more
 * specific allow at equal rank, and it wins — which is the difference between a
 * rule and a wall.
 */
export function resolveGrant(
  grants: readonly GrantLike[],
  scopes: readonly ScopeKey[],
  now: Date = new Date(),
): GrantDecision {
  const inScope = new Set(scopes.map((scope) => `${scope.type}:${scope.id}`));

  const live = grants.filter(
    (grant) => isLive(grant, now) && inScope.has(`${grant.scopeType}:${grant.scopeId}`),
  );

  const denies = live.filter((grant) => grant.effect === 'deny');
  const highestDenyRank = denies.reduce(
    (highest, grant) => Math.max(highest, grant.grantedByRank),
    -1,
  );

  // An allow from below the strongest deny is not weighed at all.
  const allows = live.filter(
    (grant) => grant.effect === 'allow' && grant.grantedByRank >= highestDenyRank,
  );

  const bestDeny = mostSpecific(denies);
  const bestAllow = mostSpecific(allows);

  if (
    bestDeny !== null &&
    (bestAllow === null ||
      SCOPE_SPECIFICITY[bestAllow.scopeType] <= SCOPE_SPECIFICITY[bestDeny.scopeType])
  ) {
    return {
      allowed: false,
      matched: bestDeny,
      reason: bestDeny.reason ?? 'Chat has been turned off for this person.',
    };
  }

  if (bestAllow !== null) {
    return { allowed: true, matched: bestAllow, reason: null };
  }

  return {
    allowed: false,
    matched: null,
    reason: null,
  };
}

/* ------------------------------------------------------------------------
 * The windows
 * --------------------------------------------------------------------- */

/**
 * Why a pupil may not send right now, or null.
 *
 * The window gates **sending only**. Reading is never time-boxed anywhere in
 * this module, and that is deliberate: a pupil has to be able to re-read what a
 * teacher told them about tomorrow's exam long after they have stopped being
 * able to answer it.
 *
 * It rolls, rather than being a session clock started when the thread opened.
 * A fixed clock produces the case this design exists to avoid — the pupil asks
 * at two, the window shuts at three, the teacher answers at ten, and the pupil
 * cannot reply, which the teacher reads as being ignored.
 */
export function replyWindowProblem(
  expiresAt: Date | null,
  now: Date = new Date(),
): string | null {
  if (expiresAt === null) return 'This conversation is not open for replies.';
  if (expiresAt.getTime() <= now.getTime()) {
    return 'The reply window has closed. You can reply again when a teacher writes back.';
  }
  return null;
}

/** When a staff message lands, this is the pupil's new deadline. */
export function nextReplyWindow(minutes: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Why a pupil may not send another message yet, or null.
 *
 * This is the flood control, and it is turn-taking rather than a rate limit on
 * purpose. "Twenty a day" still permits twenty in twenty seconds; "three
 * unanswered" cannot be flooded through at any speed, because the fourth needs
 * another person to act first.
 */
export function turnTakingProblem(unanswered: number, max: number): string | null {
  if (unanswered < max) return null;
  return `You have sent ${String(unanswered)} messages without a reply. Wait for an answer before sending another.`;
}

/** Why staff may not message a pupil at this hour, or null. */
export function contactWindowProblem(
  now: Date,
  from: number,
  to: number,
  timeZone: string = SCHOOL_TIME_ZONE,
): string | null {
  const minutes = minutesOfDay(now, timeZone);
  if (minutes >= from && minutes < to) return null;

  return (
    `Students can only be messaged between ${formatMinutesOfDay(from)} and ` +
    `${formatMinutesOfDay(to)}. Your message has not been sent.`
  );
}

/**
 * Whether a person's notifications should be held until morning.
 *
 * Unlike the contact window this never refuses anything — the message lands, and
 * the digest carries it when the quiet hours end. The difference is who is being
 * protected: an adult from being disturbed, or a child from being contacted.
 *
 * Wraps midnight, because that is the only shape anybody ever wants: 22:00 to
 * 07:00 is one window, not two.
 */
export function inQuietHours(
  now: Date,
  from: number | null,
  to: number | null,
  timeZone: string = SCHOOL_TIME_ZONE,
): boolean {
  if (from === null || to === null) return false;

  const minutes = minutesOfDay(now, timeZone);
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/* ------------------------------------------------------------------------
 * Links
 * --------------------------------------------------------------------- */

/**
 * Whether a message body from a pupil carries something link-shaped.
 *
 * Links in a pupil's message are rendered as inert text rather than anchors,
 * and this is what decides that. It is cheap, and it closes the mechanism that
 * actually matters: a school chat cannot stop pupils using another app, but it
 * must not be the notice board where they exchange the address of one.
 *
 * Deliberately broad and deliberately not a blocker. A false positive costs a
 * pupil a clickable link; refusing the message would cost them the sentence.
 */
const LINK_SHAPED =
  /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|me|co|pk|gg|ly|app|link|xyz)\b)/i;

export function containsLink(body: string): boolean {
  return LINK_SHAPED.test(body);
}
