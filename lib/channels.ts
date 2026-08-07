import 'server-only';

import { cache } from 'react';
import { and, eq } from 'drizzle-orm';

import { schoolModules } from '@/db/schema';
import type { PlatformChannelKey } from '@/lib/platform-modules';

import { db } from './drizzle';

/**
 * Which delivery channels a school may use.
 *
 * ── Why a gate and not a deletion ────────────────────────────────────────
 * WhatsApp is a paid add-on, not a mistake. Schools that pay for it get it;
 * the rest fall back to email. So every send path asks this before sending,
 * and the sending code stays exactly where it is — commented-out or deleted
 * code cannot be switched back on by a Super Admin at three in the afternoon.
 *
 * ── Fail closed ──────────────────────────────────────────────────────────
 * A school with no row is off, which matches how `school_modules` has always
 * read. That means a freshly provisioned school sends no WhatsApp until
 * someone turns it on, and it means a failed lookup does not accidentally
 * bill a school for messages it never bought.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────
 * One indexed lookup, memoised per request by `cache()` — the same arrangement
 * `lib/school-auth.ts` and `lib/permission-queries.ts` use. A "send all
 * reminders" loop over three hundred challans asks once.
 */
const channelEnabled = cache(
  async (locationId: string, channel: PlatformChannelKey): Promise<boolean> => {
    const rows = await db
      .select({ isEnabled: schoolModules.isEnabled })
      .from(schoolModules)
      .where(
        and(
          eq(schoolModules.locationId, locationId),
          eq(schoolModules.moduleKey, channel),
        ),
      )
      .limit(1);

    return rows[0]?.isEnabled ?? false;
  },
);

/**
 * May this school send over WhatsApp?
 *
 * Callers should treat `false` as "use email", never as an error. A school
 * without WhatsApp is a supported configuration and will be the normal one
 * once the internal chat system lands (`ROADMAP.md` §5).
 */
export async function isWhatsAppEnabled(locationId: string): Promise<boolean> {
  return channelEnabled(locationId, 'whatsapp');
}
