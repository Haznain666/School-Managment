import { apiSuccess, handleApiError } from '@/lib/api-response';
import { inspectBuckets, resetBucketCache } from '@/lib/storage-bucket';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * GET /api/super-admin/diagnostics/storage
 *
 * Reports which Cloud Storage bucket the running application resolves to, and
 * whether it actually exists.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * "The specified bucket does not exist" is Google's own message and it names
 * no bucket, so it reads as a broken integration rather than a configuration
 * difference. The usual cause is the default bucket suffix: projects created
 * from 30 October 2024 get `.firebasestorage.app`, older ones `.appspot.com`,
 * and a deployment guessing the wrong one fails on every upload.
 *
 * Comparing a Firebase console against a Vercel dashboard is guesswork; this
 * asks the deployed process itself, which is the only authority on what its
 * own environment resolves to. It probes rather than trusts, including the
 * explicitly configured name — the question being answered is "is my
 * configuration right?", and taking it on faith would defeat the point.
 *
 * Guarded by the Super Admin session. The response contains no secret: a
 * bucket name is public, appearing in every download URL the app serves.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireSuperAdmin();

    // A stale memo would report the state this process started in rather than
    // the state now, which is the opposite of useful just after someone has
    // changed the variable and redeployed.
    resetBucketCache();

    const diagnostics = await inspectBuckets();

    const ok = diagnostics.resolved !== null;

    return apiSuccess({
      ...diagnostics,
      ok,
      advice: ok
        ? diagnostics.configured === null
          ? `Working, resolved by probe to "${diagnostics.resolved}". Set FIREBASE_ADMIN_STORAGE_BUCKET to that value to skip the probe on cold start.`
          : 'Working, and explicitly configured.'
        : diagnostics.configured === null
          ? 'No bucket found. Open Firebase Console → Build → Storage and click "Get started" if Storage has never been enabled, then set FIREBASE_ADMIN_STORAGE_BUCKET.'
          : `FIREBASE_ADMIN_STORAGE_BUCKET is set to "${diagnostics.configured}", which does not exist or is not readable by this service account. Check the name in Firebase Console → Storage, without the "gs://" prefix.`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
