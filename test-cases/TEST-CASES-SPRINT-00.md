# Test cases — Sprint 0: Auth hardening & the email outbox

Traces to [`RELEASE-NOTES-SPRINT-00.md`](../release-notes/RELEASE-NOTES-SPRINT-00.md).
Migration `0015_sprint0_auth_hardening.sql`.

**Why this sprint's cases matter more than most.** The note says plainly that
there was **no rate limiter anywhere in this codebase, on an authentication
surface that was already live**. Everything below defends a control that did not
exist, on the surface an attacker reaches first.

**The asymmetry is the design, not an accident.** Cases 04–07 exist because the
easy implementations are both wrong: an IP-only limit punishes a school behind a
shared connection, and an email-only limit lets one origin spray a thousand
accounts without any counter reaching five. A test that only proves "five
failures lock the account" would pass against either mistake.

---

## Rate limiting and lockout

#### UC-S00-01 · Five failures in fifteen minutes locks the account — P1
**Role** Any school user · **Traces to** "five failed attempts on one email within fifteen minutes locks that account for fifteen minutes"
1. Sign in at a school's `/login` with a valid email and a wrong password, five times.
2. On the sixth attempt use the **correct** password.
- **Expect** the sixth is refused as locked, not as wrong credentials, and stays refused for fifteen minutes.
- **Fail** if the correct password is accepted on the sixth attempt — the lock counts attempts but does not gate.

#### UC-S00-02 · The lock expires on its own — P2
**Role** Any school user · **Traces to** "locks that account for fifteen minutes"
1. Lock an account per UC-S00-01. Wait out the window.
2. Sign in with the correct password.
- **Expect** accepted, with no administrator action needed.
- **Fail** if the lock is permanent — no screen exists to clear one.

#### UC-S00-03 · A success clears that email's streak — P1
**Role** Any school user · **Traces to** "A successful sign-in clears that email's streak"
1. Fail four times on one email.
2. Sign in correctly.
3. Sign out, then fail four times again.
- **Expect** step 3 does not lock the account — the counter restarted at zero.
- **Fail** if the fifth lifetime failure locks it. "Four typos followed by a correct password must not leave somebody one mistake from a lockout."

#### UC-S00-04 · A success does **not** clear the IP's counter — P1
**Role** Attacker model · **Traces to** "but never the IP's"
1. From one IP, fail against several accounts until the IP counter is close to its limit.
2. Sign in successfully to an account the tester legitimately holds.
3. Resume failing from the same IP.
- **Expect** the IP counter was not reset by step 2 and still trips.
- **Fail** if it reset — "an attacker holding one valid account must not be able to reset the whole origin's counter at will." This is the case most likely to be implemented wrongly and to look correct.

#### UC-S00-05 · The IP limit is much looser than the email limit — P1 · **NEEDS TENANCY**
**Role** Several users, one IP · **Traces to** "Per IP address: much looser — 30, or 20 for Super Admin"
1. From one IP, have six different staff each fail twice (12 failures, none reaching five per email).
- **Expect** nobody is locked and the IP is not blocked. "Schools in this market sit behind shared connections; a whole staff room… arrives from one address."
- **Fail** if a staff room is locked out collectively — that punishes the customer, which the asymmetry exists to prevent.

#### UC-S00-06 · Super Admin has the tighter IP limit — P1
**Role** Super Admin · **Traces to** "30, or 20 for Super Admin"
1. Fail repeatedly against `/super-admin/login` from one IP.
- **Expect** blocked at 20, not 30.

#### UC-S00-07 · Every unauthenticated endpoint is covered, not just sign-in — P1
**Role** Unauthenticated · **Traces to** "school sign-in, one-time-code requests, password setting, invitation redemption, and Super Admin sign-in"
1. Hammer each of the five in turn: `/api/school/auth/login`, the OTP request, password setting, invitation redemption, Super Admin login.
- **Expect** all five throttle.
- **Fail** if any one is unlimited — the note lists five, and a limiter on four is a limiter on none.

#### UC-S00-08 · Attempts survive a restart — P2
**Role** Any · **Traces to** "The rate limiter is a Postgres table, not Redis… an in-process counter would be lost on every restart"
1. Fail three times. Restart the application.
2. Fail twice more.
- **Expect** the account locks — the count carried across the restart.
- **Fail** if the counter reset. A limiter an attacker can clear by waiting out a deploy is not one.

#### UC-S00-09 · The attempts table is an audit trail — P3
**Role** Operator, database · **Traces to** "The table is also the audit trail a future security review will ask for"
1. After the cases above, read `auth_attempts`.
- **Expect** rows recording the attempts, with the IP **hashed and never stored raw** (`db/schema/auth-attempts.ts`: "sha256 of the client IP. Never the address itself").
- **Fail** if a raw IP address is stored — that is personal data this application has no use for.

---

## The email outbox

#### UC-S00-10 · Sending returns immediately — P1
**Role** School administrator · **Traces to** "One message to the mail server was measured at about 103 seconds… Now the request writes to a queue and returns"
1. Invite a member and time the request.
- **Expect** a response in well under a second; a row appears in `email_outbox`.
- **Fail** if the request blocks on the mail server. That two-minute spinner is "a broken feature" an operator reasonably gives up on.

#### UC-S00-11 · Screens say "queued", never "sent" — P1
**Role** School administrator · **Traces to** "their wording changed from 'sent' to 'queued'… A screen that says 'Sent' when it means 'queued' is a worse lie than the spinner this replaced"
1. Invite a member. Read the confirmation wording on every screen that reports it.
- **Expect** "queued" or equivalent — never a claim of delivery.
- **Fail** on any screen asserting the mail was sent. Check the composer in Sprint 11 too.

#### UC-S00-12 · The queue retries with backoff and abandons after five — P2
**Role** Operator · **Traces to** "retries with a backoff and abandons a message after five attempts"
1. Point SMTP at an unreachable server. Queue a message.
2. Watch `email_outbox.attempts` and the gaps between them.
- **Expect** attempts increment with widening gaps, stopping at five, ending `failed`/abandoned rather than looping forever.
- **Fail** if it retries indefinitely, or gives up after one.

#### UC-S00-13 · Both drain paths work, and work together — P2
**Role** Operator · **Traces to** "The queue drains two ways — an in-process interval, and an endpoint behind a secret… Both can run at once safely"
1. Queue several messages. Let the interval run and call the drain endpoint at the same moment.
- **Expect** every message is sent **exactly once**.
- **Fail** on a double send — a parent receiving one notice twice is the visible symptom of the concurrency the note claims is safe.

#### UC-S00-14 · The drain endpoint is dark without its secret — P1
**Role** Unauthenticated · **Traces to** "an endpoint behind a secret"
1. Call the drain endpoint with no secret, then with a wrong one.
- **Expect** refused both times, with no information about the queue.

---

## Known gaps — do not raise these as defects

The note lists them as deliberately absent:

- **No CAPTCHA** or challenge on repeated failure.
- **No notification to a user that their account was locked.** A locked-out
  teacher will phone the office; that is the current design.
- **Nothing watches the recorded attempts.** An attack in progress is recorded
  and unalerted. If the pilot needs alerting, that is a change request, not a
  bug report.
