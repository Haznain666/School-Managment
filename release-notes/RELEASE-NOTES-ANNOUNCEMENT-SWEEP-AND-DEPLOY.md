# Release notes — the announcement sweep that had never worked, and a deploy pipeline that does

**Date:** 2026-08-20
**Migration:** none
**Shipped with:** [Sprint 13.8 — sibling identity](RELEASE-NOTES-SPRINT-13.8.md)

Two faults and one piece of infrastructure. The first fault had been in the
product since Sprint 11 and had been dismissed in the handover file three times.
The second was created by fixing the first. The infrastructure is the reason
either of them reached a school.

---

## 1. No scheduled announcement had ever been sent

### What a school saw

You write a notice, set it to go out on Monday at 08:00, and press Schedule. The
screen says **Scheduled**. Monday comes. Nothing is delivered, nothing appears on
the notice board, and the announcement still says **Scheduled** — with its time
in the past — forever.

This was true at every school, for every scheduled announcement, since Sprint 11.
Sending **immediately** always worked; only scheduling was affected.

### What was actually happening

The sweeper that releases due announcements ran every sixty seconds and threw
before it read a single row:

```
The "string" argument must be of type string or an instance of Buffer
or ArrayBuffer. Received an instance of Date [ERR_INVALID_ARG_TYPE]
```

One line was comparing the due time with a raw SQL template rather than the
query builder's `lte` operator. A raw template is the one place the ORM has no
column to map the value against, so a JavaScript `Date` went to the database
driver untouched and the driver refused it.

The sweeper caught the error and logged it — which is why the platform stayed up
and the failure stayed invisible. It only surfaced because an operator read
420 lines of the production log.

**Proven before and after, against the live database:** the generated SQL is
byte-identical to the one in the log; the old form fails 3 runs out of 3 with
that exact message, the new form succeeds 3 out of 3.

### What it means for a school now

Scheduling works. **A notice that has been sitting on "Scheduled" with a past
date will go out on the next sweep** — within a minute of this release. That is
deliberate: a process that was down must send its backlog rather than skip it.
If a school has old scheduled announcements they no longer want, cancel them
before or immediately after upgrading.

---

## 2. Fixing that would have sent every parent seven copies

Found while fixing the first, and fixed with it.

The production log showed the sixty-second sweep running at **seven distinct
offsets in every minute** — seven server processes, each with its own timer.
Before sending, each one checked "has this already been sent?" and then sent. Two
separate steps, with a gap in between that all seven passed through together.

The notice board would have survived — its delivery rows reject duplicates. The
**email queue has no such protection**: an announcement email is an insert, not
an update, so seven runs would have been **seven emails to every parent in the
school**, for every scheduled notice.

The send now claims its announcement in a single atomic database statement.
Postgres decides it on one row under one lock, so exactly one process gets it and
the other six do nothing. **Verified with seven simultaneous claims against the
live database: exactly one won.**

If the send then fails, the announcement is handed back so the next sweep retries
it — a transient failure must not become a notice the school believes went out
and nobody received.

---

## 3. The deploy pipeline

Not a feature, but the reason the two fixes above are running rather than sitting
in a branch.

`Deploy to Hostinger` had never completed a run. It failed four times, each for a
different reason, and each failure named nothing useful:

| Failed at | Cause | Now |
| --- | --- | --- |
| Authorise the deploy key | Secrets created under the *step's* variable names (`SSH_HOST`), not the secret names (`HOSTINGER_HOST`) — because those are the names a failing step prints | A first step names every missing secret **before** the eight-minute build, and every step variable now carries the same name as the secret behind it |
| Authorise the deploy key | Nothing listening on port 22 — Hostinger uses 65002 | `2>/dev/null` had been hiding the reason. Removed; the step now names the three things it can be, most likely first |
| Upload the artifact | `rsync` creates only the last directory of a path; the parents did not exist on a first deploy — and the path is masked in logs because it comes from a secret | The upload creates the directory tree over the same connection first |
| (would have been) Verify | The smoke test exits non-zero with no `PRODUCTION_URL`, which would have failed a deploy whose upload and restart had both **succeeded** | An absent `PRODUCTION_URL` skips the check with a warning that the deploy went out unverified |

**Deployed and verified 2026-08-20.** The build id served at `/super-admin/login`
moved across the deploy, the homepage renders the real platform domain rather
than the `platform.com` fallback — which is what proves the build-time secrets
took effect — and the new API route answers `401` on a real school host while a
nonsense path answers `404`, which is what distinguishes a route that exists from
a blanket response.

### Two settings a school operator should still fill in

* **`HOSTINGER_RESTART_COMMAND`** — without it the upload lands but nothing
  restarts the application. This deploy was picked up anyway; that is luck, not
  a guarantee.
* **`PRODUCTION_URL`** — without it no deploy is ever verified.

---

## Corrections to earlier notes

**School portals were never broken.** An earlier session reported that
`lgs.codexmill.com` did not resolve and that no school subdomain worked. That was
a wrong hostname: schools live at `<slug>.schoolhub.codexmill.com`, one label
deeper. `lgs.schoolhub.codexmill.com` resolves, serves the sign-in page, and
routes tenanted API calls correctly. **No DNS change was needed or made.**

There is no wildcard record under the platform domain, which is correct and
deliberate — each school's subdomain is created by provisioning, and a wildcard
would make an unprovisioned school look reachable. See
[the wildcard notes](RELEASE-NOTES-SMTP-AND-WILDCARD-SUBDOMAINS.md).

---

## Two standing rules added

* **A value never reaches the database driver through a raw SQL template** — use
  the operator. Reserve raw templates for expressions that have no operator.
* **Background work is claimed, not checked** — anything a timer picks up takes a
  conditional update, because there are seven of them.

Both are in `CLAUDE.md`, which is read at the start of every development session.
