# Test cases — Sprint 4: Admissions & student records

Traces to [`RELEASE-NOTES-SPRINT-04.md`](../release-notes/RELEASE-NOTES-SPRINT-04.md).
Migration `0006_sprint4_admissions.sql`.

**The rule that governs everything below:** "A student's history is never
overwritten. Promotion, transfer and re-enrolment all add rows." The cost is
stated too — "which section is this child in" is always a question about a
*year*. A case that asks it without a year is testing the wrong thing, and a
screen that answers it without a year is the defect.

---

## Academic years

#### UC-S04-01 · One year is active, and everything files against it — P1
**Role** School administrator · **Traces to** "The year everything else is filed against, with one marked active"
1. Create two years; mark one active. Raise a challan, enrol a student, create an exam term.
- **Expect** all three attach to the active year.
- **Fail** if two years can be active at once.

#### UC-S04-02 · Changing the active year does not rewrite last year — P1
**Role** School administrator · **Traces to** "Fees are priced per year, enrolments belong to a year"
1. With data in year 1, activate year 2. Reopen year 1's enrolments and challans.
- **Expect** unchanged, and still readable.
- **Fail** if anything from year 1 now reports year 2's prices or sections.

---

## Students and IDs

#### UC-S04-03 · Student IDs cannot collide between schools — P1 · **NEEDS TENANCY**
**Role** Two school administrators · **Traces to** "`school_id_sequences` issues student IDs per school so two schools cannot mint the same one"
1. Enrol a student at each of two schools.
- **Expect** each ID carries its own school's prefix and neither collides.

#### UC-S04-04 · The ID counter survives an imported roll — P1 · **NEEDS SEED**
**Role** School administrator · **Traces to** STATE.md §5t, the defect this guards: a school that imported its roll in our own numbering left the counter at zero, so "every direct enrolment minted a number the roll already held and died on the unique index — 409 times over"
1. At a school whose roll was **imported** with platform-style IDs, enrol one student directly.
- **Expect** the next free number is issued (e.g. `RHA-2026-0410`), first time.
- **Fail** if enrolment errors, or if it succeeds only after repeated attempts — each failed attempt burns a number.

#### UC-S04-05 · A student record carries its documented fields — P2
**Role** School administrator · **Traces to** "student ID, date of birth, gender, blood group, photo and identity document"
1. Create a record with all of them, including a photo and a B-Form/CNIC. Reopen.
- **Expect** all persisted. CNIC is digits-only, reformatted 5-7-1 as typed, and refused otherwise; B-Form is free text; both hidden behind an eye toggle (STATE.md §5t).

---

## Enrolment — the history rule

#### UC-S04-06 · A new year is a new enrolment row, not an edit — P1
**Role** School administrator · **Traces to** "**A new year is a new enrolment row, not an edit** — which is what lets the system still answer what class a child was in two years ago"
1. Enrol a child in year 1, section A. Roll into year 2, section B.
2. Ask what class they were in during year 1.
- **Expect** two rows; year 1 still answers "section A".
- **Fail** if one row was edited. Then the question is unanswerable and nothing on screen says so.

#### UC-S04-07 · A student is in one class at a time, but may hold two placements in a year — P1
**Role** School administrator · **Traces to** Sprint 10: "unique only among *active* enrolments… The child really did have two placements that year and both have to exist"
1. Transfer a student between campuses mid-year.
- **Expect** the old enrolment closes, a new one opens, both in the same year, and the transfer succeeds.
- **Fail** with a database error — that was the Sprint 10 defect, and it made every transfer fail with "Something went wrong".

#### UC-S04-08 · Attendance still points at the enrolment it was taken under — P1
**Role** School administrator · **Traces to** Sprint 10: "a register taken at the old campus in July would afterwards claim to have been taken at the new one"
1. Mark attendance at campus 1. Transfer the student to campus 2. Reopen July's register.
- **Expect** July still shows campus 1.
- **Fail** if history follows the child — that is what editing the row in place would have caused, and it is why the fix was a partial index rather than an edit.

---

## Guardians

#### UC-S04-09 · A guardian can exist with no account at all — P1 · **NEEDS SEED**
**Role** School administrator · **Traces to** "The parent account is optional… the office can still phone them"
1. Add a guardian with no email and no account. Save the child.
- **Expect** accepted, and the child's record is complete.
- **Fail** if an account is required — Rehearsal Academy deliberately contains parents with no email address, and later sprints depend on that state being real.

#### UC-S04-10 · A guardian with no address is "unreachable", never "failed" — P1
**Role** School administrator · **Traces to** "Sprint 11's delivery log reports such a parent as unreachable rather than as a failure"
1. Send an announcement by email to a class containing the child from UC-S04-09.
2. Read the delivery report.
- **Expect** **No address**, not Failed.
- **Fail** if it reads Failed — "a failure is ours to retry; a parent with no email address is the school's to fix", and only one of those an office can act on today.

#### UC-S04-11 · One guardian, several children, one family bill — P2 · **NEEDS SEED**
**Role** Accountant · **Traces to** "Sprint 10 later used this same link to bill a family once for three children"
1. Find a guardian sharing three children. Issue a family voucher.
- **Expect** one voucher, one total. Full coverage in the Sprint 10 cases.

---

## Applications

#### UC-S04-12 · An application walks its statuses in order — P2
**Role** School administrator · **Traces to** "An enquiry through to a decision, with a status the applications screen walks in order"
1. Move an application through each status to a decision.
- **Expect** the order is enforced; a decided application cannot silently reopen.

#### UC-S04-13 · Converting an application creates a student — P2
**Role** School administrator · **Traces to** the enrolment funnel: "'Enrolled' means an application became a student record"
1. Accept an application and convert it.
- **Expect** a student record and an enrolment appear, and the funnel counts it.

#### UC-S04-14 · A student enrolled without an application appears in no funnel — P2
**Role** School administrator · **Traces to** Sprint 12: "A school that enrols a child without an application — a sibling, a walk-in, an imported roll — has students who appear in no funnel"
1. Enrol a child directly. Open the enrollment funnel report.
- **Expect** they are **absent** from the funnel and present on the roll.
- **Fail** if this is reported as a data error. It is the documented, correct behaviour, and the report says so on its own face.

---

## Not in this release

- **Bulk import** — Sprint 10. "A school's first 800 students still had to be
  entered by hand until then."
- **Promotion and transfer** — Sprint 10.
