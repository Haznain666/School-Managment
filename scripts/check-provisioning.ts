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

import { registrableDomain, recordNameWithinZone } from '../lib/hostinger';

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

if (failures > 0) {
  console.log(`\nFAIL — ${failures} assertion(s) about provisioning did not hold.`);
  process.exitCode = 1;
} else {
  console.log('\nPASS — the zone and record-name arithmetic holds.');
  process.exitCode = 0;
}
