# Release notes — Row Level Security on every table

**Date:** 20 September 2026
**Not a sprint.** This came out of a Supabase Advisor count — 123 issues — and
a report that the database had exceeded its quota. Neither was what it looked
like.
**Migration:** `0050_rls_lockdown.sql`. Applied and proved, 18 passed, 0 failed.
**Status:** applied to production and verified against the live site.

---

## Fixed

### The key in the browser could read every school's records

The platform ships a Supabase key called the **anon key** to every visitor's
browser. That is normal and by design — it is how the sign-in page talks to the
authentication service, and on its own it is meant to grant nothing.

On this project it granted everything.

Supabase gates that key with a feature called Row Level Security. It was
switched **off on 118 of the 119 tables**, and the key had been granted full
rights on all 119. With the gate off, the grant was the entire access decision.

In practice that meant anyone who opened a browser's developer tools on the
sign-in page — of any school, without signing in — could have read:

| | |
| --- | --- |
| Student profiles and enrolments | every school |
| Guardian names, phone numbers and **CNIC numbers** | every school |
| Fee challans, payments and the accounting ledger | every school |
| Staff records and salary structures | every school |
| **Chat messages** | every school |

And not only read. The same key was permitted to **change and delete** those
records, and to **empty entire tables** — the attendance table among them.

This was not inferred from a settings page. It was demonstrated: the verifier
assumed that key's identity and actually fetched a row from each table above,
then actually issued a delete and a table-truncate, inside transactions that
were rolled back so nothing changed. Every one succeeded.

**From this release the key can reach none of it.** The same demonstration now
refuses on every table:

```
  PASS  anon refused SELECT on student_guardians
  PASS  anon refused SELECT on fee_challans
  PASS  anon refused SELECT on ledger_entries
  PASS  anon refused SELECT on chat_messages
  PASS  anon refused DELETE on student_profiles
  PASS  anon refused TRUNCATE on attendance_records
```

### Nothing about the product changes

No screen, no login, no report and no permission behaves differently. The
application never used that route: it reads its data over a direct database
connection with an administrative role, which this change does not touch.

That is also why the problem lasted as long as it did. The open door was one
the product itself never walked through, so nothing was slow, nothing errored,
and no screen looked wrong.

Two things were checked in the other direction before this was called done —
the application still reads its data, and the chat message socket still works.
The chat socket is the single place a browser is legitimately allowed to read
from the database directly, and it was deliberately left as it was.

Afterwards, the live site was opened: the Askari School System sign-in page
loads its school name out of the database, as it always did, with no errors.

### A smaller one alongside it

One internal database function had an unpinned lookup path — the last of the
123 Advisor findings that was a schema matter rather than a dashboard setting.
Pinned.

---

## Was anything actually taken?

**Unknown, and this release cannot answer it.** Closing a door does not tell
you who walked through it. What can be said:

- The exposure was real and reachable by anyone who looked, for as long as the
  project has been on Supabase.
- It required knowing to look. There is no evidence anyone did, and no evidence
  anyone did not.
- Supabase's request logs are the only place that could indicate it. They are
  worth reading for unexpected traffic to `/rest/v1/` before this date.

Treating that as a real possibility rather than a formality is the honest
position.

---

## Not done, and deliberately

### The two test schools were kept

The session began with a request to delete Lahore Grammar School and Beacon
House School System, because the database had exceeded its quota. Measured:

| | Used | Allowance |
| --- | --- | --- |
| Database | 35 MB | 500 MB |
| File storage | 8.1 MB | 1 GB |
| Auth users | 602 | 50,000 |

Both schools together are **606 rows out of 23,172** and 4.88 MB of files.
Deleting them could not have moved any of those numbers, and the database would
still have read 35 MB afterwards.

So they were kept — they are also the only other tenants available for testing
the very isolation this release changed. The tooling to remove them exists
(`scripts/remove-school.mjs`), is dry-run by default, and refuses to run
destructively without an explicit acknowledgement that a backup exists.

### The quota is egress, and it is still open

The exceeded allowance is **egress** — data leaving the database. The cause is
measured and is not the schools:

- **765,256 database connections** in 58 days, each fetching about 445 rows of
  internal catalogue data on connect. That is 341 million rows — **98.6% of
  everything this database has returned** — and not one row of it is school
  data.
- **Seven background schedulers**, one per server process, each waking every 60
  seconds. Over the same period their sweeps matched **zero** rows 543,798
  times.

That work is scoped and open. It is the actual bill.

---

## For administrators

Nothing to do. No password changes, no re-invitations, no settings to review.
The change is entirely inside the database.
