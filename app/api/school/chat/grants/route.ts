import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';

import {
  chatGrants,
  GRANT_EFFECTS,
  GRANT_REASON_MAX,
  GRANT_SCOPE_TYPES,
  grantRankFor,
  type GrantEffect,
  type GrantScopeType,
} from '@/db/schema/chat-grants';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { grantScopeProblem } from '@/lib/chat-grant-scope';
import { db } from '@/lib/drizzle';
import { getSchoolUserByUid } from '@/lib/school-queries';

/**
 * /api/school/chat/grants — opening chat, and closing it.
 *
 * Every control the brief described is a row here: a teacher opening 7-B for
 * two hours, the same teacher opening five named pupils, an administrator's
 * per-pupil switch, and a principal banning a parent. One route, one table, one
 * audit trail — and the control nobody has asked for yet is a row rather than a
 * migration.
 *
 * ── Two things this route will not let you do ────────────────────────────
 * **Grant outside your own reach.** A teacher may open a section she teaches
 * and nothing else; `grantScopeProblem` re-derives that from the timetable
 * rather than trusting the id in the body. `chat.grant` is the door, not the
 * room.
 *
 * **Lift a ban issued above you.** Rank is snapshotted onto the row and
 * compared by the resolver, so a teacher's allow simply loses to a principal's
 * deny — but a teacher must not be able to *revoke* that deny either, and the
 * DELETE half checks rank before it writes. Without both halves the ban is
 * advisory, and it fails silently, which is the whole reason the column exists.
 *
 * A deny carries a reason, enforced by the table. A ban a parent cannot be told
 * the grounds for is a ban the school cannot defend.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface GrantBody {
  scopeType?: unknown;
  scopeId?: unknown;
  effect?: unknown;
  minutes?: unknown;
  reason?: unknown;
}

interface RevokeBody {
  grantId?: unknown;
}

/** Longest window a single grant may open, in minutes. Twelve hours. */
const MAX_GRANT_MINUTES = 12 * 60;

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const now = new Date();

      const grants = await db
        .select({
          id: chatGrants.id,
          scopeType: chatGrants.scopeType,
          scopeId: chatGrants.scopeId,
          effect: chatGrants.effect,
          startsAt: chatGrants.startsAt,
          endsAt: chatGrants.endsAt,
          grantedByRole: chatGrants.grantedByRole,
          grantedByRank: chatGrants.grantedByRank,
          reason: chatGrants.reason,
        })
        .from(chatGrants)
        .where(
          and(
            eq(chatGrants.locationId, auth.locationId),
            isNull(chatGrants.revokedAt),
            or(isNull(chatGrants.endsAt), gt(chatGrants.endsAt, now)),
          ),
        )
        .orderBy(desc(chatGrants.createdAt))
        .limit(200);

      return apiSuccess({ grants, yourRank: grantRankFor(auth.role) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'chat.grant' },
);

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<GrantBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Send a grant.', 400);

      const scopeType = body.scopeType;
      const scopeId = body.scopeId;
      const effect = body.effect;
      const reasonRaw = typeof body.reason === 'string' ? body.reason.trim() : '';

      if (
        typeof scopeType !== 'string' ||
        !(GRANT_SCOPE_TYPES as readonly string[]).includes(scopeType)
      ) {
        return apiFailure('invalid_body', 'Say what the grant applies to.', 400);
      }
      if (typeof scopeId !== 'string' || scopeId === '') {
        return apiFailure('invalid_body', 'Say what the grant applies to.', 400);
      }
      if (typeof effect !== 'string' || !(GRANT_EFFECTS as readonly string[]).includes(effect)) {
        return apiFailure('invalid_body', 'A grant either opens chat or closes it.', 400);
      }
      if (effect === 'deny' && reasonRaw === '') {
        return apiFailure(
          'invalid_body',
          'Say why. A ban the person cannot be told the grounds for is one the school cannot defend.',
          400,
        );
      }
      if (reasonRaw.length > GRANT_REASON_MAX) {
        return apiFailure(
          'invalid_body',
          `A reason can be at most ${String(GRANT_REASON_MAX)} characters.`,
          400,
        );
      }

      // An opening is time-boxed; a ban stands until it is lifted. That
      // asymmetry is the product decision: "open for two hours" is the thing
      // teachers asked for, and a ban that expired on its own would be a
      // safeguarding decision undone by a clock.
      let endsAt: Date | null = null;
      if (effect === 'allow') {
        const minutes = typeof body.minutes === 'number' ? Math.floor(body.minutes) : 0;
        if (minutes < 5 || minutes > MAX_GRANT_MINUTES) {
          return apiFailure(
            'invalid_body',
            `Open chat for between 5 minutes and ${String(MAX_GRANT_MINUTES / 60)} hours.`,
            400,
          );
        }
        endsAt = new Date(Date.now() + minutes * 60_000);
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      const scopeProblem = await grantScopeProblem(
        auth,
        me.id,
        scopeType as GrantScopeType,
        scopeId,
      );
      if (scopeProblem !== null) return apiFailure('refused', scopeProblem, 403);

      const created = await db
        .insert(chatGrants)
        .values({
          locationId: auth.locationId,
          branchId: auth.branchId,
          scopeType,
          scopeId,
          capability: 'initiate',
          effect,
          endsAt,
          grantedBy: me.id,
          // Snapshotted, like a message's sender. A later promotion must not
          // retrospectively strengthen a ban somebody issued as a teacher.
          grantedByRole: auth.role,
          grantedByRank: grantRankFor(auth.role),
          reason: reasonRaw === '' ? null : reasonRaw,
        })
        .returning({ id: chatGrants.id, endsAt: chatGrants.endsAt });

      return apiSuccess({ grant: created[0] }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'chat.grant' },
);

export const DELETE = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<RevokeBody>(request);
      const grantId = body?.grantId;

      if (typeof grantId !== 'string' || grantId === '') {
        return apiFailure('invalid_body', 'Say which grant to close.', 400);
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      const rows = await db
        .select({
          effect: chatGrants.effect,
          grantedByRank: chatGrants.grantedByRank,
          grantedByRole: chatGrants.grantedByRole,
        })
        .from(chatGrants)
        .where(
          and(eq(chatGrants.locationId, auth.locationId), eq(chatGrants.id, grantId)),
        )
        .limit(1);

      const grant = rows[0];
      if (grant === undefined) return apiFailure('not_found', 'No such grant.', 404);

      // The second half of the precedence rule. Resolution already makes a
      // junior allow lose to a senior deny; without this, the junior could
      // simply delete the deny instead and reach the same place.
      const myRank = grantRankFor(auth.role);
      if ((grant.effect as GrantEffect) === 'deny' && grant.grantedByRank > myRank) {
        return apiFailure(
          'refused',
          `That ban was set by the ${grant.grantedByRole.replace(/_/g, ' ')} and only they can lift it.`,
          403,
        );
      }

      const revoked = await db
        .update(chatGrants)
        .set({ revokedAt: new Date(), revokedBy: me.id })
        .where(
          and(
            eq(chatGrants.locationId, auth.locationId),
            eq(chatGrants.id, grantId),
            isNull(chatGrants.revokedAt),
          ),
        )
        .returning({ id: chatGrants.id });

      return apiSuccess({ revoked: revoked.length > 0 });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'chat.grant' },
);
