import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { checkSubdomainReachable, provisionSchoolSubdomain } from '@/lib/hostinger';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * POST /api/super-admin/schools/[schoolId]/provision-subdomain
 *
 * Ensures `<slug>.<PLATFORM_BASE_DOMAIN>` exists at the host, then checks
 * whether it is actually serving yet.
 *
 * ── Why this exists as its own route ─────────────────────────────────────
 * Three cases need it, and they are the same operation:
 *
 *   1. **Retry after a failure.** School creation records the failure instead
 *      of raising, so something has to be able to try again.
 *   2. **Reconciling schools that predate this feature.** Migration 0021 left
 *      every existing school on `pending`, because the platform had never
 *      verified any of them and marking them `ready` would have been a guess
 *      about the outside world. Provisioning is idempotent, so asking once
 *      moves an already-parked school straight to `ready`.
 *   3. **Advancing `provisioning` to `ready`.** Creating the alias is not the
 *      same as it being reachable — DNS has to propagate and a certificate has
 *      to be issued, roughly three minutes on Hostinger. Only a real request
 *      can tell, and that is what the reachability check does.
 *
 * Safe to call repeatedly, and it never deletes anything: `lib/hostinger.ts`
 * deliberately does not wrap Hostinger's delete endpoint, so no amount of
 * retrying can remove a working domain.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ schoolId: string }> },
) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await params;

    const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);

    if (school === undefined) {
      return apiFailure('not_found', 'No such school.', 404);
    }

    const provision = await provisionSchoolSubdomain(school.slug);

    // Only ask whether it is live once the alias is known to exist. Probing a
    // hostname that was never created just times out and tells us nothing we
    // did not already know from the failure above.
    const reachable =
      provision.status === 'provisioning'
        ? await checkSubdomainReachable(provision.fqdn)
        : false;

    const status = reachable ? 'ready' : provision.status;

    const [updated] = await db
      .update(schools)
      .set({
        subdomainStatus: status,
        subdomainError: status === 'failed' ? provision.message : null,
        subdomainProvisionedAt:
          status === 'failed' || status === 'unmanaged' ? null : new Date(),
      })
      .where(eq(schools.id, schoolId))
      .returning();

    return apiSuccess({
      school: updated ?? school,
      subdomain: {
        host: provision.fqdn,
        status,
        reachable,
        alreadyExisted: provision.alreadyExisted,
        message: reachable
          ? `${provision.fqdn} is live and serving.`
          : provision.message,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
