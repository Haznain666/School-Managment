# Test cases — The 535 that was never a wrong password, and the wildcard that faked provisioning

Traces to [`RELEASE-NOTES-SMTP-AND-WILDCARD-SUBDOMAINS.md`](../release-notes/RELEASE-NOTES-SMTP-AND-WILDCARD-SUBDOMAINS.md).
No migration.

**Both faults here had been diagnosed before, and both had been diagnosed
wrong.** In each case the previous conclusion blamed something the operator
controls — a mistyped password, a missing DNS record — "when the actual cause was
code that could not tell a healthy state from a broken one."

That is the pattern these cases defend against. **A test that only checks
"does it work" cannot catch either of these**, because both reported success.
UC-SWS-04 and UC-SWS-09 are the two that matter, and both are about a *healthy
state being distinguishable from a broken one*.

---

## SMTP credentials

#### UC-SWS-01 · A `#` in an unquoted `.env` value truncates it — P1 · **AUTOMATED**
**Role** Operator · **Traces to** the measured table: `SMTP_PASS=fooBar!x@y#z` → `fooBar!x@y` **truncated, silently**
1. Run `npm run check-smtp` (28 assertions, no network).
- **Expect** all pass.
2. Set an unquoted value containing `#` and read what the process receives.
- **Expect** the truncation is **detected and warned about**, not repaired.
- **Fail** if it is silently repaired — "those bytes are gone and inventing them would be a guess."

#### UC-SWS-02 · `SMTP_PASS_B64` wins over `SMTP_PASS` — P1
**Role** Operator · **Traces to** "It wins when both are set"
1. Set both, differing. Read which the process uses.
- **Expect** the base64 one.
- **Rationale** Base64's alphabet is `A-Z a-z 0-9 + / =` — "no `#`, no `$`, no `!`, no quote, no backslash, so no panel, shell or dotenv has anything to act on."

#### UC-SWS-03 · `npm run smtp-encode` echoes nothing and prints a fingerprint — P2
**Role** Operator · **Traces to** "prompts with the echo off, prints the value to paste and a fingerprint to compare against the live process"
1. Run it.
- **Expect** the password is not echoed; a paste value and a fingerprint are printed.
- **Fail** if the password appears on screen or in shell history.

#### UC-SWS-04 · Repairable damage is repaired; ambiguous damage is not touched — P1 · **AUTOMATED**
**Role** Operator · **Traces to** "Half of them assert what the repair must *not* do, which matters as much: a 'fix' that mangled a legitimate quote or `#` would replace a diagnosable failure with an undiagnosable one"
1. Feed `lib/smtp-credentials.ts`: a value with wrapping quotes; one with stray whitespace; and `'abc'def'`, where the quote could be data.
- **Expect** the first two repaired, the third **left alone**.
- **Fail** if the third is altered. This is the case that keeps a future failure diagnosable.

#### UC-SWS-05 · A damaged credential announces itself at boot — P2
**Role** Operator · **Traces to** "so a damaged credential announces itself before anyone presses Invite rather than thirty seconds later inside a queue drain nobody is watching"
1. Start with a damaged credential; read the boot log.
- **Expect** a clear line, beside the Super Admin one.

#### UC-SWS-06 · `/api/internal/smtp-check` proves the live process's credential — P1 · **NEEDS PANEL**
**Role** Operator · **Traces to** "the only check that proves anything, because every other one reads a different environment"
1. With `SUPER_ADMIN_DIAGNOSTICS_SECRET` unset, call it.
- **Expect** dark — 503.
2. Set the secret; call it.
- **Expect** the password's **length and fingerprint (never the password)**, its fragile characters, and which variable it came from.
3. Call with `{"verify":true}`.
- **Expect** the SMTP server's own reply to a real AUTH, **sending nothing**.
- **Fail** if the password itself is ever returned.

#### UC-SWS-07 · The fingerprint matches the local one — P1 · **NEEDS PANEL**
**Role** Operator · **Traces to** "resolved through the new code path, the password is 17 characters, fingerprint `3e92ffa00be4`"
1. Compare `npm run smtp-encode`'s fingerprint against the live process's.
- **Expect** identical. This is the only way to tell whether the process holds *the* credential rather than *a* credential.

#### UC-SWS-08 · Mail actually goes out after the panel is fixed — P1 · **NEEDS PANEL**
**Role** Operator · **Traces to** "Set `SMTP_PASS_B64` in the panel, **remove `SMTP_PASS`**, restart, then press *Retry abandoned messages*. Thirteen messages are waiting (7 queued, 6 failed); the drainer never touches a `failed` row on its own"
1. Do exactly that, in that order.
- **Expect** the queued messages drain and the failed ones are retried.
- **Fail** if `SMTP_PASS` was left in place — both being set is how the original fault survived. See UC-DDE-14 before pressing Retry: those are real, months-old invitations.

---

## Subdomain provisioning

#### UC-SWS-09 · A wildcard zone does not fake success — P1 · **NEEDS PANEL**
**Role** Super Admin · **Traces to** "A wildcard answers **every** label by definition, so a school created seconds ago resolves immediately, `ensureDnsRecord` concludes its record is already there, writes nothing, and reports success. The name becomes *reachable* while remaining *unprovisioned*"
1. In a zone with a wildcard, provision a new school's subdomain.
- **Expect** an explicit record is written, and hPanel shows the name as connected.
- **Fail** if the platform records success while hPanel says "Not connected" — that is the exact reported symptom, with `subdomain_status = 'provisioning'` and `subdomain_error` null.

#### UC-SWS-10 · The wildcard probe uses a fresh random label — P1 · **AUTOMATED**
**Role** Developer · **Traces to** "A fresh random label each call, because a fixed one would be cached by every resolver in the path and would eventually be created by somebody"
1. Read `nameHasOwnRecord()`; call it twice.
- **Expect** a different `wildcard-probe-*` label each time.

#### UC-SWS-11 · With no wildcard, behaviour is byte-for-byte unchanged — P1 · **AUTOMATED**
**Role** Developer · **Traces to** "so this cannot regress the topology `d087f29` was protecting"
1. Run `npm run check-provisioning`.
2. In a zone with no wildcard, provision a subdomain.
- **Expect** the probe fails and the prior behaviour holds — a correctly provisioned school is not re-written, and is not refused with a 422 the UI reports as **Failed**.

#### UC-SWS-12 · `wildcard-only` is reported instead of `tls-pending` — P1
**Role** Super Admin · **Traces to** "the state it used to report was actively misleading: `tls-pending` tells the operator to wait a couple of hours for a certificate that is never coming"
1. In a wildcard zone before an explicit record exists, read the retry control.
- **Expect** **`wildcard-only`**.
- **Fail** on `tls-pending` — it sends an operator away to wait for nothing.

---

## Background error reporting

#### UC-SWS-13 · A background failure prints the reason, not just the query — P1
**Role** Operator · **Traces to** "Which is the query that failed — never the reason… 'Relation does not exist', 'connection terminated' and 'password authentication failed' are four different problems with four different fixes and all four print exactly the block above"
1. Induce a failure in the announcement sweep and in the outbox drainer — a bad credential, then a dropped connection.
2. Read the log.
- **Expect** the underlying cause **and the Postgres error code**, which "usually names the fix on its own".
- **Fail** if only the SQL statement is printed. Drizzle hangs the real error off `cause`, and logging `error.message` throws it away.

#### UC-SWS-14 · The cause walk is bounded and cycle-safe — P2
**Role** Developer · **Traces to** "walks the `cause` chain (bounded depth, cycle-safe)"
1. Pass `lib/describe-error.ts` a deep chain and a circular one.
- **Expect** it terminates in both cases.

---

## Not verified from here

The release is explicit that one thing remains unmeasured:

> **Not verified from here:** that the live host's DNS zone contains a wildcard.
> The Hostinger MCP tools answer `Unauthenticated` in this environment and
> `node:dns` is sandboxed, so the wildcard remains the best-supported
> explanation for the observed symptom rather than a measured one.

**UC-SWS-09 is the case that would settle it**, and it needs someone with panel
access. The fix is correct either way — it changes nothing in a zone without a
wildcard (UC-SWS-11) — so this is a confirmation to obtain, not a risk to carry.

Likewise, the live announcement-sweep failure is a **diagnosis this release
enables rather than one it completes**: the query itself was run against the live
database and succeeded, so "the production failure is not schema drift; it is the
connection, and the log will now say which." Run UC-SWS-13 against the live log
once it next fails.
