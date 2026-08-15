# Release notes — Sprint 10: Onboarding — import, promotion, transfer, family fees

**Status:** shipped. Migrations `0018`–`0020`, applied and verified. **Every
piece was driven through a browser** against a seeded school of 409 students.

Nothing in this sprint is a differentiator. All of it is the difference between
"we have a system" and "a school can start using it on Monday".

---

## What a school gets

### Bulk student import

Upload a spreadsheet, map its columns, get a **dry-run validation report**, then
commit. Per-row failures are reported rather than aborting the batch, so a file
with three bad rows loads the other seven hundred and tells you which three.

This is how a school gets its 800 students in on day one. Without it there is no
pilot — which is why it was pulled forward nine sprints from where it was
originally scheduled.

### Promote students to the next class

Academic-year rollover: pick a class, preview the roster, and promote, retain or
graduate each student. It **writes new enrolment rows and never mutates
history**, so what class a child was in two years ago remains answerable.

### Campus transfer

Move a student to another campus, with fee proration at the transfer date and
reassignment of their section.

### Family / sibling vouchers

One voucher, one total, for a parent with three children — rather than three
challans and three queues at the same window. Issue it, record one payment
against it, and it settles across the children.

### The defaulter list

Who is overdue and by how long, in aging buckets. *The report an accountant
actually opens each morning.*

### Permissions

`students.import`, `students.promote`, `students.transfer` — each deliberately
narrower than "enrol a student":

- **Import** writes hundreds of records in one action. Enrolling one child is a
  decision; loading a whole school is an operation, and one bad column mapping
  writes every one of them wrong.
- **Promote** moves the entire school up a year, once, and is not a single click
  to undo.
- **Transfer** moves a student *and their fees* between campuses, so a branch
  administrator does not hold it by default — the receiving campus has to agree.

---

## The defect that only a browser could have found

`student_enrollments` was uniquely indexed on (school, student, year) — one
enrolment per student per year, which sounds right and is wrong. **A transfer's
whole design is to close the enrolment at one campus and open another in the
same year.** Every transfer failed at the database with "Something went wrong".

Editing the existing row in place was the obvious fix and would have been worse:
attendance records point at the enrolment, so a register taken at the old campus
in July would afterwards claim to have been taken at the new one. The child
really did have two placements that year and both have to exist.

The index is now partial — unique only among *active* enrolments. The invariant
that matters is unchanged (a student is in one class at a time); closed rows
accumulate, which is what history is.

Two smaller defects surfaced the same way: the transfer picker listed every
class once per academic year, two of the three being refused by the route; and a
family voucher could be issued but not paid, so the queueing the feature exists
to remove came straight back.

---

## The adversarial test school

This sprint also seeded **Rehearsal Academy** — 409 students, 10 classes, 2
campuses, 3 academic years, siblings sharing guardians, parents with no email
address, mid-term joiners, partial payments, concessions and a cross-branch
transfer.

It is deliberately *not* tidy. A clean seed would hide exactly the defects a
rehearsal exists to find, and every sprint since has demonstrated against this
data.

---

## Not in this release

- Undo for a promotion run. It is previewed rather than reversible.
- Import of anything but students — no staff import, no historical marks.
- Transfer between two different schools on the platform.
