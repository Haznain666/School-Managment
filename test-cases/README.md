# Test cases

One file per release note. Every case traces to a **claim the release note
actually makes** — a promise to a school, or a rule the note says everything
since has had to agree with. Nothing here was invented from the code.

That is the whole point of the traceability column. A test suite written from
the code tests what the code does; a suite written from the release notes tests
what a school was **told** it would get, which is the thing a school will
complain about.

---

## Read this before running anything

**Sign-in works (confirmed by the user, 2026-08-19).** Setting `SMTP_PASS_B64`
resolved it — the mail path was the blocker, and it had been recorded as an
authentication fault for eleven days. See `STATE.md` §5d item 2.

That matters here because this suite was written expecting the opposite. Sprints
11, 12 and 13 each end with some form of "none of this has been clicked in a
browser", and **those caveats are now stale rather than current**. The screens
behind them have still never been opened — the reason they weren't is simply
gone.

| | |
| --- | --- |
| Cases written | **330**, across 20 release notes |
| Runnable now | the great majority — sign-in is no longer a blocker |
| Blocked on a printer | every case marked **NEEDS PAPER** |
| Blocked on a hosting-panel action | every case marked **NEEDS PANEL** |
| Needs a second school with data | every case marked **NEEDS TENANCY** |
| Already covered by a script | every case marked **AUTOMATED** — run those, don't click them |

**Three sprints shipped without a single screen being looked at.** That is the
backlog this suite exists to clear, and it is worth clearing before Sprint 13.5:
13.5 is accounting, and putting a ledger on top of a fee module whose P1 cases
have never been executed means a figure that disagrees cannot be traced to the
sprint that broke it.

Start with the twelve-case shortlist below.

---

## How a case is written

```
#### UC-S09-04 · Absent paper counts toward marks available — P1
**Role** Teacher · **Traces to** "An absent paper still counts towards the marks available"
1. Mark student A absent on Paper 1 (out of 100); give 80/100 on Paper 2.
2. Publish both papers, open the report card.
- **Expect** marks available 200, obtained 80, percentage 40%.
- **Fail** if available reads 100 — the denominator shrank, and a child can
  improve their percentage by missing their weakest paper.
```

- **ID** — `UC-S<sprint>-<n>`, or `UC-<initials>-<n>` for the releases that are
  not sprints. Stable; do not renumber when inserting.
- **Traces to** — the release-note phrase this defends. If you cannot write one,
  the case does not belong in this suite.
- **Expect** — what passing looks like.
- **Fail** — written wherever the *wrong* behaviour is plausible enough to be
  mistaken for right. This is the row that catches a bug; "expect it to work" on
  its own catches almost nothing.

## Priorities

| | Meaning | Rule of thumb |
| --- | --- | --- |
| **P1** | Money, marks, access control, or tenancy | A defect here is a dispute with a parent, a wrong figure to a board, or a data leak between schools |
| **P2** | Core function of the module | The feature does not do its job |
| **P3** | Presentation and convenience | Wrong, but nobody is harmed |

Run P1 on every release. P2 when the module changed. P3 before a pilot.

**P1 is broad here — 212 of 330 cases.** That is a real property of the product
rather than sloppy grading: this system holds children's records, a school's
money and a family's private figures, and most of what the release notes promise
falls into one of those. It does mean the priority alone will not sequence a
first run, so:

### If you can only run twelve

The highest-value cases in the suite, in order. Each defends something that is
either irreversible, invisible when wrong, or already went wrong once.

| | Case | Why |
| --- | --- | --- |
| 1 | **UC-S13-18** | Nothing authenticated may be cached on a shared phone. The note calls its own sentence the most important in the release |
| 2 | **UC-S01-01/02** | Cross-tenant leakage. Not a bug report — an incident |
| 3 | **UC-S06-08** | One attendance figure across seven surfaces. Disagreement here is visible to parents |
| 4 | **UC-S09-04** | Absent papers and the shrinking denominator. A child can otherwise improve by missing a paper |
| 5 | **UC-S09-13** | Absent students take no position. Prizes are awarded from this |
| 6 | **UC-S05-10** | Billed − Collected = Outstanding. Two queries disagreeing about money |
| 7 | **UC-DDE-06** | Deleting a busy campus silently detaches 400 students. **Nothing errors** |
| 8 | **UC-S00-04** | A valid account must not reset the IP counter. Looks correct when wrong |
| 9 | **UC-S08-04** | A school administrator cannot revoke `permissions.manage` — the one lockout with no way back |
| 10 | **UC-S11-02** | A class audience is that class's *families*. Failing looks like success on every screen |
| 11 | **UC-S03-07** | A member removed for cause must not return on their old password |
| 12 | **UC-APF-07** | `042 35300000` is a landline. Live from `0024` until fixed |

## Markers

| Marker | Meaning |
| --- | --- |
| **NEEDS PAPER** | Cannot pass without printing on real A4. Blocks Sprint 9's report card chart and the printed-document sign-off |
| **NEEDS PANEL** | Needs an action in the Hostinger panel (SMTP, Node version, tokens) |
| **NEEDS TENANCY** | Needs two schools with data, to prove isolation |
| **NEEDS SEED** | Needs Rehearsal Academy, or another school with real volume |
| **AUTOMATED** | Already covered by a `npm run check-*` script — run that instead of clicking |

---

## Test data

**Rehearsal Academy** is the adversarial seed and Sprint 10 built it for exactly
this purpose: 409 students, 10 classes, 2 campuses, 3 academic years, siblings
sharing guardians, **parents with no email address**, mid-term joiners, partial
payments, concessions, and a cross-branch transfer.

> Its release note says it is "deliberately *not* tidy. A clean seed would hide
> exactly the defects a rehearsal exists to find." Do not tidy it, and do not
> write cases against a clean fixture where a messy one exists.

The estate has been materially reduced since — six schools were deleted on
2026-08-19 leaving three (see the dashboard release note). **Confirm what is
actually in the database before assuming a case's preconditions hold.**

## Roles to test as

Eleven, and they are not interchangeable. The ones that carry the most
release-note claims:

- **Super Admin** — the platform operator, authenticated separately
- **School administrator** — always keeps `permissions.manage`, by design
- **Branch administrator** — sees only their own campus; several notes promise
  the campus filter is *not shown* rather than shown and ignored
- **Teacher** — holds `results.enter` and **not** `results.publish` by default
- **Accountant**, **Coordinator**, **Principal** — the permission-matrix edges
- **Parent**, **Student** — not permission-gated at all; their portals answer by
  identity

---

## Index

| Release | Cases | File |
| --- | --- | --- |
| School onboarding fixes | 27 | [read](TEST-CASES-SCHOOL-ONBOARDING-FIXES.md) |
| Address & phone fields | 25 | [read](TEST-CASES-ADDRESS-AND-PHONE-FIELDS.md) |
| SMTP & wildcard subdomains | 14 | [read](TEST-CASES-SMTP-AND-WILDCARD-SUBDOMAINS.md) |
| Dashboard, deletion UI, branch delete, email | 16 | [read](TEST-CASES-DASHBOARD-DELETION-AND-EMAIL.md) |
| Panel chooser & school deletion | 15 | [read](TEST-CASES-PANEL-CHOOSER-AND-SCHOOL-DELETION.md) |
| School & branch creation fixes | 22 | [read](TEST-CASES-SCHOOL-BRANCH-CREATION-FIXES.md) |
| Sprint 13 — Portals, installable app, two principals | 26 | [read](TEST-CASES-SPRINT-13.md) |
| Sprint 12 — Reports & analytics | 20 | [read](TEST-CASES-SPRINT-12.md) |
| Sprint 11 — Communications | 21 | [read](TEST-CASES-SPRINT-11.md) |
| Sprint 10.5 — Design system & shell | 16 | [read](TEST-CASES-SPRINT-10.5.md) |
| Sprint 10 — Import, promotion, transfer, family fees | 18 | [read](TEST-CASES-SPRINT-10.md) |
| Sprint 9 — Exams, results & report cards | 22 | [read](TEST-CASES-SPRINT-09.md) |
| Sprint 8 — Roles & permissions | 12 | [read](TEST-CASES-SPRINT-08.md) |
| Sprint 7 — HR & payroll | 13 | [read](TEST-CASES-SPRINT-07.md) |
| Sprint 6 — Academics, timetable & attendance | 13 | [read](TEST-CASES-SPRINT-06.md) |
| Sprint 5 — Fee management | 16 | [read](TEST-CASES-SPRINT-05.md) |
| Sprint 4 — Admissions & student records | 14 | [read](TEST-CASES-SPRINT-04.md) |
| Sprint 3 — School users, invitations & sign-in | 12 | [read](TEST-CASES-SPRINT-03.md) |
| Sprint 2 — The Super Admin panel | 12 | [read](TEST-CASES-SPRINT-02.md) |
| Sprint 1 — Foundation & multi-tenancy | 9 | [read](TEST-CASES-SPRINT-01.md) |
| Sprint 0 — Auth hardening & the email outbox | 14 | [read](TEST-CASES-SPRINT-00.md) |

Sprints 1–8 are reconstructed release notes, written after the fact from the
migrations and the screens. Their cases are correspondingly thinner on *intent*
and firmer on *structure* — the notes are honest that nobody wrote down why at
the time, and a test case must not invent a reason either.

---

## The rules that cross every sprint

Four claims recur, each stated in one note as something "everything since has
had to agree with". Regression-test them **whenever any module changes**, not
only the sprint that introduced them.

| Rule | From | Where it must hold |
| --- | --- | --- |
| Attendance rate = (present + late) ÷ (present + absent + late + excused); holiday excluded from **both** sides | Sprint 6 | Register, attendance reports, parent portal, report card, dashboard charts, Sprint 12 reports |
| A state meaning "not applicable" is never counted as a bad outcome | Sprints 6, 9, 11 | Holidays, absent students, guardians with no email |
| History is added to, never overwritten | Sprints 4, 7, 10 | Enrolments, salary structures, promotions, transfers, principal assignments |
| A figure on screen and the same figure on paper come from one query | Sprints 9, 12, 13 | Report cards, challans, payslips, every printed report |
