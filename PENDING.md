# PENDING.md — the open register

**Purpose:** one place that answers *"is anything outstanding, and who owns
it?"* without reading 16,000 lines of `STATE.md`.

`STATE.md` is the handover *narrative* — what happened, in what order, and why.
This file is the **register**: every item that is still open, each with an owner
and a definition of done. The two are read together. `STATE.md` says how a thing
came to be; this file says whether it is finished.

**Opened:** 2026-09-19, from a full read of `STATE.md` at `d05914d`.
**Last reconciled:** 2026-09-20 (D5 added, D6 opened and closed).

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

### D5 🔴 Seven `kpis.rate.*` permission keys are missing from the CHECK

**Owner:** whichever sprint next touches KPI permissions. One migration.
**Source:** found 2026-09-20 by `npm run check-sprint28`, which fails on it.

`PERMISSIONS` in `lib/permissions.ts` carries `kpis.rate.teacher`,
`kpis.rate.coordinator`, `kpis.rate.vice_principal`, `kpis.rate.hr_manager`,
`kpis.rate.accountant`, `kpis.rate.marketing` and `kpis.rate.section_head`.
The newest migration defining `role_permissions_permission_check` — `0049` —
names none of them.

This is CLAUDE.md's own rule, "a new permission key needs a migration, not just
a line in the list", unmet. `DEFAULT_ROLE_PERMISSIONS` lives in code, so every
one of these **works** for the roles that hold it by default and every browser
test passes. The constraint is reached only when a school *overrides* the
default — granting one of these to another role, or taking it away — and that
administrator gets a `23514` on a permission matrix that had never failed.

Not fixed in the egress sprint that found it: widening that CHECK is a
permissions migration with its own blast radius, and bundling it into a
connection-pool change would have made both harder to reason about.

**Done when:** a migration drops and re-adds `role_permissions_permission_check`
with the full list, proved by attempt the way `scripts/apply-0042.mjs` does —
a key outside the list refused with `23514`, each new key accepted, both inside
transactions that roll back — and `npm run check-sprint28` is green.

### D6 ✅ Supabase egress overage — connection churn and seven schedulers

**Closed 2026-09-20.** See §Closed.

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

### H3 Several statements are covered by catalogue assertions rather than executed

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

### D6 ✅ Supabase egress overage — connection churn and seven schedulers

**Closed 2026-09-20.** Full narrative in `STATE.md` §5cl. Release notes:
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
   WHERE … RETURNING`, migration `0050`). One process sweeps; the other six ask
   once a minute and are told no. The per-item claims are untouched, because a
   lease can expire mid-send and two leaders must not be able to double-send.
3. Eight `setInterval`s deleted; every sweep registers with one timer.
4. Intervals matched to how often the work exists: the outbox reclaim 30s →
   **10 min** (367,329 calls, 0 rows, ever); voucher auto-send, auto-generate
   and the holiday notice 60s → **5 min** (0 rows, ever). The outbox drain
   stays at 30s and the announcement sweep at 60s — those two are the only
   ones a person waits on.

**Evidence.**

- `node scripts/apply-0050.mjs --apply` — `0050` applied, and proved by
  *attempt* rather than by row count: three contenders, exactly one wins;
  the lease expired, exactly one takes over.
- `npm run check-scheduler` — **11 ok, 0 failed, 0 not exercised**, against the
  real schema. Before `0050` it failed with exactly `42P01` and nothing else.
- The check was **sabotaged to prove it can fail**: `setWhere` replaced with
  a literal `true` turned four assertions red (7 of 7 contenders winning), and was
  restored.
- Green build: all fourteen commands, plus `check-sprint33b`,
  `check-sprint33c`, `check-voucher-scope` and `check-sprint30`.
  `check-sprint28` fails on **D5**, which is unrelated and pre-existing — this
  change touches neither `lib/permissions.ts` nor `0049`.
- Before/after `pg_stat_statements` readings: `npm run measure-egress`, and the
  numbers are in `STATE.md` §5cl.

**What is still open and belongs to whoever is next:** the after-reading is a
*rate*, taken over hours rather than the 47.8 days the before-reading covers.
`scripts/measure-egress.mjs --reset` restarts the window; read it again after a
full day before quoting a headline number.

Everything that closed before this file existed is in `STATE.md` §6's own
struck-through list, which is kept for the same reason.
