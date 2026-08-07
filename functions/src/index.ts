/**
 * Firebase Functions (2nd gen) — SCAFFOLD ONLY for Sprint 1.
 *
 * Nothing here is wired into the product yet. It exists so background work has
 * a home with the tenancy rules already established:
 *
 *   Every function must derive `location_id` from the data it is given (a
 *   database path, a Firestore document, a token claim) and must scope every
 *   query and every write to it. There is no ambient tenant in a background
 *   job, and a function that processes "all schools" must loop over schools
 *   explicitly rather than issuing an unfiltered query.
 *
 * Planned for later sprints:
 *   - nightly GHL OAuth token refresh (rows in `ghl_tokens` nearing expiry)
 *   - fee-reminder and attendance-digest fan-out to /notifications/{locationId}
 *   - cleanup of ended /live_sessions/{locationId} entries
 */

import { setGlobalOptions } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

// Keep every function in one region — cross-region calls to Supabase add
// latency, and a pooled Postgres connection pays it on every round trip.
setGlobalOptions({
  region: 'us-central1',
  maxInstances: 10,
});

/**
 * Liveness probe. Deliberately returns no tenant data — it exists to confirm
 * the codebase deploys before any real job is added.
 */
export const healthCheck = onRequest((request, response) => {
  logger.info('healthCheck invoked', { method: request.method });
  response.json({ ok: true, sprint: 1, functions: 'scaffold' });
});
