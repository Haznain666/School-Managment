# PENDING.md — the open register

**Purpose:** one place that answers *"is anything outstanding, and who owns
it?"* without reading 16,000 lines of `STATE.md`.

`STATE.md` is the handover *narrative* — what happened, in what order, and why.
This file is the **register**: every item that is still open, each with an owner
and a definition of done. The two are read together. `STATE.md` says how a thing
came to be; this file says whether it is finished.

**Opened:** 2026-09-19, from a full read of `STATE.md` at `d05914d`.
**Last reconciled:** 2026-09-20 (D5, D6 and D7 closed. D7 was not what it
said: the seven `kpis.rate.*` keys are in `0049` and in the live CHECK, and
the defect was `check-sprint28`’s own regex). **2026-09-25:** N2 and L8–L11
added by the Sprint 35 developer; nothing reconciled beyond them.

---

## How this file works

**Every session that finds something open adds it here, in the same turn it
finds it.** A defect recorded only in a sprint's write-up is a defect nobody
reads again — §5cg, §5ch and §5ci each carry a "What is still open" list whose
first bullet was already false by the time the sprint deployed, and nothing
noticed, because those lists are 13,000 lines down.

| Rule | Why |
| --- | --- |
| **Ids are stable and never reused.** `D3` means `D3` forever, including after it closes. | A session referring to "the third defect" ages badly in a week. |
| **Every entry names an owner and a *done*.** | An item with no definition of done cannot be closed, so it is re-litigated every session instead. |
| **Closing means moving it to §Closed with the evidence** — a commit, a build id, a check script's real output — not deleting the line. | §6 of `STATE.md` drifted for three weeks asking for things already done, and every stale line is a thing somebody is asked for twice. |
| **Reconcile the whole file before believing it,** and date it at the top when you do. | This file is worth exactly its accuracy. |
| **A new defect is listed even if you fix it the same hour** — add it, then close it. | The record of what was wrong is worth more than the tidiness of never having listed it. |

Prefixes: **D** defect in the code · **B** blocked on the product owner ·
**N** the next sprint · **L** known limit, not a defect · **U** waiting on the
user · **H** housekeeping.

---

## D — Open defects in the code

### D1 🔴 `lib/payroll-approval.ts` reads the timetable without the live-version predicate

**Owner:** whichever sprint is next allowed to touch payroll approval.
**Source:** `STATE.md` §5ci, "What is still open".

Since `0049` a lesson is a *version*: `timetable_entries` holds closed rows
beside live ones, and every read has to carry the "live today" predicate from
`lib/timetable-history.ts`. Measured at `d05914d`, `payroll-approval.ts` is the
**only** timetable-reading module in `lib/` that does not:

```
lib/academics-queries.ts     live=8  refs=69
lib/teacher-availability.ts  live=4  refs=20
lib/exam-queries.ts          live=4  refs=20
lib/chat-queries.ts          live=3  refs=11
… six more, all >= 2 …
lib/payroll-approval.ts      live=0  refs=6
```

It was left out **by instruction** — payroll approval is frozen under **B2** —
and §5ci called it "harmless until the first supersede, wrong afterwards". That
qualifier has expired: the supersede path ran against real data on 2026-09-19
through the real API, so the first genuine teacher change on any grid makes a
replaced teacher still count toward payroll approval. Nothing throws, and
nothing on any screen looks wrong.

**Done when:** the statement at `lib/payroll-approval.ts:130` carries
`liveTimetableEntries()` and `check-sprint33c` executes it. Blocked by **B2**.

### D2 🔴 Roughly 35 screens stay stale after a save on a hard-loaded page

**Owner:** the next sprint — the plan is **N1**.
**Source:** `STATE.md` §5cc item 3, which sorts all 67 call sites.

`router.refresh()` fires the request and does nothing to the DOM on a page the
browser hard-loaded — a bookmark, a typed URL, a reload, which is how every real
user arrives. 67 sites in 44 files; §5cc item 3 marks which are safe (a refresh
following a `push`) and which are the only update path a screen has. Sprint 32
fixed `AnnouncementManager` alone.

**Done when:** every screen in that list is checked on a **hard-loaded** page,
and `check-refresh` fails on an unexplained `router.refresh()`.

### D3 A substitution cannot be cancelled, and there is no list of them

**Owner:** unassigned. Both were obvious next steps and neither was in Part C.
**Source:** `STATE.md` §5ci, "What is still open".

The substitutes panel shows the cover arranged against each period, and
re-arranging it replaces it. There is no "cancel this cover" and no list of
tomorrow's substitutions. QA needed `scripts/qa-sprint33c-cleanup.mjs` to
withdraw one, which is the tell.

**Done when:** a cover can be withdrawn from a screen, and a day's substitutions
are listable.

### D4 `lib/principal-visibility.ts` documents a nullability the schema does not have

**Owner:** whoever next touches that file. One line.
**Source:** `STATE.md` §5ck, "For whoever is next". Confirmed at
`lib/principal-visibility.ts:126`.

Its docblock says `grades.branch_id` is nullable and that a null one is a
school-wide grade. It is `NOT NULL` (`db/schema/grades.ts`). Harmless where it
sits — the code admits a null it will never see — but it is the **opposite** of
what `lib/admissions-queries.ts` says four files away, and the next person
choosing between `ownedBy` and `sharedOrOwnedBy` will read one of the two.

**Done when:** the docblock matches the schema, or the schema changes and both
say so.

### ~~D5 RLS is off on 118 of 119 public tables, and `anon` holds every privilege~~

✅ **Closed 2026-09-20** — `0050` applied to production, `scripts/apply-0050.mjs`
prints **18 passed, 0 failed**, and the live tenant still reads. The evidence,
including the eight refusals that were failures before it, is in §Closed below.
The full account is `STATE.md` §5cl.

### ~~D6 Seven schedulers × 60s are what is actually consuming the Supabase quota~~

✅ **Closed 2026-09-20**, by the change recorded in `STATE.md` §5cm and
`release-notes/RELEASE-NOTES-EGRESS.md`. The evidence is in §Closed below.
The diagnosis in this entry was correct in every particular and is kept as
written, because it is what the fix was built from.

<details><summary>The diagnosis, as it was opened</summary>


**Owner:** the next sprint allowed to touch `instrumentation.ts`.
**Opened:** 2026-09-20.

The quota is **not** disk. Measured 2026-09-20: database **35 MB** of a 500 MB
allowance, Storage **8.1 MB** of 1 GB, 602 auth users of 50,000. Deleting a
tenant frees 606 rows out of 23,172. Nothing on this list is close to a limit.

What is large is traffic, and `pg_stat_statements` names it. Since the stats
reset on 2026-07-24 — 58 days — the database has executed **4,542,424
statements** and returned **345,848,182 rows**, serving three schools:

| Statement | Calls | Rows returned |
| --- | --- | --- |
| postgres-js type bootstrap (`pg_type`, once per connection) | 765,256 | **341,022,328** |
| `select id from academic_years where location_id = …` | 582,986 | 582,959 |
| `UPDATE email_outbox SET status …` (claim) | 367,233 | 1,379 |
| `UPDATE email_outbox SET status … WHERE scheduled_at < …` | 366,967 | **0** |
| Realtime WAL poll | 292,333 | 292,333 |
| announcements sweep | 141,257 | **2** |
| `update late_fee_rules …` (two sweeps) | 176,831 | **0** |

Two separate faults sit in that table.

**Connection churn.** 341M of the 346M rows returned — 98.6% — are
`pg_catalog.pg_type` rows that postgres-js fetches *once per new connection*.
765,256 connections in 58 days is 13,194 a day; `pgbouncer.get_auth` confirms
220,897 client authentications independently. That is the single largest thing
leaving this database and not one row of it is application data.

**Sweeps that never find anything.** 366,967 email-outbox expiry updates
matched **zero** rows, ever. 176,831 late-fee updates matched **zero** rows,
ever. 141,257 announcement sweeps found **two**. `instrumentation.ts` starts one
scheduler per server process and production runs seven, each waking every 60
seconds — 7.0 `academic_years` reads per minute is exactly that arithmetic, and
it matches.

**Done when:** the sweeps are driven by one claimed leader rather than seven
racing timers, or their intervals reflect how often the work actually exists;
and the connection churn is measured again after it. — **All three done.**

✅ **The quota is egress** — confirmed by the user 2026-09-20, which closes
`U8` and makes this the whole of the work. Egress is bytes leaving the
database, so the 341M catalogue rows at the top of that table are not a
curiosity: they are the bill. Nothing else on the account is near a limit, so
there is no second thing to fix.

⚠ **Do not start by deleting data.** Two test tenants are 606 rows of 23,172
and cannot move an egress allowance by any amount. Sizing the connection churn
is the first measurement worth taking.

</details>

---

## B — Blocked on the product owner

### B1 ⏸ Chat defect 2 — a new conversation not appearing in the list

**Parked by the product owner, 2026-09-15. Do not work on it until they ask.**
**Source:** `STATE.md` §5cc item 2.

Never reproduced. The Playwright MCP connection closed twice within seconds of
hard-loading `/teacher/chat` as Amna Zaheer, before *New conversation* was ever
pressed. Untested suspects: the push-permission prompt behind *Notify me on this
device*, or the chat stream. Amna's inbox is still empty, which makes her the
right account when this is unparked. Next try: a visible Browser pane, or
Playwright headful with notifications denied.

### B2 ⏸ Payroll approval and KPI principals disagree about who heads a teacher

**Waiting on the product owner, who will decide before the next sprint starts.**
**Source:** `STATE.md` §5cc item 4, predicted in §5ca.

Payroll approval covers a teacher by campus *or* by grades, so one teacher can
have two heads. The KPI rule gives each teacher exactly one. The product owner
may change how the school is structured rather than how the code derives it.

**Frozen until they answer:** `lib/payroll-approval.ts`, `teacher_principals`
and the derivation. **D1 is blocked behind this.**

### B3 Family vouchers carry no campus scope, and that is a product question

**Owner:** the product owner, once somebody raises it.
**Source:** `STATE.md` §5ck, "For whoever is next".

`/api/school/family-challans/**` has no campus boundary. This was looked at
during the F5 fix and deliberately **not** changed: a family voucher is
assembled across siblings who may sit at *different* campuses — the sibling card
says so in as many words — so narrowing it by campus decides what a family
voucher *is*. It is not the same shape as the F5 leak and must not be patched
quietly as though it were.

**Done when:** the product owner says whether a campus-bound reader may open a
family voucher that spans campuses.

---

## N — The next sprint

### N1 📋 The stale-list fix

**Set by the product owner, 2026-09-15: this is next, and they need it fixed
then.** Carries **D2**.
**Source:** the `STATE.md` banner; the audit is §5cc item 3.

1. **Find the cause first.** Hard-load an affected screen, call
   `router.refresh()`, and read the RSC request and its response. Suspects: the
   `?school=` rewrite in `middleware.ts`, the RSC request's headers, caching.
   One root cause would fix every screen at once, and thirty-odd screens is far
   too many to rewrite blind.
2. **If there is no single cause, fix screen by screen** with the pattern
   `AnnouncementManager` uses — re-read an endpoint that calls the same query as
   the page. Never `router.refresh()` alone.
3. **Add `check-refresh`**, to `CLAUDE.md`'s green-build list and to
   `.github/workflows/ci.yml` **together**.
4. **Acceptance:** every screen in §5cc item 3, checked on a **hard-loaded**
   page. A test that clicks its way there passes the broken build.

### N2 📋 Sprint 35 — apply `0052`, seed the owner, and QA it in a browser

**Owner:** the main session (devops for the migration). **Opened:** 2026-09-25
by the Sprint 35 developer. **Source:** `STATE.md` §5co.

Built and gated on `sprint35-dev`; **nothing is applied and nothing is
deployed.** In this order:

1. **Before `--apply`, confirm the hash.** `scripts/apply-0052.mjs` seeds the
   owner `haznain666@gmail.com` with the hash from the **local**
   `D:/School-Management-System/.env.local` (`SUPER_ADMIN_PASSWORD_HASH_B64`,
   then `SUPER_ADMIN_PASSWORD_HASH`). If production's panel holds a different
   hash, the owner's production password becomes the local one the moment the
   row exists — the environment fallback stops applying once the table has a
   row. Compare the two, or seed with production's.
2. `node scripts/apply-0052.mjs` (inspect) then `--apply`. It proves the
   trigger, the unique owner, three CHECKs and RLS by attempt.
3. `npm run check-sprint35` must then report `0052 is APPLIED` and **every**
   part-two statement executed, not predicted.
4. **Browser QA against a real build**, at minimum: the Users column and its
   per-role dialog; the Billing tab reproducing USD 162.00; Go Live → Generate
   now → discount → Finalize → PDF → Email → receipt; a manual Block, then the
   suspended page as a teacher (message only) and as the school administrator
   (invoice, amount, bank accounts, PDF download); Unblock; a second super
   admin with a restricted grid; the apex sign-in as super admin, as a
   one-school user, and as a two-school user (the chooser).
5. **Done:** all four, with the build id and `check-sprint35`'s real output
   recorded here and in §5co.

---

## L — Known limits, hazards and gaps that are not defects

### L1 ⚠ "Today" is UTC, and a Pakistani school is UTC+5

`timetableToday()` and the database's own `CURRENT_DATE` are both UTC, so they
agree with each other, and `lib/timetable-history.ts` makes the close/open
boundary a whole day wide to absorb the difference. **It is a documented
decision.** But between Pakistani midnight and 05:00 the product's "today" is
yesterday, and anyone testing a date-sensitive path late at night from here will
conclude the feature is broken — which is exactly what nearly happened on
2026-09-19. **Waiting is not testing:** backdate the row and let the real route
run against it. §5ci.

### L2 ⚠ Five module switches have no screen behind them

`lms`, `event_mgmt`, `transport`, `library` and `hostel` are all in
`PLATFORM_MODULES` and in the Super Admin toggle grid; none is built. They
belong on **Roadmap**, not Features, and `check-product-catalogue` is what keeps
the Features tab honest about it. §5cj.

### L3 ⚠ `SPRINTS.md` has diverged from what exists

It still plans chat, web push, the campus calendar and discount repricing — all
four of which have shipped. Read `app/` and `db/schema/`, not the plan. §5cj.

### L4 ⚠ Sprint 34's authenticated pages were never opened on production

`/super-admin/features` and `/super-admin/roadmap` answer `307` to the login
page when signed out, which proves the middleware guard and **not** that the
route exists — a path that does not exist redirects identically. What *is*
proved is that the live build is the commit containing them, and that both tabs
were driven exhaustively against a standalone production build of that same
commit. Open them on production when somebody has the operator's password to
hand. §5cj.

### L5 ⚠ Nothing reads the timetable history

There is no history view (Part C, decision 9); `timetable_entries_history_idx`
exists for the support question nobody has asked yet. The rows are correct from
the day `0049` ran, and there is nothing before it. §5ci.

### L6 ⚠ Rolling `0049` back stops being possible after the first real supersede

Restoring the whole-table unique index fails with `23505` as soon as one teacher
change has been saved on the new code, because the cell then holds two rows — so
rolling back means deleting exactly the history the sprint exists to create.
Before the first supersede, rollback is clean and total; after it, roll forward.
The `drizzle.__drizzle_migrations` row has to be deleted too, or the migrator
considers `0049` applied and never re-runs it. §5ci.

### L7 ⚠ The emergency QA link needs the tenant's own subdomain

`scripts/qa-emergency-link.mjs` prints a `localhost:3000` URL. On the live
estate a school is resolved from the **host**, not from `?school=`, so
`schoolhub.codexmill.com/api/school/emergency-login/…` answers "School not
found" — and does so *before* spending the token, mercifully. Swap the host for
`<slug>.schoolhub.codexmill.com` yourself. §5ck.

### L8 ⚠ `public/` has never been deployed, and the SchoolHub logo lives there

Sprint 35 is the first change with a `public/` directory (`public/brand/`).
The screens draw the word mark and the bot with `next/image` from
`/brand/*.png`, and `DEPLOYMENT.md` §1 says a standalone build only has
`public/` if the deploy copies it. The **favicon and the PDF** do not depend on
it — both use the copy compiled into `lib/brand-assets-data.ts` — but the apex,
the operator sign-in and the panel's sidebar do. **Done:** open
`https://schoolhub.codexmill.com/brand/schoolhub-logo.png` after the deploy and
get a 200 with an image. If it 404s, copy `public/` in the build, not the
images into code. §5co.

### L9 ⚠ A carried-forward balance does not block on its own

Blocking reads **finalized** invoices only (E5). When the next month's draft
carries an unpaid balance forward, the old invoice becomes `carried_forward`
and stops counting; the debt blocks again only once the new invoice is
finalized and past its own grace. A school already blocked stays blocked —
only a receipt or a super admin unblocks — so this matters only for a school
that was never blocked in the first place. Decided in Sprint 35, recorded so it
is not rediscovered as a bug. §5co.

### L10 ⚠ The invoice email is sent inside the request

`POST …/invoices/[id]/email` sends the PDF synchronously, because the outbox
holds text and not attachments. A slow mail host holds the operator's click for
up to the transport's ceilings (15s connect, 20s socket) and then reports the
failure, which is logged in the send log. Everything else in billing — block,
unblock, trial reminders — goes through the outbox. §5co.

### L11 ⚠ A restricted super admin sent to the dashboard is not told why

`requireSuperAdminPage` redirects an operator who lacks an area to
`/super-admin?denied=1`; the dashboard does not read the flag yet, so the
redirect is silent. The sidebar already hides what they cannot open, so the
path is reached only by a typed URL or a stale bookmark. §5co.

---

## U — Waiting on the user

Carried from `STATE.md` §6, which stays the fuller account. Reconciled
2026-09-19.

### U1 🔴 Rotate the Titan mailbox password — **overdue**

A session transcript printed `SMTP_PASS_B64` in clear on 2026-09-04; the masking
regex was `^[A-Z_]+=`, which does not match a key containing digits. Rotate the
mailbox password, regenerate with `npm run smtp-encode`, and update **both**
`.env.local` and the Hostinger panel. The reminder was set for 2026-09-10 and
has passed. This is the only item on this list with a security consequence.

⚠ Any script comparing env key sets must use `^[A-Z_][A-Z0-9_]*=`.

### U2 🔴 Which school is the pilot?

Still unanswered and still the highest-value thing outstanding — everything in
`ROADMAP.md` is guesswork until one real school uses it.

### U3 Open product questions blocking POS, the wallet and chat

`ROADMAP.md` §7. Uniform size/colour variants is the one that cannot be
retrofitted.

### U4 Register the Apple Developer ($99/yr) and Google Play ($25) accounts

In progress. Needed to *ship* the mobile app, not to build it.

### U5 Confirm the first school's biometric device model, and its firmware

It has to support push/ADMS. §5x.

### U6 Drive the *school* creation form by hand, once

The branch form was driven in a browser on 2026-08-18 and behaved correctly; the
school creation form has still never been submitted end to end by a person. No
plaintext Super Admin password exists — only the hash — so that batch was
verified by 60 scripted assertions and a rendered chart rather than by clicking.
§5ai, §5aj.

### U7 The edge→origin hop — measure it from Lahore

Re-measured 2026-09-05: roughly **0.45s of server time on a route that does no
work** (`/api/internal/build` returns a constant), against the ~1s §5aq
recorded. Better, not fixed. Two questions are left — which datacenter the
origin sits in relative to the Kuala Lumpur edge, and whether the CDN helps
Pakistani traffic at all, since Lahore → KL → origin may be slower than Lahore →
origin.

⚠ **Those numbers are from the development machine, which is not where the
answer matters.** One measurement from a Pakistani connection is worth more than
all of them.

### ~~U8 Which Supabase quota was exceeded, and do the two test schools still go?~~

✅ **Closed 2026-09-20** — the user answered both. The quota is **egress**, so
`D6` is the work. The two test schools are **kept**: they are 606 rows and
4.88 MB, they cannot move an egress allowance, and they are the only other
tenants available for testing the isolation `0050` just changed.
`scripts/remove-school.mjs` stays in the tree for whenever that changes.

---

## H — Housekeeping

### H1 Three `STATE.md` sections claim migrations are unapplied that are applied

§5cg says "`0046` is not applied", §5ch says "neither `0047` nor `0048` is
applied", and §5ci says "`0049` is not applied". All four are applied and
proved, and the banner at the top of that file says so — but the section bodies
still read as blocking work to anyone who lands in them. Strike them through
with the evidence, the way §5cc item 1 was, rather than deleting them.

### H2 Two QA side effects left on the Askari tenant, both deliberate

- Year 3 — A (Main), Monday Period 2, still reads room **"Lab B (QA 33c)"**. A
  room change is an in-place correction, so no earlier version survives to read
  the original off, and guessing a room is worse than an obviously-tagged QA
  string.
- One chat thread from Aftab Awan to the School Office, *"QA Sprint 33c — please
  ignore"*. Deleting a school's record of what was sent is not something a
  cleanup script should do.

The bell notification and chat message telling Hina Aslam to cover a class were
left in place for the same reason: she was told, and deleting the record of the
telling does not untell her. §5ci.

### H3 `STATE.md` §5ck and §5cl sit at the bottom of the file, out of order

Every other section is newest-first from line ~12,900. §5ck (the voucher campus
fix) and §5cl (the RLS lockdown) were each appended after the last line
instead, so the two newest sections before 2026-09-20 sit 3,600 lines below the
third-newest. §5cm was inserted in the right place. Move the other two up
beside it the next time that file is opened — and note the shape of the
mistake: appending is what a session does when it has not looked at where the
file starts.

### H4 Several statements are covered by catalogue assertions rather than executed

`resolveTeacherPrincipals` and `subjectAttendance` are not executed by
`check-sprint33c` — the first writes, the second is private behind `runReport` —
and `getTeacherCalendar` returns null for a tenant that owns no teacher, so it
never reaches its timetable join. `postMessage`, `markConversationRead`,
`claimDigest` and `raiseDigestCount` all write, and `check-sprint24`'s header
records why a check script does not issue an `UPDATE` against a live database.
Every one is reported as *not exercised* rather than passed, which is the honest
state — but none of them has had a server behind it. §5cg, §5ci.

---

## ✅ Closed, with what closed it

Closed items move here with their evidence — a commit, a build id, a check
script's real output — and are never deleted.

### ✅ D5 — RLS on every public table — closed 2026-09-20

Applied to production with `node scripts/apply-0050.mjs --apply`, which is also
what proves it. **18 passed, 0 failed**, and the ten lines that matter are the
ones that had failed three hours earlier:

```
applying 238 statements…
  PASS  RLS on every public table (119/119)
  PASS  no grant left to anon/authenticated outside chat_signals (0 found)
  PASS  anon refused SELECT on student_profiles
  PASS  anon refused SELECT on student_guardians
  PASS  anon refused SELECT on fee_challans
  PASS  anon refused SELECT on ledger_entries
  PASS  anon refused SELECT on school_users
  PASS  anon refused SELECT on chat_messages
  PASS  anon refused DELETE on student_profiles
  PASS  anon refused TRUNCATE on attendance_records
  PASS  postgres — the application's own role — still reads student_profiles (480 rows)
  PASS  authenticated reads chat_signals without error
```

Verified live afterwards, because a lockdown that breaks the product is not a
fix: `askari-school-system.schoolhub.codexmill.com/login` renders **"Askari
School System"** — a real tenant read through the running app — with no console
errors. §5cl.

### ✅ U8 — both questions answered — closed 2026-09-20

**Which quota:** egress, confirmed by the user. `D6` is the work, and it is now
scoped rather than speculative.

**The two schools:** **kept.** They cost 606 rows and 4.88 MB, they cannot move
an egress allowance, and they are the only other tenants available for testing
the multi-tenant isolation that `0050` just changed. `scripts/remove-school.mjs`
stays in the tree, dry-run by default, for whenever they are genuinely not
wanted.

### D6 ✅ Supabase egress overage — connection churn and seven schedulers

**Closed 2026-09-20.** Full narrative in `STATE.md` §5cm. Release notes:
`release-notes/RELEASE-NOTES-EGRESS.md`.

**What it was.** `pg_stat_statements`, read 2026-09-20 over the 47.77 days
since the stats reset of 2026-08-03:

| | |
| --- | --- |
| rows returned, every statement | 346,350,353 |
| rows returned by **one** statement | 341,509,822 — **98.60%** |
| that statement | postgres-js's per-connection type bootstrap |
| times it ran | 766,278 — **16,041 connections a day** |
| rows per connection | 445.7 |

None of it was application data. Three schools' actual data was the remaining
1.4%, so **deleting tenant rows could never have moved the bill** — 606 rows of
23,172, as the brief said.

**The cause was arithmetic.** `idle_timeout: 20` in `lib/postgres.ts` was
shorter than the shortest sweep interval (30s), and `instrumentation.ts`
started eight sweeps in each of the seven server processes. Every tick of every
sweep found the pool empty, opened a connection, paid 446 catalogue rows, did
work that almost always found nothing, and let the connection lapse before the
next tick. The pool never got to be a pool.

**`fetch_types: false` was investigated and rejected, with evidence.** It skips
the bootstrap entirely and it is a silent data-corruption bug: that query is
exactly what registers postgres-js's array parsers, and this schema has six
array columns. Run against the live database:

```
fetch_types=true    branches.class_levels -> ["PRE_SCHOOL","NURSERY",...]  string[]
fetch_types=false   branches.class_levels -> "{PRE_SCHOOL,NURSERY,...}"    string
fetch_types=false   writing one           -> throws: malformed array literal
```

The read side is the dangerous half — no error, a string where every caller
expects an array. `check-scheduler`'s R2 now fails if anybody sets it.

**What closed it.**

1. `idle_timeout` 20 → **300** — longer than every tick, so a working process
   keeps its connection instead of buying a new one ten times a minute.
2. `lib/scheduler.ts` — a **claimed** lease (`INSERT … ON CONFLICT DO UPDATE …
   WHERE … RETURNING`, migration `0051`). One process sweeps; the other six ask
   once a minute and are told no. The per-item claims are untouched, because a
   lease can expire mid-send and two leaders must not be able to double-send.
3. Eight `setInterval`s deleted; every sweep registers with one timer.
4. Intervals matched to how often the work exists: the outbox reclaim 30s →
   **10 min** (367,329 calls, 0 rows, ever); voucher auto-send, auto-generate
   and the holiday notice 60s → **5 min** (0 rows, ever). The outbox drain
   stays at 30s and the announcement sweep at 60s — those two are the only
   ones a person waits on.

**Evidence.**

- `node scripts/apply-0051.mjs --apply` — `0051` applied, and proved by
  *attempt* rather than by row count: three contenders, exactly one wins;
  the lease expired, exactly one takes over.
- `npm run check-scheduler` — **11 ok, 0 failed, 0 not exercised**, against the
  real schema. Before `0051` it failed with exactly `42P01` and nothing else.
- The check was **sabotaged to prove it can fail**: `setWhere` replaced with
  a literal `true` turned four assertions red (7 of 7 contenders winning), and was
  restored.
- Green build: all fourteen commands, plus `check-sprint33b`,
  `check-sprint33c`, `check-voucher-scope` and `check-sprint30`.
  `check-sprint28` fails on **D5**, which is unrelated and pre-existing — this
  change touches neither `lib/permissions.ts` nor `0049`.
- Before/after `pg_stat_statements` readings: `npm run measure-egress`, and the
  numbers are in `STATE.md` §5cl.

**Measured after, the same way as before** — a five-minute `--sample` rate
against the deployed build, no reset:

| | Before | After |
| --- | --- | --- |
| connections | 12.37/min — 17,814/day | **0.00/min** |
| bootstrap rows | 5,913/min | **0/min** |
| all rows returned | 5,930/min | **153/min** |
| bootstrap share of rows | 99.71% | **0.00%** |
| statements (per-`queryid`) | 47.09/min | **19.9/min** |

Zero new connections in five minutes of live production. Deployed as `463e44a`;
the `sweeps` lease was claimed at 14:35:12.927Z and observed renewing **every
30.0s for six minutes under one owner**, which is the proof the new code runs.

⚠ A `--sample` taken inside the first five minutes after a deploy reported
**120.72 statements/min** — seven processes restarting and prerendering, not a
regression. Take this reading ten minutes after a deploy or later.

**Still open, and recorded rather than left in a sprint list:** `acquired_at`
does not move on a lease **takeover**, only on a first insert, because
`claimSchedulerLease` omits it from the `set` so a renewal cannot move it and a
takeover takes the same path. "How long has this leader held it" is therefore
answerable only until the first takeover. Harmless today, and it cost one wrong
conclusion during this session's own verification. Fix, if it ever matters: set
`acquired_at` conditionally on `scheduler_leases.owner <> excluded.owner`.

Everything that closed before this file existed is in `STATE.md` §6's own
struck-through list, which is kept for the same reason.

### D7 ✅ The seven `kpis.rate.*` keys were never missing — the check could not see them

**Closed 2026-09-20.** Narrative in `STATE.md` §5cn. Release notes:
`release-notes/RELEASE-NOTES-D7-PERMISSION-CHECK.md`.

**What it was filed as.** A migration that nobody wrote: `PERMISSIONS` carries
`kpis.rate.teacher`, `kpis.rate.coordinator`, `kpis.rate.vice_principal`,
`kpis.rate.hr_manager`, `kpis.rate.accountant`, `kpis.rate.marketing` and
`kpis.rate.section_head`, and `npm run check-sprint28` said `0049` named none of
them — CLAUDE.md's "a new permission key needs a migration" rule, unmet.

**What it was.** `scripts/check-sprint28.ts` line 353, since Sprint 28:

```ts
[...migration.body.matchAll(/'([a-z]+\.[a-z]+)'/g)]
```

Two segments of lowercase letters, and nothing else. `'kpis.rate.teacher'`
matches `kpis.rate`, then the pattern demands a closing quote and finds a `.`,
so **no three-segment key matched at all** — and no underscore, so
`vice_principal` and `hr_manager` were doubly invisible. It also read
`migration.body`, the whole file, rather than the constraint's own clause.

`0049` names all seven. So does the live database.

**The three readings that settled it,** all taken before anything was changed:

| Evidence | Says |
| --- | --- |
| `0049_sprint33c_portal_work.sql` lines 211–214, read directly | all seven are in the `IN (…)` list |
| `npm run check-branch-scope` — the check CLAUDE.md names for this rule, whose pattern is `/'([a-z_.]+)'/g` scoped to the clause | **PASS**, 1792 assertions, on the same file and the same `PERMISSIONS` |
| `pg_get_constraintdef` on the live `role_permissions_permission_check` | 61 keys, every one of the seven **PRESENT** |

`check-branch-scope`'s own comment records paying for the underscore in Sprint
32. `check-sprint28` was never given the same fix, so the two checks disagreed
about the same file for eight sprints — one green, one red.

**Why no migration was written.** There is nothing for it to add. A `0052`
dropping and re-adding the constraint with the full list would have re-added the
list that is already there, and — the part that matters — **would have left
`check-sprint28` red**, because the pattern that could not read `0049` cannot
read `0052` either. The failing check was the defect.

**What was done instead,** `scripts/check-sprint28.ts`:

1. The parse is scoped to `"permission" IN (…)` and uses `/'([a-z_.]+)'/g`, so a
   key promised in a docblock two hundred lines above the constraint no longer
   counts as the key being there.
2. A new assertion counts the clause's own quoted literals and requires the
   pattern to have matched all of them. An under-matching pattern makes
   `missing` long and `extra` empty — which reads exactly like a forgotten
   migration, and is why this was filed as one. It now says so by name.
3. **Every key in `PERMISSIONS` is attempted against the live CHECK**, not one,
   each in a transaction that is always rolled back, with the row count read
   back. CLAUDE.md's rule is that a constraint is proved by attempt and never by
   reading it; until now the attempt covered `fees.admission` and the other
   sixty rested on the regex.

**The evidence.** `npm run check-sprint28`:

```
PERMISSIONS and the newest migration’s CHECK are the same set:
  ok    db/migrations/0049_sprint33c_portal_work.sql carries a readable "permission" IN (…) clause
  ok    every quoted literal in the clause was parsed
  ok    db/migrations/0049_sprint33c_portal_work.sql names every key in PERMISSIONS
  ok    db/migrations/0049_sprint33c_portal_work.sql names no key the code does not

The widened permission CHECK, proved by attempt:
  ok    fees.admission is accepted by the CHECK
  ok    fees.invent is refused with 23514
  ok    all 60 other keys in PERMISSIONS are accepted by the live CHECK
  ok    nothing was written by any of those attempts

PASS — 51 ok, 0 failed or not exercised
```

And the guard proved by *reverting* to the old pattern, which is the only way to
know a guard fires:

```
  FAIL  every quoted literal in the clause was parsed
        the clause holds 61 literals and the pattern matched 54 — the pattern is
        dropping keys, so "missing" below is about the pattern and not about the migration
```

That second line is the sentence that would have stopped D7 being opened.

**What is still true from the original entry.** Nothing about the code, but the
rule it cited stands and is unaffected: a genuinely new permission key still
needs a migration. What changed is that `check-sprint28` can now tell the
difference between a missing key and a key it cannot read.
