# Test cases — Sprint 10: Onboarding — import, promotion, transfer, family fees

Traces to [`RELEASE-NOTES-SPRINT-10.md`](../release-notes/RELEASE-NOTES-SPRINT-10.md).
Migrations `0018`–`0020`.

**"The difference between 'we have a system' and 'a school can start using it on
Monday'."** Import is the case that decides whether a pilot happens at all — it
was pulled forward nine sprints for that reason.

**This sprint is the proof that browsers find things scripts do not.** Three
defects surfaced only by clicking, and the headline one — every transfer failing
at the database — had passed every automated check. Cases 08–10 are those three,
kept as permanent regressions.

---

## Bulk import

#### UC-S10-01 · Dry run reports before anything is written — P1 · **NEEDS SEED**
**Role** School administrator (`students.import`) · **Traces to** "Upload a spreadsheet, map its columns, get a **dry-run validation report**, then commit"
1. Upload a file with a mix of good and bad rows. Stop at the dry run.
2. Check the database.
- **Expect** a report naming the problems; **nothing written**.
- **Fail** if any row was created before commit.

#### UC-S10-02 · Bad rows are reported; good rows still load — P1
**Role** School administrator · **Traces to** "Per-row failures are reported rather than aborting the batch, so a file with three bad rows loads the other seven hundred and tells you which three"
1. Commit a 700-row file containing exactly 3 bad rows.
- **Expect** 697 students created, and the 3 named individually.
- **Fail** if the batch aborts. A school re-uploading 700 rows to fix 3 will not use the feature.

#### UC-S10-03 · Column mapping is explicit — P1
**Role** School administrator · **Traces to** "map its columns" and "one bad column mapping writes every one of them wrong"
1. Map columns deliberately wrongly (name → guardian name) and run the dry run.
- **Expect** the mapping is visible for review before commit.
- **Fail** if mapping is inferred silently with no confirmation step.

#### UC-S10-04 · Import writes usable student IDs — P1
**Role** School administrator · **Traces to** UC-S04-04 and STATE.md §5t
1. Import a roll, then enrol one student directly afterwards.
- **Expect** the direct enrolment succeeds first time. This is the 409-failure defect; it only appears **after** an import.

---

## Promotion

#### UC-S10-05 · Promotion previews before it commits — P1
**Role** School administrator (`students.promote`) · **Traces to** "pick a class, preview the roster, and promote, retain or graduate each student"
1. Open a class, review the roster, set some to retain and some to graduate.
- **Expect** the preview matches what commits.

#### UC-S10-06 · Promotion writes new rows and never mutates history — P1
**Role** School administrator · **Traces to** "It **writes new enrolment rows and never mutates history**, so what class a child was in two years ago remains answerable"
1. Promote a class. Ask what class a promoted child was in last year.
- **Expect** answerable, unchanged.
- **Fail** if the old enrolment was edited.

#### UC-S10-07 · There is no undo, and that is stated — P2
**Role** School administrator · **Traces to** "Undo for a promotion run. It is previewed rather than reversible" (listed as *not* in the release)
1. Look for an undo after promoting.
- **Expect** none, and the interface warned first. **Do not raise the missing undo as a defect** — raise a missing warning.

---

## Transfer — the three browser-only defects

#### UC-S10-08 · A transfer succeeds — P1
**Role** School administrator (`students.transfer`) · **Traces to** "**A transfer's whole design is to close the enrolment at one campus and open another in the same year.** Every transfer failed at the database with 'Something went wrong'"
1. Transfer a student between campuses mid-year.
- **Expect** it works, and two enrolment rows exist for that year — one closed, one active.
- **Fail** with any database error. The unique index must be partial: unique only among **active** enrolments.

#### UC-S10-09 · The transfer picker lists each class once — P2
**Role** School administrator · **Traces to** "the transfer picker listed every class once per academic year, two of the three being refused by the route"
1. Open the destination class picker at a school with three academic years.
- **Expect** each class once.
- **Fail** on duplicates — two of the three choices are refused by the route, so the operator picks a valid-looking option and it fails.

#### UC-S10-10 · Fees prorate at the transfer date — P1
**Role** Accountant · **Traces to** "with fee proration at the transfer date and reassignment of their section"
1. Transfer mid-month and inspect the fee position at both campuses.
- **Expect** proration at the transfer date; the section is reassigned.
- **Fail** if a full month is billed at both campuses.

#### UC-S10-11 · Attendance stays with the campus it was taken at — P1
**Role** School administrator · **Traces to** "a register taken at the old campus in July would afterwards claim to have been taken at the new one"
1. After transferring, reopen a pre-transfer register.
- **Expect** it still reports the old campus.

---

## Family vouchers

#### UC-S10-12 · One voucher, one total, for three children — P1 · **NEEDS SEED**
**Role** Accountant · **Traces to** "rather than three challans and three queues at the same window"
1. Issue a family voucher for a guardian with three children.
- **Expect** one voucher, one total equal to the three children's dues.

#### UC-S10-13 · A family voucher can be **paid** — P1
**Role** Accountant · **Traces to** "a family voucher could be issued but not paid, so the queueing the feature exists to remove came straight back"
1. Record one payment against the voucher.
- **Expect** accepted, and it settles across the three children's challans.
- **Fail** if payment is impossible — a documented regression that nullifies the feature.

#### UC-S10-14 · A part payment settles sensibly across children — P1
**Role** Accountant · **Traces to** "it settles across the children"
1. Pay less than the total.
- **Expect** a defined, visible allocation; the remaining balance is exact.
- **Fail** on any rounding drift, or on an allocation the screen does not show.

---

## The defaulter list

#### UC-S10-15 · Overdue by age, and it is the screen an accountant opens daily — P2 · **NEEDS SEED**
**Role** Accountant · **Traces to** "Who is overdue and by how long, in aging buckets. *The report an accountant actually opens each morning.*"
1. Open it against Rehearsal Academy.
- **Expect** correct buckets; cancelled and waived challans excluded; the figures tie to the outstanding-and-aging report.

---

## Permissions

#### UC-S10-16 · The three keys are separately grantable — P1
**Role** Branch administrator · **Traces to** "each deliberately narrower than 'enrol a student'"
1. As a role that may enrol, attempt import, promote and transfer.
- **Expect** all three refused without their own grant.

#### UC-S10-17 · A branch administrator does not hold transfer by default — P1
**Role** Branch administrator · **Traces to** "**Transfer** moves a student *and their fees* between campuses, so a branch administrator does not hold it by default — the receiving campus has to agree"
1. Check the default matrix.
- **Expect** `students.transfer` is not granted to branch administrator by default.

---

## The seed itself

#### UC-S10-18 · Rehearsal Academy still contains its awkward cases — P2 · **NEEDS SEED**
**Role** Operator · **Traces to** "It is deliberately *not* tidy. A clean seed would hide exactly the defects a rehearsal exists to find"
1. Confirm the seed still holds: 409 students, 10 classes, 2 campuses, 3 years, siblings sharing guardians, **parents with no email address**, mid-term joiners, partial payments, concessions, a cross-branch transfer.
- **Expect** all present.
- **Fail** if somebody has cleaned it up. Every sprint since demonstrates against this data, and the awkward rows are the point. Note the estate shrank on 2026-08-19 — confirm it survived.

---

## Not in this release

- Undo for a promotion run.
- Import of anything but students — no staff import, no historical marks.
- Transfer between two different schools on the platform.
