import 'server-only';

import { resolve4, resolveCname } from 'node:dns/promises';

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

/**
 * Retries, and the ceiling on what they may cost.
 *
 * ── Why this is bounded so tightly ───────────────────────────────────────
 * These calls happen *inside* a super-admin's "Create school" request, which
 * already waits on a database insert, an administrator invitation and an email
 * queue. Retrying is worth doing because a 429 succeeds seconds later; it is
 * not worth making an operator watch a spinner for half a minute to find out.
 *
 * So: at most two extra attempts, and at most five seconds of added waiting in
 * total across a whole provision. A `Retry-After` longer than what is left of
 * that budget is not slept through — the attempt is abandoned and the school is
 * marked `throttled`, which the operator can retry with one click when the row
 * is in front of them rather than while they are held on a form.
 */
const MAX_RETRIES = 2;
const RETRY_BUDGET_MS = 5_000;
/** Doubling, and only consulted when the host did not say `Retry-After`. */
const RETRY_BASE_DELAY_MS = 500;

/**
 * `throttled` is a fourth outcome and not a kind of `failed`.
 *
 * ── What it cost to conflate them ────────────────────────────────────────
 * The one school on the live deployment sat at `failed` with
 * `Hostinger refused the request (HTTP 429). {"message":"Too Many Attempts."…}`
 * recorded against it. Nothing about that request was wrong. The account had
 * simply made too many calls in the window — four per provision, two of which
 * were avoidable — and the *same* request would have succeeded a few seconds
 * later.
 *
 * "Refused" is therefore the wrong word in the wrong colour: an operator
 * reading a red Failed badge goes looking for a misconfiguration that does not
 * exist. `throttled` is a warning, says the host is rate-limiting, and says it
 * will be retried.
 */
export type ProvisionStatus =
  | 'provisioning'
  | 'ready'
  | 'failed'
  | 'throttled'
  | 'unmanaged';

/**
 * Statuses that mean nothing was provisioned and the message is worth keeping.
 *
 * Both routes that write `subdomain_status` ask this rather than each spelling
 * out the list, because a status added to one and not the other is a school
 * whose recorded error silently disappears.
 */
export function isProvisionSetback(status: ProvisionStatus): boolean {
  return status === 'failed' || status === 'throttled';
}

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

  // Empty means "work it out" — see `resolveDnsZone`. An explicit value skips
  // the probing entirely and is the escape hatch for an unusual topology.
  const dnsZone = serverEnv('HOSTINGER_DNS_ZONE', '').trim().toLowerCase();

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

function dnsZoneUrl(zone: string): string {
  return `${API_BASE}/api/dns/v1/zones/${encodeURIComponent(zone)}`;
}

/**
 * Which zone a tenant's record belongs in — and the answer that cost a
 * deployment.
 *
 * ── What went wrong, measured 2026-08-16 ─────────────────────────────────
 * The first version computed the zone as the *registrable domain*:
 * `schoolhub.codexmill.com` → `codexmill.com`, writing the name
 * `abc-demo.schoolhub`. Hostinger rejected it:
 *
 *     HTTP 422 [DNS:4008] DNS resource record is not valid or conflicts
 *                         with another resource record
 *
 * The reason is a DNS rule rather than anything Hostinger-specific.
 * `schoolhub.codexmill.com` is **its own zone**: it has its own SOA
 * (`pixel.dns-parking.com`, `dns.hostinger.com`) and its own NS records,
 * delegated out of `codexmill.com`. Records below a delegation point may not
 * live in the parent zone — a resolver follows the delegation and never looks
 * at them.
 *
 * That one fact explains every symptom seen, including the ones that predate
 * this code: the wildcard `*.schoolhub` the operator added to the **parent**
 * zone was accepted by the panel and is invisible to every resolver, which is
 * why `random-probe.schoolhub.codexmill.com` returned NXDOMAIN while the record
 * sat there looking correct. And `credo` worked because its record was made in
 * the right zone.
 *
 * ── The rule that is correct in both topologies ──────────────────────────
 * Try the base domain as a zone first, and fall back to its registrable domain:
 *
 *   base `schoolhub.codexmill.com` is a zone → zone it, name `abc-demo`
 *   base `platform.com` is a zone           → zone it, name `abc-demo`
 *   base `app.example.com`, only `example.com` is a zone
 *                                           → fall back, name `abc-demo.app`
 *
 * The first two are the same rule, which is the point: when the platform's own
 * domain is a managed zone — the normal case, and the case here — the record
 * name is simply the slug and no suffix arithmetic happens at all. The fallback
 * exists for a platform hosted on a subdomain of a zone it does not own.
 *
 * Probed rather than assumed, because only the API knows which zones exist.
 * Not memoised: it is two cheap GETs on an operation that already creates a
 * domain, and a cached wrong answer here is a school that never resolves.
 */
interface ResolvedZone {
  zone: string | null;
  message: string;
  /**
   * The probe's response body, when the zone was found by probing it.
   *
   * The probe *is* a read of the zone, and the very next thing `ensureDnsRecord`
   * used to do was read the same zone again to look for the record name. Two
   * identical GETs, milliseconds apart, against an account with a rate limiter.
   * Handing the body back turns four calls per provision into three.
   */
  body: string | null;
  /** The zone could not be read because the host is rate-limiting, not because it is wrong. */
  throttled: boolean;
}

async function resolveDnsZone(config: HostingerConfig): Promise<ResolvedZone> {
  if (config.dnsZone !== '') {
    return {
      zone: config.dnsZone,
      message: `zone ${config.dnsZone} (from HOSTINGER_DNS_ZONE)`,
      body: null,
      throttled: false,
    };
  }

  const candidates = [config.baseDomain, registrableDomain(config.baseDomain)].filter(
    (value, index, all) => value !== '' && all.indexOf(value) === index,
  );

  const rejections: string[] = [];
  let throttled = false;

  for (const candidate of candidates) {
    try {
      const probe = await request(dnsZoneUrl(candidate), { method: 'GET' }, config.token);
      if (probe.ok) {
        return {
          zone: candidate,
          message: `zone ${candidate}`,
          body: probe.body,
          throttled: false,
        };
      }
      if (probe.status === 429) throttled = true;
      rejections.push(`${candidate} → HTTP ${String(probe.status)}`);
    } catch (error) {
      rejections.push(`${candidate} → ${describeNetworkError(error)}`);
    }
  }

  return {
    zone: null,
    body: null,
    throttled,
    message: throttled
      ? 'Hostinger is rate-limiting this account, so its DNS zones could not be ' +
        'read (HTTP 429). Nothing is wrong with the configuration — try again in ' +
        'a minute.'
      : `None of the candidate DNS zones could be read (${rejections.join('; ')}). ` +
        'Set HOSTINGER_DNS_ZONE to the zone that holds tenant records, and check ' +
        'that the API token carries DNS scope as well as hosting scope.',
  };
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
function desiredRecordFor(
  config: HostingerConfig,
  zone: string,
  fqdn: string,
): DesiredRecord | null {
  const name = recordNameWithinZone(fqdn, zone);
  if (name === null) return null;

  if (config.targetIp !== null) {
    return { name, type: 'A', content: config.targetIp };
  }

  // Fully qualified, with the trailing dot: a relative CNAME target would be
  // resolved against the zone and point at `<website>.<zone>`, which does not
  // exist. This is the classic way to break a CNAME and it fails silently.
  return { name, type: 'CNAME', content: `${config.websiteDomain}.` };
}

export type DnsOutcome =
  | 'created'
  | 'already-present'
  | 'failed'
  /** The host is rate-limiting. Nothing is wrong and nothing was written. */
  | 'throttled'
  | 'skipped';

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
  /*
   * Ask DNS before asking the API.
   *
   * The API's opinion of whether a record exists arrives as a JSON shape this
   * code has to parse, and getting that parse wrong is not hypothetical: it
   * happened. `abc-demo` had been created correctly, the existence check did
   * not recognise it in the zone response, the write went ahead, and Hostinger
   * refused the duplicate with a 422 that the UI reported as **Failed** — for a
   * subdomain that was working.
   *
   * A resolver cannot be wrong about this in the same way. The question is
   * literally "does this name resolve", which is the outcome being provisioned
   * in the first place, so the authority on it is DNS and not an API response
   * body. Cheap, needs no token, and short-circuits every retry after the first
   * success.
   *
   * ── Unless a wildcard is answering ─────────────────────────────────────
   * Then "it resolves" stops meaning "it is provisioned", every new school
   * looks done, no record is ever written, and hPanel reports the name as
   * **"Not connected"** with no certificate — which is the fault this check
   * caused and `nameHasOwnRecord` now excludes. See its docblock.
   */
  if (await nameHasOwnRecord(fqdn, config.baseDomain)) {
    return {
      outcome: 'already-present',
      message: `${fqdn} already resolves on a record of its own, so its DNS is in place.`,
    };
  }

  const resolved = await resolveDnsZone(config);

  if (resolved.zone === null) {
    return {
      outcome: resolved.throttled ? 'throttled' : 'failed',
      message: resolved.message,
    };
  }

  const zone = resolved.zone;
  const desired = desiredRecordFor(config, zone, fqdn);

  if (desired === null) {
    return {
      outcome: 'failed',
      message:
        `${fqdn} is not inside the DNS zone ${zone}, so no record can be written. ` +
        'Set HOSTINGER_DNS_ZONE to the zone that actually holds it.',
    };
  }

  const url = dnsZoneUrl(zone);

  // -- 1. Does the name already exist? --------------------------------------
  //
  // The zone probe above already read this zone, so its body is reused when it
  // has one. Only an explicit HOSTINGER_DNS_ZONE — which skips the probe — still
  // pays for a read here.
  try {
    let zoneBody = resolved.body;

    if (zoneBody === null) {
      const existing = await request(url, { method: 'GET' }, config.token);

      if (!existing.ok) {
        return {
          outcome: existing.status === 429 ? 'throttled' : 'failed',
          message:
            existing.status === 429
              ? throttleMessage(existing, `reading the DNS zone ${zone}`)
              : `Could not read the DNS zone ${zone} (HTTP ${String(existing.status)}). ` +
                `${summariseResponseBody(existing.body)} The API token needs DNS scope as well as hosting scope.`,
        };
      }

      zoneBody = existing.body;
    }

    if (zoneAlreadyHasName(zoneBody, desired.name)) {
      return {
        outcome: 'already-present',
        message: `A DNS record for ${desired.name}.${zone} already exists; it was left untouched.`,
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
        message: `DNS ${desired.type} ${desired.name}.${zone} → ${desired.content} created in ${resolved.message}.`,
      };
    }

    // A rate limit is not a rejection of the record. Said before the resolver
    // is consulted, because the resolver cannot tell us anything about a
    // request the host never looked at.
    if (written.status === 429) {
      return {
        outcome: 'throttled',
        message: throttleMessage(written, `writing the DNS record for ${fqdn}`),
      };
    }

    /*
     * A refusal is not proof of failure. "Conflicts with another resource
     * record" is exactly what a *successful earlier run* looks like on a
     * retry, so DNS gets the casting vote before this is called a failure.
     */
    if (await nameHasOwnRecord(fqdn, config.baseDomain)) {
      return {
        outcome: 'already-present',
        message:
          `${fqdn} already resolves on a record of its own. Hostinger declined to ` +
          'write it again (it is already there), which is not a problem.',
      };
    }

    return {
      outcome: 'failed',
      message:
        `Hostinger refused the DNS record for "${desired.name}" in zone ${zone} ` +
        `(HTTP ${String(written.status)}). ${summariseResponseBody(written.body)}` +
        explainDnsRejection(written.body, zone, desired),
    };
  } catch (error) {
    return { outcome: 'failed', message: describeNetworkError(error) };
  }
}

/**
 * Does this name resolve at all, by A record or CNAME?
 *
 * Built-in `node:dns` — no dependency, and it asks the same question a browser
 * asks. Either record type counts: the platform writes CNAMEs by default and A
 * records when `HOSTINGER_DNS_TARGET_IP` forces them, and both mean the name
 * exists.
 */
async function nameResolves(fqdn: string): Promise<boolean> {
  try {
    const cnames = await resolveCname(fqdn);
    if (cnames.length > 0) return true;
  } catch {
    // No CNAME. An A record is still possible.
  }

  try {
    const addresses = await resolve4(fqdn);
    return addresses.length > 0;
  } catch {
    return false;
  }
}

/**
 * Does this zone answer *every* label, whether a record exists or not?
 *
 * ── The regression this exists to close ──────────────────────────────────
 * `ensureDnsRecord` asks DNS whether a tenant's record exists, and treats "it
 * resolves" as "it is provisioned". That was a deliberate improvement — see the
 * docblock there — and it is correct in a zone with no wildcard.
 *
 * Add a wildcard (`*.schoolhub.codexmill.com`) and it silently inverts. A
 * wildcard answers every name by definition, so `nameResolves` returns true for
 * a school that was created thirty seconds ago and has no record of its own.
 * `ensureDnsRecord` concludes the DNS half is already done, writes nothing, and
 * reports success. What the operator then sees is precisely what was reported
 * here:
 *
 *   - the parked domain appears in hPanel,
 *   - hPanel reads **"Not connected"**, because it looks for a record for that
 *     exact name and there is none,
 *   - and no per-hostname certificate is issued, because Hostinger issues those
 *     per parked domain against a name it can see pointed at itself.
 *
 * The wildcard makes the name *reachable* while leaving it *unprovisioned*, and
 * those two have looked identical to this code ever since the resolver became
 * the authority.
 *
 * ── Why a random probe is the right test ─────────────────────────────────
 * A name nobody has ever created cannot have an explicit record, so if it
 * resolves, only a wildcard can be answering. That is a direct measurement of
 * the one thing that matters, it needs no API token and no zone parsing, and it
 * is the same technique STATE.md §5ae used by hand to prove the wildcard was
 * *absent* at the time.
 *
 * A fresh random label each call, deliberately: a fixed probe name would be
 * cached by every resolver between here and the authority, and worse, somebody
 * would eventually create it.
 */
async function zoneAnswersEveryName(baseDomain: string): Promise<boolean> {
  if (baseDomain.trim() === '') return false;

  const label = `wildcard-probe-${Math.random().toString(36).slice(2, 12)}`;
  return nameResolves(`${label}.${baseDomain}`);
}

/**
 * Does this name have a record of its own — as opposed to merely resolving?
 *
 * The question `ensureDnsRecord` actually needs answered. Under a wildcard the
 * resolver cannot distinguish the two, so when a wildcard is detected this
 * reports `false` and lets the Hostinger API decide, which is the only source
 * that knows what is really in the zone.
 *
 * Failing towards `false` is the safe direction. A wrongly-skipped record
 * leaves a school permanently unreachable and looking fine; a redundant write
 * is refused as a duplicate and handled two lines later.
 */
async function nameHasOwnRecord(fqdn: string, baseDomain: string): Promise<boolean> {
  if (!(await nameResolves(fqdn))) return false;

  // It resolves. That proves provisioning only if nothing is answering for
  // names that were never provisioned.
  return !(await zoneAnswersEveryName(baseDomain));
}

/**
 * Turns Hostinger's DNS rejections into the next thing to try.
 *
 * ── Why this is worth writing out ────────────────────────────────────────
 * `[DNS:4008] DNS resource record is not valid or conflicts with another
 * resource record` was the error that stalled this deployment, and on its own
 * it points nowhere. Its actual cause was that the record was being written
 * into the **parent** zone for a name that lives under a delegation — which is
 * invalid DNS, and which the message above describes accurately and unhelpfully.
 *
 * Appending the likely cause costs nothing and is the difference between an
 * operator reading a code and an operator knowing which zone to look at.
 */
function explainDnsRejection(body: string, zone: string, desired: DesiredRecord): string {
  const text = body.toLowerCase();

  if (text.includes('4008') || text.includes('conflict')) {
    return (
      ` — most often this means "${desired.name}" already has a record of a` +
      ` different type in ${zone}, or that part of the name is delegated to` +
      ` another zone (a CNAME cannot sit beside other records, and no record` +
      ` may sit below a delegation). Check which zone actually holds` +
      ` ${desired.name}.${zone}, and set HOSTINGER_DNS_ZONE to it if it is not` +
      ` this one.`
    );
  }

  if (text.includes('not found') || text.includes('404')) {
    return ` — the zone ${zone} could not be found on this account.`;
  }

  return '';
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

    /*
     * Both shapes are accepted. The SDK documents the response as a bare
     * `DNSV1ZoneRecordResource[]`, but Hostinger's other endpoints wrap their
     * payload in `{ "data": [...] }` and this one has never been observed from
     * here. Guessing wrong in the strict direction would be the expensive
     * mistake: an unrecognised shape reads as "no records", every name looks
     * absent, and the write goes ahead and collides — which is exactly the 422
     * this function is meant to avoid.
     */
    const records = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' &&
          parsed !== null &&
          Array.isArray((parsed as { data?: unknown }).data)
        ? ((parsed as { data: unknown[] }).data)
        : null;

    if (records === null) return false;

    return records.some((entry) => {
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

interface HostingerResponse {
  ok: boolean;
  status: number;
  body: string;
  /**
   * `Retry-After`, in milliseconds, when the host sent one.
   *
   * The header was being discarded entirely. It is the only thing in the whole
   * exchange that says *how long* the limiter wants us to wait, and guessing
   * instead is how a retry becomes another 429.
   */
  retryAfterMs: number | null;
}

/**
 * How much longer this provision may spend waiting on retries.
 *
 * A module-level budget rather than a per-call one, because the ceiling that
 * matters is what the operator waits, and one provision makes several calls. It
 * is reset by `provisionSchoolSubdomain` at the start of each run; a caller that
 * reaches `request` by another path simply inherits whatever is left, which
 * errs towards fewer retries and never towards more.
 */
let retryBudgetRemainingMs = RETRY_BUDGET_MS;

/** `Retry-After` is either a count of seconds or an HTTP date. Both are legal. */
export function retryAfterMsFrom(header: string | null): number | null {
  if (header === null) return null;

  const trimmed = header.trim();
  if (trimmed === '') return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

/** Only a rate limit or a server fault. A 4xx will fail the same way twice. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * One request, with a timeout, a bounded retry, and no secret in anything it
 * can throw.
 *
 * `fetch` failures embed the request URL, which is harmless here, but an error
 * built from a response body is not necessarily — so the body is read and
 * truncated deliberately rather than interpolated whole.
 *
 * ── What is retried, and what is deliberately not ────────────────────────
 * 429 and 5xx: the request was fine and the host was not ready to serve it.
 * Nothing else. A 401 retried is a second rejected token; a 422 retried is the
 * same invalid record submitted twice, and both would spend the budget that
 * exists for the one case where waiting helps.
 *
 * A network failure or a timeout is not retried either. It is the one case
 * where the request may already have *succeeded* at the far end — a parked
 * domain created and its response lost — and repeating it inside the same
 * operator request would trade a clear "retry to check" for an ambiguous
 * duplicate.
 */
async function request(
  url: string,
  init: RequestInit,
  token: string,
): Promise<HostingerResponse> {
  let attempt = 0;

  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
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
    } finally {
      clearTimeout(timer);
    }

    const body = (await response.text()).slice(0, 500);
    const retryAfterMs = retryAfterMsFrom(response.headers.get('Retry-After'));
    const result: HostingerResponse = {
      ok: response.ok,
      status: response.status,
      body,
      retryAfterMs,
    };

    if (result.ok || attempt >= MAX_RETRIES || !isRetryableStatus(result.status)) {
      return result;
    }

    // The host's own number when it gave one, doubling otherwise.
    const wait = retryAfterMs ?? RETRY_BASE_DELAY_MS * 2 ** attempt;

    // Waiting longer than the budget allows is the same as not retrying, except
    // that the operator watches it happen. Hand the response back instead and
    // let the caller record `throttled`.
    if (wait > retryBudgetRemainingMs) return result;

    retryBudgetRemainingMs -= wait;
    attempt += 1;
    await sleep(wait);
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
 *   1. An "already exists" rejection from the create call is treated as
 *      success, which closes the race between two concurrent retries.
 *   2. If a refusal is neither that nor a rate limit, the aliases are listed
 *      and a match still counts as provisioned — the same guarantee the
 *      up-front listing used to give, at one call instead of two per run.
 *   3. Nothing is ever deleted here. The only destructive operation Hostinger
 *      offers on this resource is deliberately not wrapped in this module.
 *
 * ── The call budget ──────────────────────────────────────────────────────
 * A provision was four API calls: list aliases, create alias, read zone, write
 * record. Two of them were avoidable and both are gone — the listing is now a
 * fallback, and the zone probe's response is reused as the zone read. Three
 * calls on the happy path, which is what a per-account rate limiter counts.
 */
export async function provisionSchoolSubdomain(slug: string): Promise<ProvisionResult> {
  const config = readConfig();
  const fqdn = subdomainFor(slug) ?? slug;

  // One budget per provision, not per call: what is bounded is how long the
  // operator waits for the whole operation.
  retryBudgetRemainingMs = RETRY_BUDGET_MS;

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

  // A throttled alias is the end of it too, for a different reason: the DNS
  // half is two more calls into a limiter that has just said no, and it would
  // turn one recoverable state into two.
  if (parked.status === 'throttled') return parked;

  const dns = await ensureDnsRecord(config, fqdn);

  if (dns.outcome === 'throttled') {
    return {
      status: 'throttled',
      message: `${fqdn} is parked. Its DNS record was not written yet: ${dns.message}`,
      fqdn,
      alreadyExisted: parked.alreadyExisted,
    };
  }

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

  try {
    /*
     * -- Create first, list only if that goes wrong -------------------------
     *
     * This used to list the existing aliases and *then* create, which made two
     * calls every time to save nothing: the create call already reports a
     * duplicate, and that report is handled two lines below. Two calls here
     * plus two in the DNS half is four per provision, and four per provision
     * against Hostinger's limiter is what produced the 429 this module now has
     * a status for.
     *
     * The list has not been deleted, only demoted: it runs when the create
     * fails in a way that is not obviously "already there", where its answer
     * is the difference between reporting a failure and reporting the truth.
     */
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

    if (created.status === 429) {
      return {
        status: 'throttled',
        message: throttleMessage(created, `parking ${fqdn}`),
        fqdn,
        alreadyExisted: false,
      };
    }

    // A refusal that is neither a duplicate nor a rate limit. Ask what is
    // actually on the account before calling it a failure — a rejection whose
    // wording `reportsAlreadyExists` does not recognise looks exactly like this.
    if (await parkedDomainExists(config, fqdn)) {
      return {
        status: 'provisioning',
        message: `${fqdn} is already parked on ${config.websiteDomain}.`,
        fqdn,
        alreadyExisted: true,
      };
    }

    return {
      status: 'failed',
      message: `Hostinger refused the request (HTTP ${String(created.status)}). ${summariseResponseBody(created.body)}`,
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

/** Is the alias on the account already? Asked only to disprove a failure. */
async function parkedDomainExists(
  config: HostingerConfig,
  fqdn: string,
): Promise<boolean> {
  try {
    const existing = await request(
      parkedDomainsUrl(config),
      { method: 'GET' },
      config.token,
    );
    return existing.ok && existing.body.toLowerCase().includes(fqdn.toLowerCase());
  } catch {
    // A failed *check* is not proof of anything. The caller keeps its refusal.
    return false;
  }
}

/**
 * What a rate limit reads like once the retries are spent.
 *
 * One sentence, no braces, and the wait the host asked for when it named one —
 * which is the only actionable number in a 429 and was being thrown away with
 * the rest of the headers.
 */
function throttleMessage(response: HostingerResponse, doing: string): string {
  const wait =
    response.retryAfterMs === null
      ? ''
      : ` It asked to be left alone for about ${String(
          Math.max(1, Math.round(response.retryAfterMs / 1000)),
        )}s.`;

  return (
    `Hostinger is rate-limiting this account, so ${doing} was not completed ` +
    `(HTTP 429).${wait} Nothing is wrong with the request and nothing was lost — ` +
    `press Provision again in a minute. ${summariseResponseBody(response.body)}`
  );
}

/**
 * Is the hostname actually serving yet?
 *
 * Existence of the alias is not reachability: DNS has to propagate and a
 * certificate has to be issued, which took about three minutes when this was
 * measured. Only a real HTTPS request can move a school to `ready`, so this is
 * what the retry control calls after ensuring the alias exists.
 */
export type SubdomainReadiness =
  /** Answering over HTTPS. Nothing left to do. */
  | 'live'
  /** DNS resolves and the alias serves, but no certificate has been issued. */
  | 'tls-pending'
  /**
   * It resolves only because a wildcard answers every name. It has no record
   * of its own, so hPanel reads "Not connected" and no certificate will ever
   * be issued for it. Distinct from `tls-pending` because waiting fixes that
   * one and will never fix this one.
   */
  | 'wildcard-only'
  /** The name does not resolve. */
  | 'no-dns';

/**
 * Which of the three states a subdomain is actually in.
 *
 * ── Why this is worth more than a boolean ────────────────────────────────
 * `checkSubdomainReachable` answers "is it live", and both ways of not being
 * live were reported identically — which is how `abc-demo` came to look broken
 * while being three-quarters working. Its DNS was correct, its alias served the
 * right tenant over HTTP, and the only thing missing was a certificate. "Not
 * ready" covered that and "the name does not exist" equally, and those have
 * completely different next steps: one is a wait, the other is a fix.
 *
 * **Hostinger issues certificates for parked domains automatically and it takes
 * up to a couple of hours**, and there is no API to trigger it — the published
 * SDK exposes no SSL endpoint at all. So `tls-pending` is a state the platform
 * can only report, never resolve, and saying so precisely is the whole value.
 */
export async function diagnoseSubdomain(fqdn: string): Promise<SubdomainReadiness> {
  if (await checkSubdomainReachable(fqdn)) return 'live';

  if (!(await nameResolves(fqdn))) return 'no-dns';

  /*
   * It resolves but does not serve. Two very different reasons, and telling an
   * operator to wait for the wrong one costs hours: a certificate that is
   * genuinely coming, or a wildcard answering for a name that owns no record
   * and will therefore never be issued one.
   */
  const base = serverEnv('PLATFORM_BASE_DOMAIN', serverEnv('NEXT_PUBLIC_APP_DOMAIN', ''))
    .trim()
    .toLowerCase();

  return (await zoneAnswersEveryName(base)) ? 'wildcard-only' : 'tls-pending';
}

/** One line an operator can act on, for each state. */
export function describeReadiness(state: SubdomainReadiness, fqdn: string): string {
  switch (state) {
    case 'live':
      return `${fqdn} resolves and is serving over HTTPS.`;
    case 'tls-pending':
      return (
        `${fqdn} resolves and is already serving the right school over HTTP — ` +
        'only its HTTPS certificate is missing. Hostinger issues these ' +
        'automatically for parked domains, usually within a couple of hours, ' +
        'and there is no API to hurry it. If it has not appeared by then, ' +
        'install it in hPanel under the site’s Security → SSL.'
      );
    case 'wildcard-only':
      return (
        `${fqdn} only resolves because a wildcard record answers every name in ` +
        'the zone — it has no DNS record of its own. That is why the hosting ' +
        'panel shows it as "Not connected" and why no HTTPS certificate has ' +
        'appeared: certificates are issued per hostname, against a name the ' +
        'panel can see pointed at this account, and a wildcard is not that. ' +
        'Waiting will not fix it. Press Retry to write the record, or add a ' +
        `CNAME from ${fqdn} to the platform host by hand.`
      );
    case 'no-dns':
      return `${fqdn} does not resolve yet. DNS changes can take a few minutes to spread.`;
  }
}

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

/**
 * A response body, turned into one sentence an operator can read.
 *
 * ── What this used to do, and why it was reported as a bug ───────────────
 * It pasted the first 200 characters of the raw body into the table cell:
 *
 *     Hostinger refused the request (HTTP 429). {
 *      "message": "Too Many Attempts.",
 *      "correlation_id": "a28cff8a-…"
 *     }
 *
 * — braces, newlines, a UUID and all, in red, on the schools list. Everything
 * the operator needed was the two words in the middle; everything else was
 * noise that made the row look like a stack trace.
 *
 * So a JSON body has its message lifted out. The correlation id is *kept* —
 * support cannot trace a request without it — but demoted behind the sentence
 * rather than made the headline. A body that is not JSON falls back to the old
 * truncation, which is still better than nothing and is what an HTML error page
 * from a proxy will hit.
 */
export function summariseResponseBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed === '') return 'No details were returned.';

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
  }

  const record = parsed as Record<string, unknown>;

  // Hostinger says `message`; `detail` and `error` are the other two spellings
  // a JSON API uses for the same field, and costing nothing to accept.
  const headline = ['message', 'detail', 'error']
    .map((key) => record[key])
    .find((value): value is string => typeof value === 'string' && value.trim() !== '');

  if (headline === undefined) {
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
  }

  const sentence = headline.trim().replace(/\s+/g, ' ');
  const correlation = record.correlation_id;

  return typeof correlation === 'string' && correlation.trim() !== ''
    ? `${sentence} (ref ${correlation.trim()})`
    : sentence;
}

function describeNetworkError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return `Hostinger did not respond within ${String(REQUEST_TIMEOUT_MS / 1000)}s. The subdomain may still have been created — retry to check.`;
  }
  return `Could not reach the Hostinger API: ${error instanceof Error ? error.message : String(error)}`;
}
