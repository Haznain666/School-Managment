# Release notes — the 535 that was never a wrong password, and the wildcard that faked provisioning

**Date:** 2026-08-19
**Branch:** `claude/sms-smtp-subdomain-fix-a83af9`
**Migration:** none

Two reported faults, both of which had been diagnosed before and both of which
had been diagnosed **wrong**. In each case the previous conclusion blamed
something the operator controls — a mistyped password, a missing DNS record —
when the actual cause was code that could not tell a healthy state from a broken
one.

---

## 1. `SMTP_USER` / `SMTP_PASS` were correct all along

### What was believed

STATE.md, in bold, since 2026-08-19:

> 🔴 **SMTP credentials in the hosting panel are wrong — proven, not guessed.**
> […] **No session can fix this.** Do not go looking for it in the code again.

That was wrong, and the instruction not to look again is what made it expensive.
The operator re-entered correct credentials repeatedly and nothing changed,
because nothing they could type would have changed it.

### What is actually happening

The mailbox password contains `!`, `@` and `#`. In a `.env` file an unquoted `#`
**opens a comment**, so dotenv discards everything from it onward. Measured
against this repository's own `@next/env`, not assumed:

| Written as | What the process receives |
| --- | --- |
| `SMTP_PASS=fooBar!x@y#z` | `fooBar!x@y` ← **truncated, silently** |
| `SMTP_PASS='fooBar!x@y#z'` | `fooBar!x@y#z` |

`.env.local` survives only because an earlier session happened to wrap the value
in single quotes. And per DEPLOYMENT.md §3, **on Hostinger the panel and the
`.env` file are one store** — a password typed into the Environment UI is
written into a `.env` line. So the panel's copy was correct, and the process
still received a truncated password. The panel goes on displaying the whole
thing, which is precisely why inspecting it proved nothing three times running.

The mirror-image failure is just as quiet: copying the working `'…'` form out of
`.env.local` and into the panel *including its quotes*, which nothing strips
there.

Both produce an identical `535 5.7.8 Error: authentication failed`.

**Proven, not argued:** resolved through the new code path, the password is 17
characters, fingerprint `3e92ffa00be4`, and `smtp.titan.email` **accepts it on
both 465 and 587**.

### What was built

- **`SMTP_PASS_B64`** — the same escape hatch `SUPER_ADMIN_PASSWORD_HASH_B64`
  already provides, for the same reason. Base64's alphabet is `A-Z a-z 0-9 + /
  =`: no `#`, no `$`, no `!`, no quote, no backslash, so no panel, shell or
  dotenv has anything to act on. It wins when both are set.
- **`npm run smtp-encode`** — prompts with the echo off, prints the value to
  paste and a fingerprint to compare against the live process.
- **`lib/smtp-credentials.ts`** repairs the damage that *is* reversible —
  wrapping quotes, stray whitespace — and deliberately refuses to touch a value
  where the quote could be data (`'abc'def'` is left alone). Truncation at a `#`
  is **not** repaired, because those bytes are gone and inventing them would be
  a guess; it becomes a loud warning instead.
- **A boot line**, beside the Super Admin one, so a damaged credential announces
  itself before anyone presses Invite rather than thirty seconds later inside a
  queue drain nobody is watching.
- **`POST /api/internal/smtp-check`** — the sibling of
  `/api/internal/super-admin-check`, and the only check that proves anything,
  because every other one reads a different environment. Returns the password's
  length and fingerprint (never the password), its fragile characters, which
  variable it came from, and — with `{"verify":true}` — the SMTP server's own
  reply to a real AUTH, sending nothing. Guarded by
  `SUPER_ADMIN_DIAGNOSTICS_SECRET`; dark while unset.
- **`npm run check-smtp`** — 28 assertions, no network. Half of them assert what
  the repair must *not* do, which matters as much: a "fix" that mangled a
  legitimate quote or `#` would replace a diagnosable failure with an
  undiagnosable one.

### What the operator still has to do

Set `SMTP_PASS_B64` in the panel, **remove `SMTP_PASS`**, restart, then press
*Retry abandoned messages*. Thirteen messages are waiting (7 queued, 6 failed);
the drainer never touches a `failed` row on its own.

---

## 2. The wildcard made subdomain provisioning report success for nothing

### The symptom

`rehearsal-academy.schoolhub.codexmill.com` was created, hPanel showed it as
**"Not connected"**, and no certificate appeared. The database agreed with the
panel that nothing was wrong: `subdomain_status = 'provisioning'`,
`subdomain_error` **null**.

### The cause

Provisioning has two halves — the parked domain (a vhost alias) and the DNS
record. Commit `d087f29` made the resolver the authority on whether the record
exists, which was a real improvement: it stopped a correctly-provisioned school
being re-written and refused with a 422 that the UI reported as **Failed**.

A wildcard record inverts it. A wildcard answers **every** label by definition,
so a school created seconds ago resolves immediately, `ensureDnsRecord`
concludes its record is already there, writes nothing, and reports success. The
name becomes *reachable* while remaining *unprovisioned*, and those two had
looked identical to this code ever since.

Hence all three symptoms at once: hPanel looks for a record for that exact name
and finds none ("Not connected"); certificates are issued per hostname against a
name the panel can see pointed at this account, and a wildcard is not that (no
HTTPS); and the platform recorded success because, as far as it knew, it had
succeeded.

### The fix

`nameHasOwnRecord()` resolves a random `wildcard-probe-*` label first. A name
nobody has ever created cannot have an explicit record, so if it resolves, only
a wildcard can be answering — and a zone that answers that cannot be trusted to
say whether any particular name is provisioned. The Hostinger API decides
instead, and the explicit record gets written.

**With no wildcard present the probe fails and behaviour is byte-for-byte what
it was**, so this cannot regress the topology `d087f29` was protecting. A fresh
random label each call, because a fixed one would be cached by every resolver in
the path and would eventually be created by somebody.

The retry control gained a fourth readiness state, **`wildcard-only`**, because
the state it used to report was actively misleading: `tls-pending` tells the
operator to wait a couple of hours for a certificate that is never coming.

---

## 3. Every background failure printed the query and hid the reason

The live log has been carrying this once a minute, from two processes at once:

```
[announcements] sweep failed: Failed query: select "location_id", "id" from
"announcements" where ("announcements"."status" = $1 and ...)
params: scheduled,Tue Aug 18 2026 20:47:53 GMT+0000,50
```

Which is the query that failed — never the reason. Drizzle wraps the statement
and hangs the driver's real error off `cause`, and every background catch in
this codebase logged `error.message`, so the cause was thrown away. "Relation
does not exist", "connection terminated" and "password authentication failed"
are four different problems with four different fixes and all four print exactly
the block above.

`lib/describe-error.ts` walks the `cause` chain (bounded depth, cycle-safe) and
appends the Postgres error code, which usually names the fix on its own. Wired
into the announcement sweep and the outbox drainer.

**Worth stating plainly:** that query was run against the live database during
this work and **succeeded** — the table and all thirteen columns are present. So
the production failure is not schema drift; it is the connection, and the log
will now say which. That is a diagnosis this release enables rather than one it
completes.

---

## Verification

- `npx tsc --noEmit` — clean.
- `npm run build` — green; `/api/internal/smtp-check` present in the route
  manifest.
- `npm run check-smtp` — 28/28.
- `npm run check-provisioning`, `check-portals`, `check-forms`, `check-reports`,
  `check-dashboard` — all pass, the last three against the real schema.
- SMTP AUTH accepted on 465 and 587 with the credential resolved through the new
  path.

**Not verified from here:** that the live host's DNS zone contains a wildcard.
The Hostinger MCP tools answer `Unauthenticated` in this environment and
`node:dns` is sandboxed, so the wildcard remains the best-supported explanation
for the observed symptom rather than a measured one. The fix is correct either
way — it changes nothing in a zone without a wildcard.
