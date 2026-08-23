/**
 * The subdomain-provisioning arithmetic, asserted with no database and no
 * network.
 *
 * ── Why this is worth its own gate ───────────────────────────────────────
 * Two pure string functions decide where a DNS record is written, and both fail
 * in a way that looks like success:
 *
 *   - `registrableDomain()` picks the **zone**. Get it wrong and the API is
 *     asked to write into a zone the account may not even own; get it subtly
 *     wrong and the record lands one level off.
 *   - `recordNameWithinZone()` picks the **name inside that zone**. An
 *     off-by-one-label here writes `abc-demo` instead of `abc-demo.schoolhub`,
 *     which creates a perfectly valid record for a hostname nobody will ever
 *     visit — and the panel, the API and the code all report success.
 *
 * Neither is checked by TypeScript, neither is exercised by the build, and the
 * feedback loop on getting them wrong is a school that silently does not
 * resolve. That is the same class of defect `check-portals` exists for.
 *
 *     npm run check-provisioning
 *
 * No token, no database, no network: this asserts the pure half only. The half
 * that talks to Hostinger cannot be asserted from here, and `STATE.md` §5ae
 * says so rather than implying this script proves provisioning works.
 */

import {
  isProvisionSetback,
  isRetryableStatus,
  recordNameWithinZone,
  registrableDomain,
  retryAfterMsFrom,
  summariseResponseBody,
} from '../lib/hostinger';
import { describeSubdomainStatus } from '../lib/subdomain-status';

let failures = 0;

function assert(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (ok) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}`);
  console.log(`       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/*
 * registrableDomain is now the FALLBACK zone, not the primary one.
 *
 * `resolveDnsZone()` probes the base domain first, because on this deployment
 * the base domain *is* its own zone. These assertions still matter: the
 * fallback is what a platform hosted on a subdomain of a zone it does not own
 * relies on.
 */
console.log('\nregistrableDomain — the fallback zone:');
assert(
  'the live platform host',
  registrableDomain('schoolhub.codexmill.com'),
  'codexmill.com',
);
assert('a bare registrable domain', registrableDomain('codexmill.com'), 'codexmill.com');
assert(
  'a deep host still yields two labels',
  registrableDomain('a.b.c.codexmill.com'),
  'codexmill.com',
);
assert('case is normalised', registrableDomain('SchoolHub.CodexMill.COM'), 'codexmill.com');
assert(
  'a trailing dot is tolerated',
  registrableDomain('schoolhub.codexmill.com.'),
  'codexmill.com',
);

/*
 * The documented limitation, asserted so it stays visible.
 *
 * This is "wrong" and is the intended behaviour: without a public-suffix list
 * there is no way to know `co.uk` is a suffix. A deployment there sets
 * HOSTINGER_DNS_ZONE. Pinning it here means the day somebody fixes it properly,
 * this line fails and points at the docblock explaining the trade.
 */
assert(
  'a multi-part public suffix is NOT handled (set HOSTINGER_DNS_ZONE)',
  registrableDomain('schoolhub.example.co.uk'),
  'co.uk',
);

console.log('\nrecordNameWithinZone — the name written into that zone:');

/*
 * THE CASE THIS PLATFORM ACTUALLY CREATES, and the one that was wrong.
 *
 * `schoolhub.codexmill.com` is its own DNS zone — measured 2026-08-16: it has
 * its own SOA and its own NS records, delegated out of `codexmill.com`. So the
 * record goes into that zone under the bare slug. Writing it into the parent
 * zone as `abc-demo.schoolhub` is what produced
 * `HTTP 422 [DNS:4008] ... conflicts with another resource record`: no record
 * may live below a delegation point in the parent.
 *
 * `resolveDnsZone()` now probes the base domain first for exactly this reason.
 */
assert(
  'the live platform: zone is the base domain, name is the bare slug',
  recordNameWithinZone('abc-demo.schoolhub.codexmill.com', 'schoolhub.codexmill.com'),
  'abc-demo',
);
assert(
  'the fallback shape, when only the parent is a zone',
  recordNameWithinZone('abc-demo.schoolhub.codexmill.com', 'codexmill.com'),
  'abc-demo.schoolhub',
);
assert(
  'a hyphenated slug survives intact',
  recordNameWithinZone(
    'my-second-home-school.schoolhub.codexmill.com',
    'schoolhub.codexmill.com',
  ),
  'my-second-home-school',
);
assert(
  'a single-label zone-child',
  recordNameWithinZone('credo.codexmill.com', 'codexmill.com'),
  'credo',
);
assert('case is normalised', recordNameWithinZone('ABC.schoolhub.CODEXMILL.com', 'codexmill.com'), 'abc.schoolhub');
assert(
  'a trailing dot is tolerated',
  recordNameWithinZone('abc.schoolhub.codexmill.com.', 'codexmill.com'),
  'abc.schoolhub',
);

/*
 * The refusals. Each of these, if it returned a string instead of null, would
 * write a record somewhere it does not belong.
 */
assert(
  'a host outside the zone is refused',
  recordNameWithinZone('abc.schoolhub.elsewhere.com', 'codexmill.com'),
  null,
);
assert(
  'the zone apex itself is refused',
  recordNameWithinZone('codexmill.com', 'codexmill.com'),
  null,
);
assert(
  'a suffix that merely ends the same way is refused',
  // `notcodexmill.com` ends with `codexmill.com` as a *string* but is a
  // different domain. Matching on the dot is what separates them.
  recordNameWithinZone('abc.notcodexmill.com', 'codexmill.com'),
  null,
);

/* -----------------------------------------------------------------------------
 * What an operator is shown when the host says no.
 *
 * The other pure half of this module, added after the live deployment's only
 * school was found sitting at `failed` with this in the table cell:
 *
 *   Hostinger refused the request (HTTP 429). {
 *    "message": "Too Many Attempts.",
 *    "correlation_id": "a28cff8a-…"
 *   }
 *
 * Two defects in one string: a rate limit called a refusal, and a JSON document
 * pasted into a UI. Both are decided by pure functions, so both are assertable
 * here, and neither would have been caught by a type-checker or a build.
 * -------------------------------------------------------------------------- */

console.log('\nsummariseResponseBody — one sentence, not a document:');
assert(
  "Hostinger's own 429 body becomes its message",
  summariseResponseBody(
    '{\n "message": "Too Many Attempts.",\n "correlation_id": "a28cff8a-1111-2222-3333-444455556666"\n}',
  ),
  'Too Many Attempts. (ref a28cff8a-1111-2222-3333-444455556666)',
);
assert(
  'the correlation id is kept but never leads',
  summariseResponseBody('{"correlation_id":"abc","message":"Not found."}'),
  'Not found. (ref abc)',
);
assert('`detail` is accepted too', summariseResponseBody('{"detail":"Nope."}'), 'Nope.');
assert('so is `error`', summariseResponseBody('{"error":"Bad zone."}'), 'Bad zone.');
assert(
  'a multi-line message collapses to one line',
  summariseResponseBody('{"message":"Line one.\\n  Line two."}'),
  'Line one. Line two.',
);
assert(
  'a body that is not JSON falls back to truncation',
  summariseResponseBody('<html><body>502 Bad Gateway</body></html>'),
  '<html><body>502 Bad Gateway</body></html>',
);
assert(
  'JSON with no message field falls back rather than inventing one',
  summariseResponseBody('{"code":4008}'),
  '{"code":4008}',
);
assert('an empty body says so', summariseResponseBody('   '), 'No details were returned.');

console.log('\nretryAfterMsFrom — the header that was being discarded:');
assert('seconds', retryAfterMsFrom('30'), 30_000);
assert('a fractional second is not rounded away', retryAfterMsFrom('0.5'), 500);
assert('an absent header is absent', retryAfterMsFrom(null), null);
assert('so is an empty one', retryAfterMsFrom('  '), null);
assert('nonsense is not a wait', retryAfterMsFrom('soon'), null);
assert(
  'an HTTP date in the past never yields a negative wait',
  retryAfterMsFrom('Wed, 21 Oct 2015 07:28:00 GMT'),
  0,
);

console.log('\nWhich statuses are worth trying again:');
assert('429 is', isRetryableStatus(429), true);
assert('500 is', isRetryableStatus(500), true);
assert('503 is', isRetryableStatus(503), true);
assert('401 is not — a rejected token is rejected twice', isRetryableStatus(401), false);
assert('404 is not', isRetryableStatus(404), false);
assert(
  '422 is not — the same invalid record would be refused again',
  isRetryableStatus(422),
  false,
);

console.log('\nthrottled is a warning, and it is retryable:');
assert('it is not danger-coloured', describeSubdomainStatus('throttled').variant, 'warning');
assert('failed still is', describeSubdomainStatus('failed').variant, 'danger');
assert('and it offers the retry', describeSubdomainStatus('throttled').retryable, true);
assert(
  'the label says what happened rather than that something broke',
  describeSubdomainStatus('throttled').label,
  'Rate limited',
);
assert(
  'both setbacks record their message on the row',
  isProvisionSetback('throttled') && isProvisionSetback('failed'),
  true,
);
assert(
  'a provision in progress does not',
  isProvisionSetback('provisioning') || isProvisionSetback('ready'),
  false,
);

if (failures > 0) {
  console.log(`\nFAIL — ${failures} assertion(s) about provisioning did not hold.`);
  process.exitCode = 1;
} else {
  console.log(
    '\nPASS — the zone and record-name arithmetic holds, and a rate limit reads as one.',
  );
  process.exitCode = 0;
}
