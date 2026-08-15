# Release notes — Sprint 0: Auth hardening & the email outbox

**Status:** shipped. Migration `0015_sprint0_auth_hardening.sql`, applied.

Numbered 0 because it is reconciliation work; **built after Sprint 8**, once the
authentication surface was live and it became clear what was missing from it.

Nothing here is a feature a school asks for. Two of the three are things whose
absence would have been discovered the hard way.

---

## What changed

### Rate limiting, where there was none

There was **no rate limiter anywhere in this codebase**, on an authentication
surface that was already live. Every unauthenticated endpoint now records its
attempts and consults that record first: school sign-in, one-time-code requests,
password setting, invitation redemption, and Super Admin sign-in.

**Account lockout**: five failed attempts on one email within fifteen minutes
locks that account for fifteen minutes.

### Two limits, deliberately asymmetric

Per email: five failures in fifteen minutes. Per IP address: much looser — 30,
or 20 for Super Admin.

Schools in this market sit behind shared connections; a whole staff room, and
sometimes a whole cable segment, arrives from one address. An IP-only limit
punishes the customer. An email-only limit lets one origin spray a thousand
accounts without any single counter reaching five. Neither alone covers both
attacks.

**A successful sign-in clears that email's streak but never the IP's.** Four
typos followed by a correct password must not leave somebody one mistake from a
lockout — but an attacker holding one valid account must not be able to reset
the whole origin's counter at will.

### Mail stopped being sent inside a request

One message to the mail server was measured at **about 103 seconds**. Every send
in the application sat inside a request somebody was watching, so "send the
invitation" was a two-minute spinner that an operator reasonably reads as a
broken feature.

Now the request writes to a queue and returns; a drainer sends. The queue
retries with a backoff and abandons a message after five attempts.

**What that costs, stated plainly:** screens that used to report actual delivery
can no longer know it at the moment they answer, and their wording changed from
"sent" to **"queued"**. A screen that says "Sent" when it means "queued" is a
worse lie than the spinner this replaced.

Sprint 11's email campaigns are only possible because of this — a campaign to
four hundred families cannot run inside a request at any speed.

---

## Things worth knowing

- **The rate limiter is a Postgres table, not Redis.** This runs as one
  persistent process with a database pool already open, so Redis would be a new
  vendor, a new secret and a new thing to be down; an in-process counter would
  be lost on every restart. The table is also the audit trail a future security
  review will ask for, which no counter is. It costs one indexed read per
  authentication attempt.
- **The queue drains two ways** — an in-process interval, and an endpoint behind
  a secret so a host cron can drive the same function. Both can run at once
  safely.
- **This sprint corrected the migration numbering.** The plan said Sprint 0
  needed no migration; all three pieces of it are tables. Sprint 0 took `0015`
  and everything from Sprint 9 onward shifted up by one.

---

## Not in this release

- CAPTCHA, or any challenge on repeated failure.
- Notifying a user that their account was locked.
- Alerting an operator to an attack in progress — the attempts are recorded, and
  nothing watches them.
