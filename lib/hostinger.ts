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

/**
 * TTL for a tenant's DNS record.
 *
 * Five minutes, deliberately short. These records are created by software while
 * somebody waits, and a school whose record was written wrong should be
 * correctable in minutes rather than the four hours a default TTL would impose.
 * There is no traffic argument against it: the name is resolved once per client
 * per TTL and the answer is a CNAME to a host that is being looked up anyway.
 */
export const DNS_TTL_SECONDS = 300;

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
  /** The DNS zone the record is written into, e.g. `codexmill.com`. */
  dnsZone: string;
  /**
   * What the DNS record points at.
   *
   * `null` means "CNAME to `websiteDomain`", which is the default and the
   * robust answer — see `ensureDnsRecord`. A non-empty `HOSTINGER_DNS_TARGET_IP`
   * forces an A record instead, for a host that refuses CNAMEs on aliases.
   */
  targetIp: string | null;
}

/**
 * The registrable domain of a hostname — the zone its records live in.
 *
 * `schoolhub.codexmill.com` → `codexmill.com`.
 *
 * ── This is the last-two-labels heuristic, and it is wrong for `.co.uk` ──
 * Getting it right in general needs a public-suffix list, and pulling one in
 * would breach the pinned dependency list (`SPRINTS.md` §0.1) for a platform
 * that serves one domain today. So the heuristic is the default and
 * `HOSTINGER_DNS_ZONE` overrides it: a deployment on `school.co.uk` sets that
 * variable and is correct, rather than silently writing records into a zone
 * that does not exist.
 */
export function registrableDomain(host: string): string {
  const labels = host.trim().toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  return labels.length <= 2 ? labels.join('.') : labels.slice(-2).join('.');
}

/**
 * The record name relative to its zone.
 *
 * `abc-demo.schoolhub.codexmill.com` inside `codexmill.com` →
 * `abc-demo.schoolhub`. Null when the host is not inside the zone at all, which
 * is a misconfiguration to report rather than paper over.
 */
export function recordNameWithinZone(fqdn: string, zone: string): string | null {
  const host = fqdn.trim().toLowerCase().replace(/\.$/, '');
  const suffix = `.${zone.trim().toLowerCase()}`;
  if (!host.endsWith(suffix)) return null;

  const name = host.slice(0, host.length - suffix.length);
  return name === '' ? null : name;
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

  const dnsZone =
    serverEnv('HOSTINGER_DNS_ZONE', '').trim().toLowerCase() ||
    registrableDomain(baseDomain);

  const targetIp = serverEnv('HOSTINGER_DNS_TARGET_IP', '').trim();

  return {
    token,
    username,
    websiteDomain,
    baseDomain,
    dnsZone,
    targetIp: targetIp === '' ? null : targetIp,
  };
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

/* -----------------------------------------------------------------------------
 * DNS.
 *
 * ── Why this exists, and why the sprint that added parking was incomplete ──
 * A parked domain is a **vhost alias**: it tells the web server "serve this
 * hostname from this site". It creates no DNS whatsoever. Hostinger's own panel
 * says as much by listing such a domain as **"Not connected"** — that label
 * means "this name's DNS does not point at us", not "something failed".
 *
 * So parking alone produces exactly what was observed on 2026-08-16: the alias
 * appears in the panel, the panel says Not connected, and the browser returns
 * `DNS_PROBE_FINISHED_NXDOMAIN` because the name does not exist in the zone.
 * `credo` looked like a counter-example only because its record had been
 * created by hand.
 *
 * Two APIs, two resources, both required. This half was missing.
 * -------------------------------------------------------------------------- */

function dnsZoneUrl(config: HostingerConfig): string {
  return `${API_BASE}/api/dns/v1/zones/${encodeURIComponent(config.dnsZone)}`;
}

/** What the record for a tenant hostname should be. */
interface DesiredRecord {
  /** Relative to the zone, e.g. `abc-demo.schoolhub`. */
  name: string;
  type: 'A' | 'CNAME';
  content: string;
}

/**
 * A CNAME to the parent website by default, an A record only if forced.
 *
 * ── Why CNAME rather than a fixed address ────────────────────────────────
 * The account's addresses move. Measured on this deployment within a single
 * session, `schoolhub.codexmill.com` answered `145.79.29.64`/`145.79.24.147`,
 * then `145.79.24.95`/`145.79.29.210`, while public resolvers returned
 * `2.57.91.141`/`88.222.222.246` — and the one hand-made record pointed at
 * `195.35.33.221`. Any A record this code wrote would be a snapshot of a
 * rotating set, correct on the day and silently wrong later, and the failure
 * would surface as one school being unreachable long after anybody would still
 * connect it with provisioning.
 *
 * A CNAME to the parent delegates that entirely: whatever the platform host
 * resolves to, the tenant resolves to as well, forever, with no maintenance.
 * It also matches what the alias already means at the HTTP layer.
 *
 * `HOSTINGER_DNS_TARGET_IP` exists for the host that refuses CNAMEs on an
 * alias. It is an escape hatch, not the recommended path, and `.env.example`
 * says so.
 */
function desiredRecordFor(config: HostingerConfig, fqdn: string): DesiredRecord | null {
  const name = recordNameWithinZone(fqdn, config.dnsZone);
  if (name === null) return null;

  if (config.targetIp !== null) {
    return { name, type: 'A', content: config.targetIp };
  }

  // Fully qualified, with the trailing dot: a relative CNAME target would be
  // resolved against the zone and point at `<website>.<zone>`, which does not
  // exist. This is the classic way to break a CNAME and it fails silently.
  return { name, type: 'CNAME', content: `${config.websiteDomain}.` };
}

export type DnsOutcome = 'created' | 'already-present' | 'failed' | 'skipped';

export interface DnsResult {
  outcome: DnsOutcome;
  message: string;
}

/**
 * Ensures the tenant's DNS record exists. Never edits or deletes an existing one.
 *
 * ── `overwrite: false`, and this is not a detail ─────────────────────────
 * Hostinger's `PUT /api/dns/v1/zones/{domain}` takes an `overwrite` flag whose
 * documented meaning is that matching records are "deleted and new RRs created".
 * How wide "matching" reaches is not stated precisely, and the blast radius if
 * it means the whole zone is every record on `codexmill.com` — the apex, mail,
 * every other school. That is not a risk worth taking to save one GET, so:
 *
 *   1. The zone is read first. If a record already exists for this name, the
 *      function reports it and **writes nothing at all**, whatever its content.
 *      A wrong record is left for a human, exactly as the parked-domain half
 *      never deletes an alias.
 *   2. Only a genuinely absent name is written, and with `overwrite: false`,
 *      which appends. Appending a name that does not exist cannot disturb one
 *      that does.
 *
 * If a future change makes this `true` to "clean up stale records", the thing
 * to establish first is whether it scopes to the submitted names — against a
 * throwaway zone, not this one.
 */
export async function ensureDnsRecord(
  config: HostingerConfig,
  fqdn: string,
): Promise<DnsResult> {
  const desired = desiredRecordFor(config, fqdn);

  if (desired === null) {
    return {
      outcome: 'failed',
      message:
        `${fqdn} is not inside the DNS zone ${config.dnsZone}, so no record can be ` +
        'written. Set HOSTINGER_DNS_ZONE to the zone that actually holds it.',
    };
  }

  const url = dnsZoneUrl(config);

  // -- 1. Does the name already exist? --------------------------------------
  try {
    const existing = await request(url, { method: 'GET' }, config.token);

    if (existing.ok && zoneAlreadyHasName(existing.body, desired.name)) {
      return {
        outcome: 'already-present',
        message: `A DNS record for ${desired.name}.${config.dnsZone} already exists; it was left untouched.`,
      };
    }

    if (!existing.ok) {
      return {
        outcome: 'failed',
        message:
          `Could not read the DNS zone ${config.dnsZone} (HTTP ${String(existing.status)}). ` +
          `${summarise(existing.body)} The API token needs DNS scope as well as hosting scope.`,
      };
    }
  } catch (error) {
    return { outcome: 'failed', message: describeNetworkError(error) };
  }

  // -- 2. Write it ----------------------------------------------------------
  try {
    const written = await request(
      url,
      {
        method: 'PUT',
        body: JSON.stringify({
          overwrite: false,
          zone: [
            {
              name: desired.name,
              type: desired.type,
              ttl: DNS_TTL_SECONDS,
              records: [{ content: desired.content }],
            },
          ],
        }),
      },
      config.token,
    );

    if (written.ok) {
      return {
        outcome: 'created',
        message: `DNS ${desired.type} ${desired.name}.${config.dnsZone} → ${desired.content} created.`,
      };
    }

    return {
      outcome: 'failed',
      message:
        `Hostinger refused the DNS record (HTTP ${String(written.status)}). ${summarise(written.body)}`,
    };
  } catch (error) {
    return { outcome: 'failed', message: describeNetworkError(error) };
  }
}

/**
 * Whether the zone response already carries a record for this name.
 *
 * Hostinger returns records with the name relative to the zone, but a response
 * shape can change and a fully-qualified name is the other plausible form. Both
 * are accepted, matched on a word boundary so `abc` does not match `abc-demo`.
 */
function zoneAlreadyHasName(body: string, name: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!Array.isArray(parsed)) return false;

    return parsed.some((entry) => {
      if (typeof entry !== 'object' || entry === null) return false;
      const recordName = (entry as { name?: unknown }).name;
      if (typeof recordName !== 'string') return false;

      const normalised = recordName.trim().toLowerCase().replace(/\.$/, '');
      return normalised === name || normalised.startsWith(`${name}.`);
    });
  } catch {
    // Unparseable means "cannot prove it exists". Falling through to the write
    // is safe: it appends, and a duplicate name is recoverable where a wrongly
    // skipped record leaves a school permanently unreachable.
    return false;
  }
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

  const parked = await ensureParkedDomain(config, fqdn);

  // A failed alias is the end of it. Writing DNS for a hostname the web server
  // will not answer for would produce a name that resolves to a stranger's
  // site, which is worse than a name that does not resolve.
  if (parked.status === 'failed') return parked;

  const dns = await ensureDnsRecord(config, fqdn);

  if (dns.outcome === 'failed') {
    return {
      status: 'failed',
      // The alias half succeeded and the DNS half did not, which is precisely
      // the state that looks fine in the hosting panel and returns NXDOMAIN in
      // a browser. Saying both halves is what stops that being diagnosed twice.
      message:
        `${fqdn} is parked, but its DNS record could not be created, so the name ` +
        `will not resolve. ${dns.message}`,
      fqdn,
      alreadyExisted: parked.alreadyExisted,
    };
  }

  return {
    status: 'provisioning',
    message: `${parked.message} ${dns.message} HTTPS is usually ready within a few minutes.`,
    fqdn,
    alreadyExisted: parked.alreadyExisted && dns.outcome === 'already-present',
  };
}

/**
 * The alias half: `<slug>.<base>` served from the platform website.
 *
 * Split out of `provisionSchoolSubdomain` when the DNS half was added, so that
 * each half has one place that decides its own outcome and the caller composes
 * them. See the DNS section above for why one without the other is exactly the
 * failure that was shipped.
 */
async function ensureParkedDomain(
  config: HostingerConfig,
  fqdn: string,
): Promise<ProvisionResult> {
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
        message: `${fqdn} parked on ${config.websiteDomain}.`,
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
