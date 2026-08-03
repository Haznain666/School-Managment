import { apiSuccess, handleApiError } from '@/lib/api-response';
import { inspectStorage } from '@/lib/storage';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * GET /api/super-admin/diagnostics/storage
 *
 * Reports whether Supabase Storage is reachable and correctly configured for
 * the running deployment.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * An upload can fail for four reasons that all look alike from the outside:
 * the variables are absent, the URL points at the wrong project, the anon key
 * was pasted where the service_role key belongs, or the bucket was never
 * created. Comparing a Supabase dashboard against a Vercel one is guesswork;
 * this asks the deployed process itself, which is the only authority on what
 * its own environment resolves to.
 *
 * Guarded by the Super Admin session. The response never contains a key — only
 * the project URL and bucket name, both of which appear in every public object
 * URL this application already serves.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireSuperAdmin();

    const diagnostics = await inspectStorage();

    const ok =
      diagnostics.bucketExists === true &&
      diagnostics.bucketIsPublic === true &&
      diagnostics.serviceKeyLooksCorrect === true;

    return apiSuccess({
      ...diagnostics,
      ok,
      advice: buildAdvice(diagnostics),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/** The first thing that is wrong, in the order worth fixing it. */
function buildAdvice(
  diagnostics: Awaited<ReturnType<typeof inspectStorage>>,
): string {
  if (diagnostics.supabaseUrl === null) {
    return 'SUPABASE_URL is not set. Add it in Vercel: Supabase → Project Settings → Data API → Project URL.';
  }

  if (!diagnostics.serviceKeyPresent) {
    return 'SUPABASE_SERVICE_ROLE_KEY is not set. Add it in Vercel: Supabase → Project Settings → API keys → service_role.';
  }

  if (diagnostics.serviceKeyLooksCorrect === false) {
    return 'SUPABASE_SERVICE_ROLE_KEY does not carry the service_role claim — the anon key was probably pasted instead. Uploads will be refused by Storage policies.';
  }

  if (diagnostics.bucketExists === false) {
    return `Bucket "${diagnostics.bucket}" does not exist. Create it in Supabase → Storage → New bucket, name it exactly that, and tick Public.`;
  }

  if (diagnostics.bucketExists === null) {
    return `Could not read the bucket: ${diagnostics.error ?? 'unknown error'}. Check that SUPABASE_URL points at the same project the key belongs to.`;
  }

  if (diagnostics.bucketIsPublic === false) {
    return `Bucket "${diagnostics.bucket}" exists but is private. Logos must load on the sign-in page before anyone has authenticated, so the bucket has to be public. Change it in Supabase → Storage → bucket → Settings.`;
  }

  return 'Working. Uploads will go to Supabase Storage.';
}
