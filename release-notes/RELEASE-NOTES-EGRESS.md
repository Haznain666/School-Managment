# Release notes — the Supabase egress overage

**Date:** 20 September 2026
**Not a sprint.** A hosting bill, traced to its cause.
**Migration:** `0050` — one new table, `scheduler_leases`. Empty, and it holds
no school's data.
**Status:** merged and deployed.
**Nothing a school can see has changed.** No screen, no permission, no record.

---

## The short version

Supabase billed an overage for **egress** — the amount of data the database
sent out. The estate is three schools, so the obvious suspicion was that there
was too much data in it, and the obvious remedy was to delete some.

That would not have worked, and the measurement says why in one line:

> **98.60% of everything the database returned was the application opening
> connections.** Not one row of it was a student, a voucher or a message.

Three schools' entire real data — every record ever entered — accounted for the
other **1.4%**. The 606 rows that had been proposed for deletion are a rounding
error inside that 1.4%. **No amount of deleting tenant data could have moved
this bill**, and nothing was deleted.

---

## What was actually happening

Every time the application opens a new connection to the database, its driver
asks the database to describe its own data types before any real work can
start. That question returns **446 rows**, and it is asked **once per
connection**.

Over 47.8 days it had been asked **766,278 times** — about **16,041
connections a day** — which is 341 million rows of housekeeping.

The reason was a mismatch between two settings that had never been looked at
together:

- the connection pool was told to **discard an idle connection after 20
  seconds**, and
- the background jobs — the email queue, scheduled announcements, the monthly
  voucher run and five others — woke up every **30 to 60 seconds**, in each of
  the **seven server processes** the host runs.

So every job, on every wake-up, in every process, found the pool empty, opened
a fresh connection, paid the 446 rows, did its work, and let the connection be
thrown away before the next wake-up. The pool never got to be a pool.

And most of that work found nothing. Two of those jobs had run **367,329** and
**177,191** times between them since the beginning of August and had **never
once returned a single row**. The announcement job ran 141,437 times and found
two announcements.

---

## What changed

**Connections are now kept.** The pool holds an idle connection for five
minutes instead of twenty seconds — comfortably longer than any job's
wake-up — so a working server reuses its connection instead of buying a new
one ten times a minute.

**One server does the background work, not seven.** The seven processes now
agree among themselves which of them is on duty, using a lease in the database
that exactly one of them can hold at a time. The other six ask once a minute
and are told no. If the one on duty stops — a restart, a deploy, a crash —
another takes over within about three minutes, automatically.

**Jobs now run as often as their work actually happens.** The email queue is
unchanged at every 30 seconds and scheduled announcements at every 60, because
those are the only two anybody waits on: an invitation should arrive while the
person is still at the desk, and a 09:00 announcement should go out at 09:00.
The rest — a monthly voucher run, a holiday notice the day before a holiday,
recovering an email left behind by a crashed process — moved to every five or
ten minutes.

---

## What this does **not** change

- **No email, announcement, voucher or notice can be missed.** Each individual
  piece of work was already claimed by exactly one server before this change,
  and that is untouched. The new lease sits on top of it, not in place of it.
- **Nothing can be sent twice.** The two guards are deliberately kept
  independent, because a lease can lapse at an awkward moment and the older
  guard is what catches it.
- **If the lease itself cannot be reached**, every server goes back to the
  previous behaviour — wasteful, but working. It will never quietly stop doing
  the work. That was a deliberate choice: this product has been bitten once by
  background work that failed silently, and a noisy inefficiency is always
  preferable to a silent stoppage.

---

## A fix that was rejected

There is a single setting that removes the 446-row question entirely, and it
was tested and **deliberately not used**.

That question is also the only thing that teaches the driver how to read the
handful of columns in this database that hold *lists* — the class levels a
campus teaches, the grades a Principal covers, the Saturdays a staff member
works. Turned off, those columns come back as raw text instead of lists, with
**no error of any kind**, and code that asks "does this campus teach Grade 1"
silently starts answering a different question.

It was proved against the live database rather than assumed. One line saved
98.6% of the bill and would have quietly corrupted how the product reads six
columns; the repository now fails its own checks if anybody sets it, with that
evidence attached.

---

## Measurement

Before, taken over a live five-minute window on 20 September:

| | |
| --- | --- |
| connections opened | 12.37/min — **17,814 a day** |
| rows spent describing data types | 5,913/min — **8.5 million a day** |
| share of everything the database returned | **99.71%** |

`npm run measure-egress -- --sample 300` takes the same reading at any time, on
either side of a deploy, and changes nothing while doing it.

---

## For the record

Full technical account: `STATE.md` §5cl. Register entry: `PENDING.md` D6.
New gate: `npm run check-scheduler`, the fifteenth, added to CLAUDE.md's
green-build list and to CI in the same commit.
