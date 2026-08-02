import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schools } from '@/db/schema';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { publicEnv, serverEnv } from '@/lib/env';
import { adminCredentialSummary, getAdminAuth } from '@/lib/firebase-admin';
import {
  buildHandoffUrl,
  derivePlatformAdminUid,
  signHandoffToken,
  verifyHandoffToken,
} from '@/lib/platform-school-access';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * GET /api/super-admin/diagnostics/platform-login[?schoolId=…]
 *
 * Walks the "Login as Admin" hand-off end to end inside the deployed process
 * and reports which step fails.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * The redemption route answers a browser with one deliberately vague message,
 * because it is unauthenticated and a caller holding a leaked link is not owed
 * a description of the server's internals. That is right for the public route
 * and useless for debugging: "Something went wrong" is `handleApiError`'s
 * catch-all, and it covers a malformed Firebase key, an unreachable database
 * and a signing-secret mismatch alike.
 *
 * So the same chain runs here instead, behind the Super Admin session, and says
 * exactly where it breaks. Every step is caught individually — one failure does
 * not hide the steps after it.
 *
 * Secrets are reported as presence and length only. A diagnostic that printed
 * the signing secret would be a worse bug than the one it is diagnosing.
 *
 * Temporary. Delete once the hand-off is confirmed working in production.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
}

/** Runs one step, turning a throw into a reported failure rather than a 500. */
async function step(
  name: string,
  run: () => Promise<string>,
): Promise<StepResult> {
  try {
    return { step: name, ok: true, detail: await run() };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const message = error instanceof Error ? error.message : String(error);

    return {
      step: name,
      ok: false,
      detail: typeof code === 'string' ? `${code}: ${message}` : message,
    };
  }
}

/** Presence and shape of a secret, never its value. */
function envReport(name: string): { set: boolean; length: number } {
  const value = process.env[name];
  return {
    set: value !== undefined && value.trim() !== '',
    length: value === undefined ? 0 : value.length,
  };
}

/**
 * What form the service-account variable is in.
 *
 * The opening bytes of every service-account file are identical — base64 of
 * one always begins `eyJ`, the raw JSON always begins `{"t` — so reporting
 * three characters distinguishes "correct", "raw JSON", "wrapped in quotes"
 * and "truncated" while disclosing nothing that varies between projects.
 */
function serviceAccountShape(): {
  set: boolean;
  length: number;
  startsWith: string;
  looksLike: string;
} {
  const value = process.env['FIREBASE_SERVICE_ACCOUNT_KEY'];

  if (value === undefined || value.trim() === '') {
    return { set: false, length: 0, startsWith: '', looksLike: 'absent' };
  }

  const trimmed = value.trim();
  const head = trimmed.slice(0, 3);

  const looksLike = trimmed.startsWith('{')
    ? 'raw JSON'
    : trimmed.startsWith('eyJ')
      ? 'base64 of JSON'
      : trimmed.startsWith('"') || trimmed.startsWith("'")
        ? 'quoted — the wrapping quotes are part of the value'
        : 'unrecognised — neither JSON nor base64 of JSON';

  return { set: true, length: trimmed.length, startsWith: head, looksLike };
}

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();

    const url = new URL(request.url);
    const requestedSchoolId = url.searchParams.get('schoolId');

    // ---- Environment ------------------------------------------------------
    // The three groups the hand-off actually depends on. A missing
    // SUPER_ADMIN_JWT_SECRET breaks signing; a malformed Firebase credential
    // breaks redemption; the domain pair decides which URL shape is built.
    const environment = {
      superAdminJwtSecret: envReport('SUPER_ADMIN_JWT_SECRET'),
      superAdminEmail: envReport('SUPER_ADMIN_EMAIL'),
      superAdminPasswordHash: envReport('SUPER_ADMIN_PASSWORD_HASH'),
      firebaseServiceAccountKey: serviceAccountShape(),
      firebaseAdminProjectId: envReport('FIREBASE_ADMIN_PROJECT_ID'),
      firebaseAdminClientEmail: envReport('FIREBASE_ADMIN_CLIENT_EMAIL'),
      firebaseAdminPrivateKey: envReport('FIREBASE_ADMIN_PRIVATE_KEY'),
      platformBaseDomain: serverEnv('PLATFORM_BASE_DOMAIN', ''),
      publicAppDomain: publicEnv.appDomain,
      nodeEnv: process.env.NODE_ENV ?? null,
    };

    // ---- School -----------------------------------------------------------
    const schoolRows =
      requestedSchoolId === null || requestedSchoolId === ''
        ? await db
            .select({
              id: schools.id,
              slug: schools.slug,
              locationId: schools.locationId,
              isActive: schools.isActive,
            })
            .from(schools)
            .limit(1)
        : await db
            .select({
              id: schools.id,
              slug: schools.slug,
              locationId: schools.locationId,
              isActive: schools.isActive,
            })
            .from(schools)
            .where(eq(schools.id, requestedSchoolId))
            .limit(1);

    const school = schoolRows[0];

    if (school === undefined) {
      return apiSuccess({
        environment,
        school: null,
        steps: [
          {
            step: 'school-lookup',
            ok: false,
            detail:
              requestedSchoolId === null
                ? 'No schools exist in this database.'
                : `No school with id ${requestedSchoolId}.`,
          },
        ],
        verdict: 'No school to test against.',
      });
    }

    const host = request.headers.get('host') ?? '';
    const protocol = url.protocol;
    const steps: StepResult[] = [];

    // ---- 1. Signing -------------------------------------------------------
    let token = '';
    steps.push(
      await step('sign-handoff-token', async () => {
        token = await signHandoffToken({
          locationId: school.locationId,
          email: 'diagnostic@platform.local',
        });
        return `signed, ${token.length} characters`;
      }),
    );

    // ---- 2. Verifying ------------------------------------------------------
    // Signing and verifying read the same secret from the same process, so a
    // failure here means the secret is absent rather than mismatched — but it
    // is worth proving rather than assuming.
    steps.push(
      await step('verify-handoff-token', async () => {
        if (token === '') throw new Error('Skipped: signing failed.');

        const claims = await verifyHandoffToken(token);
        if (claims === null) {
          throw new Error(
            'Verification returned null — the secret is missing, or the token was rejected.',
          );
        }
        if (claims.locationId !== school.locationId) {
          throw new Error('Round-tripped token carries the wrong locationId.');
        }
        return `round-trip ok for location ${claims.locationId}`;
      }),
    );

    // ---- 3. The URL the panel would send the browser to --------------------
    steps.push(
      await step('build-handoff-url', async () => {
        const built = buildHandoffUrl(
          token === '' ? 'TOKEN' : token,
          school.slug,
          host,
          protocol,
        );
        // Only the shape matters here, not the token itself.
        const shape = built.startsWith('/') ? 'same-origin + ?school=' : 'absolute subdomain';
        return `${shape} — ${built.replace(token, '<token>')}`;
      }),
    );

    // ---- 4. Firebase ------------------------------------------------------
    // Split deliberately: initialisation, lookup, claims and minting fail for
    // different reasons, and collapsing them is what produced the unhelpful
    // "Something went wrong" in the first place.
    const uid = derivePlatformAdminUid(school.locationId);

    steps.push(
      await step('firebase-admin-init', async () => {
        const auth = getAdminAuth();
        // Naming the project is what separates "Authentication was never
        // enabled" from "enabled, but on a different project than this key" —
        // the two causes of auth/configuration-not-found.
        const { projectId, clientEmail } = adminCredentialSummary();
        return `initialised app ${auth.app.name} for project "${projectId}" (${clientEmail})`;
      }),
    );

    steps.push(
      await step('firebase-get-or-create-user', async () => {
        const auth = getAdminAuth();
        try {
          const existing = await auth.getUser(uid);
          return `existing account ${existing.uid}`;
        } catch (error) {
          if ((error as { code?: unknown }).code !== 'auth/user-not-found') throw error;
          const created = await auth.createUser({
            uid,
            displayName: 'Platform Super Admin',
          });
          return `created account ${created.uid}`;
        }
      }),
    );

    steps.push(
      await step('firebase-set-custom-claims', async () => {
        await getAdminAuth().setCustomUserClaims(uid, {
          locationId: school.locationId,
          role: 'school_admin',
          branchId: null,
          schoolSlug: school.slug,
          platformAdmin: true,
          platformAdminEmail: 'diagnostic@platform.local',
        });
        return 'claims written';
      }),
    );

    steps.push(
      await step('firebase-create-custom-token', async () => {
        const minted = await getAdminAuth().createCustomToken(uid);
        return `minted, ${minted.length} characters`;
      }),
    );

    const failed = steps.filter((entry) => !entry.ok);

    return apiSuccess({
      environment,
      school: {
        id: school.id,
        slug: school.slug,
        locationId: school.locationId,
        isActive: school.isActive,
      },
      request: { host, protocol },
      platformAdminUid: uid,
      steps,
      verdict:
        failed.length === 0
          ? 'Every step passed. The hand-off chain works in this environment.'
          : `Failing step(s): ${failed.map((entry) => entry.step).join(', ')}`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
