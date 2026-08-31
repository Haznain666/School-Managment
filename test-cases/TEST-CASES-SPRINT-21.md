# Test cases — Sprint 21: one email is one person, and the results page that never rendered

Traces to [`SPRINT-21-SPEC.md`](../SPRINT-21-SPEC.md) items 1–6 and to
[`SPRINT-21-DDL-NOTES.md`](../SPRINT-21-DDL-NOTES.md).

Migration `0038` — **APPLIED before this run**, 38 bookkeeping rows → **39**,
newest `id=39 when=1788264000000`. Re-verified independently here rather than
taken on trust: `node scripts/verify-0038.mjs` 15/15, `npm run check-sprint21`
15/15, and every figure re-derived by hand against the live rows.

Driven against the **real live database**, through the Sprint 21 build
(`c5ed84f`) served as `.next/standalone` on port 3100 from the worktree, in the
Browser pane. Tenants: **Lahore Grammar School** `21fad594-…` (13 directory
rows, 6 students, 2 campuses) and **Beacon House School System**
`e00506c5-…` for isolation.

## Status — 2026-08-31

**Six defects found, none fixed** (reported for a second pass by
`sprint-developer`). Sprint 21's own two defects are **fixed and verified**;
all six findings are on paths the sprint newly constrained and none of them is
a regression of the fix itself.

| Mark | Meaning |
| --- | --- |
| ✅ | executed and passing |
| 🐛 | defect found, reported, not fixed |
| ⚠️ | executed, passing, with a caveat |
| ⬜ | not executed, and why |

**Nothing was left behind.** Every write in this run was inside a transaction
that was rolled back, and each one was read back afterwards: `school_users` at
LGS still 13 rows, Student 1's directory row still
`student:LGS-2026-0001` / NULL / NULL with `updated_at` unchanged at
`08:28:41Z` (the migration's own stamp), Father 1 still on five guardian rows,
zero active `(location_id, lower(email))` duplicates, zero guardians on a
student row. `email_outbox`: **30 sent, 0 queued, nothing created during this
run** — no parent was mailed.

**How it was driven, and the one thing that could not be.** The Browser pane
composited in this session, so the admin screens were clicked. **The parent and
student portals could not be driven at all**: there are no parent or student
credentials, none may be created, and `0038` deliberately cleared Father 1's
`auth_user_id`, so his recovery path is a six-digit code that goes to the
user's own mailbox. Everything those two portals render was therefore exercised
by **executing their own page-level reads** against the live tenant, which is
evidence about the data and not about the render. Said plainly rather than
dressed up: **acceptance items 1, 2 and 3 of the spec are unverified in a
browser.**

---

## ✅ Item 1 — the 42P10 is gone, and it is gone everywhere

**1a — the fixed statement executes and returns rows.**
`listPublishedTermsForStudent` run against LGS for three students who have a
published term and for one who has none. Rows come back; nothing throws.
Student 1 `c64b2707-…`:

```json
[{"termId":"ebc62155-…","termName":"QA14 Mid-Term","academicYearId":"67a7d3e7-…",
  "academicYearName":"2026-2027","startDate":null,"endDate":null,"sequenceOrder":1}]
```

`startYear` does **not** appear in the returned shape, as the docblock promises.

**1b — the pre-fix shape is still refused, so the test has teeth.** The same
statement with `start_year` removed from the select list, executed against LGS:

```
42P10  for SELECT DISTINCT, ORDER BY expressions must appear in select list
```

That is the proof the fix is the fix and not a data condition.

**1c — every other `selectDistinct` / `selectDistinctOn` in `lib/`, executed.**
Nine statements, found by scanning `lib/*.ts` for the builder and reading the
`orderBy` of each, then **run** rather than read:

| Statement | Result |
| --- | --- |
| `listTeacherSections` — `academics-queries.ts:493` | ✅ 1 row |
| `listTeacherPapers` — `exam-queries.ts:1608` | ✅ executed, 0 rows |
| `listTeacherScheduleRows` — `exam-queries.ts:2824` | ✅ executed, 0 rows |
| `listFeedbackSchools` — `feedback-queries.ts:481` | ✅ 1 row |
| `listDepartments` — `hr-queries.ts:256` | ✅ executed, 0 rows |
| `listStudentsForGuardianIdentity` — `siblings.ts:214` (`DISTINCT ON`) | ✅ 1 row |
| `listPortalChildren` — `siblings.ts:436` (`DISTINCT ON`) | ✅ 1 row |
| `childNamesFor` — `parent-portal-access.ts:88` (no `ORDER BY`) | ✅ reached on the provisioning path |
| `listPublishedTermsForStudent` — `portal-results.ts:88` | ✅ 1a above |

42P10 is a **plan-time** error, so "it executed" is the whole assertion: none of
the other eight can be carrying the same defect. The two `DISTINCT ON` forms in
`lib/siblings.ts` order by exactly their distinct list, which is the rule that
form has to satisfy, and both returned rows.

⬜ `loadReportOptions`' payroll-year `selectDistinct` (`report-options.ts:122`)
was **not exercised** — it sits behind a conditional keyed to a payroll report
definition the probe did not resolve. Its `ORDER BY payroll_year` is on its
select list by inspection, which is weaker evidence than every other row above.

## ✅ Item 2 — the ordering did not change, and the result set did not widen

Executed for every LGS student with a published term. For each, the DISTINCT
**without** `start_year` in the select list (the pre-fix result set, ordered in
JavaScript) was compared with what the function now returns:

```
469f46e6…: fn=1  without-startYear=1  sameSet=true  sameOrder=true
5447bb84…: fn=1  without-startYear=1  sameSet=true  sameOrder=true
c64b2707…: fn=1  without-startYear=1  sameSet=true  sameOrder=true
```

⚠️ **The live data cannot exercise a multi-year ordering.** LGS holds one
academic year and one published term, so the comparison above is real but
shallow. The functional dependence the docblock rests on was therefore proved
directly rather than inferred from the ordering:

* `academic_years.id` is the primary key, so `start_year` is dependent on it by
  definition — and measured: **0** `academic_years` ids carry more than one
  `start_year`, and **0** terms yield more than one `start_year` across the join
  `exam_terms.academic_year_id → academic_years.id`.

The extra column therefore cannot add a row to the DISTINCT: every value it can
take is already determined by `academic_year_id`, which was in the DISTINCT
before the fix.

## ✅ Item 3 — the acceptance criteria that could be reached at all

**3a — Father 1's five children, each with a populated panel.** The parent
dashboard's own reads, run for his parent row `2c329df7-…`:

```
Parent dashboard for Father 1: 5 child card(s)
  Student 1 : publishedTerms=1  attendance 1 present (100%)  latestResult=QA14 Mid-Term/promoted  fees 20,000 due
  Student 11: publishedTerms=1  reportCard present            fees 50,000 / 35,000 paid / 15,000 due
  Student 2 : publishedTerms=0  fees 20,000 due
  Student 3 : publishedTerms=0  fees 0
  Student 5 : publishedTerms=0  fees 60,000 / 60,000 paid
```

Five cards, nothing thrown, and the attendance and results panels populated
wherever there is anything to populate — the criterion that was blank before.

**3b — the student portal's reads for Student 1** return the term, the history
row and an empty datesheet, all without throwing.

⬜ **Not verified in a browser:** `/parent/results`, `/student/results`, the
rendered parent dashboard, and "signing in with `…+father1@gmail.com` reaches
the parent portal". No portal credentials exist for QA, none may be created,
and the only path back into that account is a code mailed to a real inbox.

## ✅ Item 4 — the admin screens at LGS, in a real browser

| Screen | Result |
| --- | --- |
| `/dashboard?school=lgs` | ✅ renders — tiles, 6 enrolled students, both campuses |
| `/dashboard/admissions/students/c64b2707-…` | ✅ renders |
| `/dashboard/admissions/students` | ✅ renders, 6 rows, guardian phones resolved |
| `/dashboard/users` | ✅ renders, 13 rows |

**The guardian panel is the acceptance screen and it is right.** Student 1's
profile shows one guardian — **Father 1 · Father**, `(0321) 312-4545`,
`dispatchglobally1+father1@gmail.com` — carrying both **Primary contact** and
**Parent portal account** badges. Before `0038` that link pointed at the child's
own directory row.

**Console and network.** No page error on any of the four screens. The only
console entry in the whole run is one `404` for a favicon, which is
`.next/standalone` having no `public/` directory on this machine, not a product
defect. Every `_rsc … ERR_ABORTED` in the network log is Next's own prefetch
cancellation. The one XHR the profile issues,
`/api/school/fees/student-discounts?studentProfileId=…`, returns 200.

⚠️ Two screens showed their skeleton for several seconds before revealing
(`/dashboard/admissions/students`, `/dashboard/users`). The server log holds no
error and both revealed on a later paint; this is the pane's streamed-Suspense
reveal latency recorded in STATE.md, not a product defect.

**Responsive.** The guardian panel at 375 × 812: name, relationship, phone,
address and both badges stack without clipping or overflow. Dark mode was not
exercised — Sprint 21 changed no component and no stylesheet.

## ✅ Item 5 — tenancy isolation

| Probe | Result |
| --- | --- |
| `GET /api/school/branches` with `x-school-location-id: <Beacon>` forged on the request | ✅ returns **LGS's** two campuses — `middleware.ts:266` deletes every middleware header off the incoming request before setting its own |
| `GET /api/school/users/8efde8c1-…` (a Beacon member) on an LGS session | ✅ `404 User not found` |
| `PATCH /api/school/users/8efde8c1-…` `{isActive:false}` on an LGS session | ✅ `404 User not found`, nothing written |
| `GET /api/school/users/d97cdff3-…` (an LGS member) | ✅ 200 — the control |
| `activeMembershipsByEmail(<Beacon>, <an LGS address>)` | ✅ 0 rows; the same address at LGS returns 1 |
| `linkableAccountsByPhone(<Beacon>, <Father 1's mobile>)` | ✅ 0 rows; at LGS it returns his parent row |
| `listChildrenForGuardian(<Beacon>, <Father 1's parent row>)` | ✅ `[]`; at LGS it returns five children |
| `listPublishedTermsForStudent(<Beacon>, <an LGS student>)` | ✅ `[]` |

No route in this sprint takes a `location_id` from a body or a query string;
`otp/request` and `otp/verify` both read it from the middleware header, which a
client cannot set.

**Permissions.** Sprint 21 adds **no route and no permission key** — the commit
touches `lib/`, one API route, one migration, two scripts and the docs, and
neither `PERMISSIONS` nor `DEFAULT_ROLE_PERMISSIONS` is in it. There is no new
matrix to exercise.

⬜ Cross-tenant guardian and enrolment writes could not be exercised: **Beacon
House has no students and no guardians**, so there is no row of theirs for an
LGS session to reach for.

## ✅ Item 6 — the guards refuse what they should

| Call | Answer |
| --- | --- |
| `portalAccountBlocker(LGS, 'Someone', 'student:LGS-2026-0001', …)` | ✅ refuses, naming Student 1 and the two records to correct |
| `portalAccountBlocker(LGS, 'Father 1', <his own phone>, <his address>)` | ✅ `null` — his own row is not a conflict with itself |
| `portalAccountBlocker(LGS, 'Mother Test', <a free phone>, <Father 1's address>)` | 🐛 refuses — see **F6** |
| the same with the address upper-cased | ✅ still refuses; the guard is `lower()`-based like the index |
| `linkableAccountsByPhone(LGS, ['student:LGS-2026-0001'])` | ✅ `[]` — a child is never linkable as a guardian |
| `linkableAccountsByPhone(LGS, [<Father 1's mobile>])` | ✅ returns his `parent` row |
| `activeMembershipsByEmail`, exact and upper-cased, for a real member | ✅ 1 row both ways |
| `getSchoolUserByUid` for a bound uid | ✅ one row, ordered `created_at, id` |
| `otp/verify`'s single-membership branch | ⬜ unreachable — it redeems a one-time code. Its input is exercised above; the branch is not |

## ✅ Item 7 — the constraint, and the state `0038` left behind

`node scripts/verify-0038.mjs` 15/15, re-derived here rather than believed:

* `school_users_location_email_active_idx` — UNIQUE, on `(location_id, lower(email))`,
  `WHERE ((email IS NOT NULL) AND (email <> ''::text) AND is_active)`;
* Student 1's row: `student` / `student:LGS-2026-0001` / NULL / NULL;
* five guardian rows on `2c329df7-…`; **0** guardians anywhere on a `student` row;
* **0** active `(location_id, lower(email))` duplicates at either school;
* a duplicate address is refused with **23505** inside a rolled-back transaction;
* an **inactive** duplicate is accepted — the index is partial and active-scoped,
  exactly as designed. That permission is what **F1** and **F5** are about.

`npm run check-sprint21` PASS, 15 ok. `npm run check-portals` now prints **NOT
EXERCISED** on the four entries a `NOBODY` tenant cannot reach
(`listPublishedTermsForStudent`, `getStudentReportCard`, `listStudentExams`,
`getChildSnapshot`) instead of `ok`. Item 6 of the spec is done.

---

# Defects

All six sit on paths `0038`'s new index newly constrains, or on a read the
sprint left case-sensitive. None is a regression of the two fixes themselves.

## 🐛 F1 — reactivating a member can 500, and the school is told nothing

`app/api/school/users/[userId]/route.ts:153` and
`app/api/super-admin/schools/[schoolId]/users/[userId]/route.ts:93` both set
`is_active = true` with no handling for `23505`. `handleApiError` turns an
unrecognised error into **500 “Something went wrong.”**

**The state that gets you there is ordinary and reachable entirely through the
UI.** The index is active-scoped, so:

1. a member leaves and is deactivated from `/dashboard/users`;
2. a guardian or a new member is later given that same address —
   `portalAccountBlocker` and every other check look only at **active** rows, so
   this is allowed and correct;
3. the leaver returns and an administrator switches them back on.

Step 3 raises `23505` on `school_users_location_email_active_idx`.

**Verified**, by executing the route's own `UPDATE` inside a transaction that
was rolled back:

```
->  PATCH isActive:true raises  23505 duplicate key value violates unique
    constraint "school_users_location_email_active_idx"
```

Read back afterwards: both rows unchanged, still active, addresses as found.

The sprint's own principle — “the school must never meet a `23505`” — is
applied to `provisionGuardianPortalAccess` and to nothing else that can provoke
the index.

## 🐛 F2 — an email collision is reported as a phone collision

`app/api/school/users/route.ts:162` inserts with an **untargeted**
`.onConflictDoNothing()`. Untargeted means *any* unique index, so since `0038`
the email index is swallowed too — and the only message the route has for an
empty `RETURNING` is about the phone.

**Verified end to end**, through the real route with a real school-admin session
in the browser:

```
POST /api/school/users
{ name:'QA Dup Email', phone:'+923007771122',      <- belongs to nobody
  email:'dispatchglobally1+lgsadmin@gmail.com',    <- Sumera Hasnain's address
  role:'teacher', branchId:'e3716998-…' }

409  { code:'already_exists',
       message:'Someone with that phone number already exists at this school.' }
```

Read back: **no row on `+923007771122`**, no `QA %` row anywhere, LGS still 13
members. The phone was free; the message is simply wrong, and an administrator
following it will retype the number as many times as they like without ever
being told the address is the problem.

`app/api/school/invitations/route.ts:192` carries the same untargeted
`onConflictDoNothing()`.

## 🐛 F3 — accepting an invitation can 500 on the same collision

`app/api/school/invitations/[inviteRef]/accept/route.ts:150` upserts with
`onConflictDoUpdate({ target: [locationId, phone] })`. A conflict on the **email**
index is not the target, so it is raised rather than merged, and the invitee —
not an administrator — meets `handleApiError`'s 500 after the invitation has
already been half-spent.

**Verified** by executing that exact statement shape (insert with `on conflict
(location_id, phone) do update`, carrying an address an active LGS member
already holds) inside a rolled-back transaction:

```
->  insert with a taken address raises  23505 duplicate key value violates
    unique constraint "school_users_location_email_active_idx"
```

Read back: no `QA Probe` row exists.

## 🐛 F4 — `otp/request` matches the address exactly; everything else matches `lower()`

`app/api/school/auth/otp/request/route.ts:85` is
`eq(schoolUsers.email, email)` on an address `normaliseEmail` has already
lower-cased. The index, `activeMembershipsByEmail` and `portalAccountBlocker`
are all `lower(email)`.

So a row stored with any capital letter **can be bound but can never be sent a
code**. The endpoint answers `{sent:true}` either way, by design, so nothing on
screen or in the log says so.

**Verified**, with such a row created and rolled back:

```
stored 'QA.Mixed+Case@Example.COM'
otp/request lookup with the typed address 'qa.mixed+case@example.com': 0 row(s) -> NO CODE IS SENT
activeMembershipsByEmail-shaped lookup:                                1 row(s) -> otp/verify WOULD bind this row
```

**It is reachable, not theoretical.** Nothing lower-cases on the way in:
`POST /api/school/users:168`, `POST /api/school/invitations`,
`lib/school-bootstrap.ts:186` and `student_guardians.email` (which
`provisionGuardianPortalAccess` copies onto the account verbatim) all store what
was typed. An administrator who types `Ali.Khan@Gmail.com` creates a member who
can never receive a code.

The database is clean **today** — 0 rows anywhere carry a capital letter — which
is why this is a latent defect and not an outage.

Its worst case is exactly the person this sprint exists for: `0038` cleared
`auth_user_id`, so for an affected account the emailed code is the **only** path
back in.

## 🐛 F5 — the same read is an unordered `limit(1)` that ignores `is_active`

Same statement as F4. It selects `isActive` and then takes `limit(1)` with no
`orderBy` and no `is_active` filter, so where a **deactivated** row and an
**active** row share an address — which the partial index deliberately permits,
and which is the same population as F1 — the read can return the inactive one
and send nothing to the member who asked.

**Reproduced** in a rolled-back transaction: with a deactivated duplicate
present and the active row's tuple rewritten so it sits later in the heap,

```
otp/request unordered limit(1) now picks: {"name":"QA Leaver","is_active":false}
   <- inactive row wins: no code is sent to the active member
```

Read back: no `QA Leaver` row, and the active row's `updated_at` still
`2026-08-20`.

The whole point of `getSchoolUserByUid`'s new `orderBy` — “an unordered `LIMIT 1`
is only ever ambiguous when something has already gone wrong” — applies to this
read verbatim, and it was not given one.

## 🐛 F6 — one household address, one parent: a legitimate guardian is refused

`portalAccountBlocker`'s address check is correct against the index and wrong
against a Pakistani school roll, where two parents sharing one inbox is common.

**Verified** against live rows:

```
portalAccountBlocker(LGS, 'Mother Test', <a free phone>, 'dispatchglobally1+father1@gmail.com')
-> "dispatchglobally1+father1@gmail.com already belongs to Father 1 at this school,
    and one address can open only one account. Give Mother Test an address of their
    own, or correct whichever of the two records has the wrong one."
```

The mother gets no account and no children on any portal of her own. That is the
index's rule, not a coding error — but it is a **product** decision this sprint
made on a school's behalf and nothing in the spec says it was intended.

**And there is a sharper case with the same message.** One father recorded on
two children with two different numbers — a second mobile, a typo — is refused
in exactly the same words the second time. `provisionGuardianPortalAccess`
returns **before** the `student_guardians` link update, so that second guardian
row keeps `school_user_id = NULL`, and `listChildrenForGuardian` follows only
that column: **the child does not appear in his parent portal at all.** The
message blames the address; the difference is the phone. This is the failure
mode Sprint 21 was opened for — a parent who cannot see all his children — in a
new and quieter form.

Both halves verified at the guard: the phone-varied call above returns the
address refusal, and the same father on his **own** number returns `null`.

---

# What could not be tested, and why

| Not tested | Why |
| --- | --- |
| `/parent/results`, `/student/results`, the rendered parent dashboard | no parent or student credentials exist, none may be created, and `0038` unbound Father 1's account on purpose — his only way back in is a code to a real mailbox |
| “signing in as `…+father1@gmail.com` reaches the parent portal” — the sprint's headline acceptance test | same; it is the user's to run |
| `otp/verify`'s bind-one-or-none branch | it redeems a one-time code; only its inputs can be executed |
| `provisionGuardianPortalAccess`'s write half, and “Resend invite” on the profile | it queues a real welcome to a real parent, which the **live** drainer would then send. Its two refusals were executed instead, which is why they were lifted into `portalAccountBlocker` |
| cross-tenant guardian and enrolment writes | Beacon House holds no students and no guardians |
| `loadReportOptions`' payroll-year DISTINCT | behind a conditional the probe did not resolve |
| dark mode | no component or stylesheet changed in this sprint |

# Cleanup

Every write was inside a transaction that was rolled back, and every one was
read back afterwards:

```
school_users at LGS                      13 rows (unchanged)
rows on +923007771122                    0
rows named 'QA %'                        0
9ebacf91… (Student 1)  student | student:LGS-2026-0001 | null | null | updated_at 08:28:41Z
guardian rows on 2c329df7… (Father 1)    5
active (location_id, lower(email)) dupes 0
guardians pointing at a student row      0
email_outbox                             30 sent, 0 queued, nothing created this run
```

The local QA credential — a bcrypt hash minted for this session into the
gitignored `.env.standalone.local` — was removed and the file restored to what
it held before the run. Nothing in `.env.local`, the hosting panel or the live
deployment was touched.
