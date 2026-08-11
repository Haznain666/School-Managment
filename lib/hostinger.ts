import 'server-only';

import { serverEnv } from './env';

/**
 * Provisioning of `<slug>.<PLATFORM_BASE_DOMAIN>` at Hostinger.
 *
 * ── Why a parked domain and not a subdomain ──────────────────────────────
 * Hostinger's two features sound interchangeable and are not. Measured on
 * 2026-08-11 against this account:
 *
 *   - "Create subdomain" builds a **separate LiteSpeed/PHP vhost** with its own
 *     document root (`public_html/<slug>`). Requests to it are served by PHP
 *     and never reach the Node process. A school provisioned that way resolves,
 *     gets its own certificate, and still cannot serve the tenant — which is
 *     the most misleading possible failure, because everything looks correct.
 *   - "Parked domain" creates an **alias of the parent website**. Its root
 *     directory *is* the parent's, so the request reaches the same Node process
 *     with the original `Host` header intact, which is exactly what
 *     `subdomainFromHost` in `lib/school-context.ts` needs.
 *
 * Verified end to end: `credo.schoolhub.codexmill.com` parked against
 * `schoolhub.codexmill.com` answered `/login` with the tenant's sign-in page
 * (`X-Powered-By: Next.js`), while the platform host answered the same path
 * with "School not found". HTTPS was issued automatically about three minutes
 * after creation.
 *
 * **So: never call the subdomain endpoint here.** It is the wrong primitive and
 * it fails silently.
 *
 * ── Why every function returns instead of throwing ───────────────────────
 * Creating a school must not depend on a third-party API. These are called
 * after the row is committed and their outcome is recorded on it, so a caller
 * needs a value it can store, not an exception it must remember to catch.
 */

/** Hostinger's public API. Overridable only to point tests at a stub. */
const API_BASE = 'https://developers.hostinger.com';

/** Requests are bounded: a hanging host must not hold a school-creation request open. */
const REQUEST_TIMEOUT_MS = 15_000;

/** How long a freshly parked domain typically takes to answer over HTTPS. */
export const TLS_ISSUANCE_HINT_MS = 3 * 60 * 1000;

export type ProvisionStatus = 'provisioning' | 'ready' | 'failed' | 'unmanaged';

export interface ProvisionResult {
  status: ProvisionStatus;
  /** Operator-facing. Never contains the token or any header. */
  message: string;
  /** The name that was provisioned, for logging and for the UI. */
  fqdn: string;
  /** True when the parked domain already existed — a retry, not a first create. */
  alreadyExisted: boolean;
}

interface HostingerConfig {
  token: string;
  username: string;
  /** The parent website the alias attaches to. */
  websiteDomain: string;
  /** The suffix tenant hostnames are built from. */
  baseDomain: string;
}

/**
 * Reads configuration, or `null` when this deployment does not manage DNS.
 *
 * A missing token is a legitimate, supported state — self-hosted or
 * manually-managed deployments — so it is not an error and must never be
 * reported as one. See `unmanaged` in migration 0021.
 */
function readConfig(): HostingerConfig | null {
  const token = serverEnv('HOSTINGER_API_TOKEN', '').trim();
  const username = serverEnv('HOSTINGER_USERNAME', '').trim();
  if (token === '' || username === '') return null;

  const baseDomain = serverEnv(
    'PLATFORM_BASE_DOMAIN',
    serverEnv('NEXT_PUBLIC_APP_DOMAIN', ''),
  )
    .trim()
    .toLowerCase();
  if (baseDomain === '') return null;

  // The website the alias hangs off. Almost always the base domain itself;
  // separable because a deployment could serve tenants from a domain other
  // than the one the hosting account calls the "website".
  const websiteDomain = serverEnv('HOSTINGER_WEBSITE_DOMAIN', baseDomain)
    .trim()
    .toLowerCase();

  return { token, username, websiteDomain, baseDomain };
}

export function isHostingerConfigured(): boolean {
  return readConfig() !== null;
}

/** The hostname a school is reached at, or `null` when no base domain is set. */
export function subdomainFor(slug: string): string | null {
  const base = serverEnv('PLATFORM_BASE_DOMAIN', serverEnv('NEXT_PUBLIC_APP_DOMAIN', ''))
    .trim()
    .toLowerCase();
  const clean = slug.trim().toLowerCase();
  if (base === '' || clean === '') return null;
  return `${clean}.${base}`;
}

function parkedDomainsUrl(config: HostingerConfig): string {
  return (
    `${API_BASE}/api/hosting/v1/accounts/${encodeURIComponent(config.username)}` +
    `/websites/${encodeURIComponent(config.websiteDomain)}/parked-domains`
  );
}

/**
 * One request, with a timeout and no secret in anything it can throw.
 *
 * `fetch` failures embed the request URL, which is harmless here, but an error
 * built from a response body is not necessarily — so the body is read and
 * truncated deliberately rather than interpolated whole.
 */
async function request(
  url: string,
  init: RequestInit,
  token: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const body = (await response.text()).slice(0, 500);
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** True when the API is telling us the alias is already there. */
function reportsAlreadyExists(status: number, body: string): boolean {
  if (status !== 409 && status !== 422 && status !== 400) return false;
  const text = body.toLowerCase();
  return (
    text.includes('already') ||
    text.includes('exists') ||
    text.includes('taken') ||
    text.includes('duplicate')
  );
}

/**
 * Creates the parked domain for a school, or confirms it is already there.
 *
 * ── Idempotency ──────────────────────────────────────────────────────────
 * Three independent layers, because this is called both automatically and from
 * a retry button and must be safe to run any number of times:
 *
 *   1. The existing aliases are listed first, and a match short-circuits.
 *   2. An "already exists" rejection from the create call is treated as
 *      success, which closes the race between two concurrent retries.
 *   3. Nothing is ever deleted here. The only destructive operation Hostinger
 *      offers on this resource is deliberately not wrapped in this module.
 */
export async function provisionSchoolSubdomain(slug: string): Promise<ProvisionResult> {
  const config = readConfig();
  const fqdn = subdomainFor(slug) ?? slug;

  if (config === null) {
    return {
      status: 'unmanaged',
      message:
        'No hosting API token is configured, so subdomains are created manually. ' +
        'Set HOSTINGER_API_TOKEN and HOSTINGER_USERNAME to automate this.',
      fqdn,
      alreadyExisted: false,
    };
  }

  const url = parkedDomainsUrl(config);

  // -- 1. Already provisioned? ----------------------------------------------
  try {
    const existing = await request(url, { method: 'GET' }, config.token);
    if (existing.ok && existing.body.toLowerCase().includes(fqdn.toLowerCase())) {
      return {
        status: 'provisioning',
        message: `${fqdn} is already parked on ${config.websiteDomain}.`,
        fqdn,
        alreadyExisted: true,
      };
    }
  } catch {
    // A failed *check* is not a failed provision. Fall through and let the
    // create call be the thing that decides, since it is authoritative and
    // handles the duplicate case on its own.
  }

  // -- 2. Create ------------------------------------------------------------
  try {
    const created = await request(
      url,
      { method: 'POST', body: JSON.stringify({ parked_domain: fqdn }) },
      config.token,
    );

    if (created.ok) {
      return {
        status: 'provisioning',
        message: `${fqdn} parked on ${config.websiteDomain}. HTTPS is usually ready within a few minutes.`,
        fqdn,
        alreadyExisted: false,
      };
    }

    if (reportsAlreadyExists(created.status, created.body)) {
      return {
        status: 'provisioning',
        message: `${fqdn} was already parked.`,
        fqdn,
        alreadyExisted: true,
      };
    }

    return {
      status: 'failed',
      message: `Hostinger refused the request (HTTP ${String(created.status)}). ${summarise(created.body)}`,
      fqdn,
      alreadyExisted: false,
    };
  } catch (error) {
    return {
      status: 'failed',
      message: describeNetworkError(error),
      fqdn,
      alreadyExisted: false,
    };
  }
}

/**
 * Is the hostname actually serving yet?
 *
 * Existence of the alias is not reachability: DNS has to propagate and a
 * certificate has to be issued, which took about three minutes when this was
 * measured. Only a real HTTPS request can move a school to `ready`, so this is
 * what the retry control calls after ensuring the alias exists.
 */
export async function checkSubdomainReachable(fqdn: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`https://${fqdn}/login`, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      cache: 'no-store',
    });
    // Any HTTP answer proves DNS resolved and TLS completed, which is the whole
    // question. Which page it is depends on the tenant and is not this
    // function's business.
    return response.status > 0;
  } catch {
    // DNS not yet propagated, or no certificate yet. Both are "not ready".
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** A response body, trimmed to something safe to show an operator. */
function summarise(body: string): string {
  const trimmed = body.trim();
  if (trimmed === '') return 'No details were returned.';
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

function describeNetworkError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return `Hostinger did not respond within ${String(REQUEST_TIMEOUT_MS / 1000)}s. The subdomain may still have been created — retry to check.`;
  }
  return `Could not reach the Hostinger API: ${error instanceof Error ? error.message : String(error)}`;
}
