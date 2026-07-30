import 'server-only';

import { and, eq, ne } from 'drizzle-orm';

import { branches } from '@/db/schema';

import { db } from './drizzle';

/**
 * Keeps the "at most one main branch per school" rule true after a write.
 *
 * Enforced here rather than with a partial unique index because promoting a
 * branch has to demote the incumbent, which a constraint would reject instead
 * of resolving.
 */
export async function demoteOtherMainBranches(
  locationId: string,
  keepBranchId: string,
): Promise<void> {
  await db
    .update(branches)
    .set({ isMainBranch: false, updatedAt: new Date() })
    .where(
      and(
        eq(branches.locationId, locationId),
        eq(branches.isMainBranch, true),
        ne(branches.id, keepBranchId),
      ),
    );
}
