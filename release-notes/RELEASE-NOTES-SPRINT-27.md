# Sprint 27 — the pre-paid voucher, the school's own calendar, and the payroll a principal signs

**Branch:** `feature/sprint-27-vouchers-holidays`
**Migration:** `0043_sprint27_vouchers_holidays_payroll.sql` — **written, not applied**

---

## Before this goes live

**`0043` must be applied first, by `sprint-devops`.** Until it is, six screens
are a 500 — `/dashboard/calendar`, `/teacher/calendar`, `/parent/calendar`,
`/student/calendar`, `/dashboard/hr/saturday-duty` and
`/dashboard/payroll/approvals` — submitting a payroll run for approval is
refused with a `23514`, and the two new permission keys work by their defaults
but cannot be changed on the Roles & Permissions screen.

The migration takes a census before the one index that can fail on data, and
names the offending guardians rather than leaving Postgres to report a duplicate
key against a constraint nobody can act on.

`npm run check-sprint27` reads whether `0043` is applied out of the catalogue,
so the same command works before and after. **66 ok, 0 failed** on both sides.

---

## Part A — the pre-paid voucher

A school here is pre-paid: October's fee is billed during September and falls due
on the 10th of October. The product now says so, defaults to it, and can do it
for you.

**One live voucher per student per month, decided by Postgres.** The unique
index on `fee_challans` counted **cancelled** rows, so a school that cancelled
October's individual vouchers in order to raise one family voucher was refused
by the database. It is now partial on `status <> 'cancelled'`, and the same rule
is mirrored on the family voucher. `waived` still occupies the month — waiving
is a decision a human made.

**Generation names the document that took the month.** "Ali Raza already has
voucher GVS-2026-10-0042 for this month, on family voucher GVS-F-2026-10-0007"
instead of "already billed". The bulk run still *skips* the already-billed —
that is what makes an interrupted run of two hundred safe to repeat — but it
returns them named rather than counted.

**Generate family voucher.** One action raises the month for every enrolled
sibling *and* the slip over them, through the same pricing, concessions, credit
and numbering everything else uses. A sibling already holding a live voucher is
a refusal that names them, and the screen offers *Cancel these and continue* —
one click instead of three screens. A voucher carrying money is never cancelled,
whatever was asked for.

**Cancelling a family voucher now follows how it was raised.** One assembled
over existing vouchers releases them; one that raised its members takes them
with it.

**Automatic generation, on a day the school picks.** Off at every school and it
stays off until somebody switches it on. On the 25th (or whichever day), raise
every student's voucher for the following month, clubbing siblings into one slip
if the school wants that. Claimed with a conditional `UPDATE` so the seven
server processes in production produce one run.

**The generate screen defaults to next month**, with the line that makes it
legible: *"Due 10 October 2026 — fees are billed a month ahead."*

### 🔴 A defect fixed: a family payment had never reached the books

`recordFamilyPayment` wrote a payment row per child and moved every balance and
**posted nothing to the ledger** — since Sprint 10. The single-voucher counter
has posted since Sprint 13.5; the family path never did. Every family payment
any school has ever taken understated its income, silently: the receipt printed,
the children showed as paid, the defaulter list emptied, and only the trial
balance disagreed with the cash box.

One posting for the whole payment now, inside the same transaction as the
payments, landing in the clerk's own drawer for cash, with every child's row
carrying the posting that pays it. A school with no chart of accounts still
takes the money and the receipt says the posting did not happen.

---

## Part B — the school's own calendar

**`/dashboard/calendar`, and a read-only copy on all three portals.** A month
grid and a list. A holiday is **one row** however many days it runs, so moving
Eid is one edit.

**Weekends are never rows.** Sunday is always off. Saturday is a **duty
roster** — per role, and per person where somebody's answer differs from their
colleagues'. *"Teachers every Saturday, the principal on two, four coordinators
on one distinct Saturday each"* is exactly what `/dashboard/hr/saturday-duty`
records, and it names *which* Saturdays rather than how many.

**Load public holidays.** Pakistan's six fixed national days and the four
Islamic ones, for any year, skipping whatever is already there and never
overwriting a date a school has moved.

⚠ **Every Islamic date is marked *Tentative — confirm the date*, without
exception.** They are worked out arithmetically; the real dates are decided by
moon sighting and land within a day or two. That is why HR and the Branch
Administrator can move them, and moving one confirms it.

**Notices.** The evening before a closure, one announcement per **block** —
"closed from Friday 30 October to Sunday 1 November for Eid Milad-un-Nabi and
Kashmir Day" is one notice, not three, and it merges across a month boundary and
across two different holidays. A holiday can also be sent to chosen roles by
hand, through the same announcement path everything else uses.

**The staff register says what kind of day it is.** Marking a past Eid now
defaults everyone to *Holiday* and asks you to mark whoever came in as
*Present*, per person — because a Saturday is a day off for some staff and not
others.

### 🔴 A defect fixed: teachers were docked for days the school was shut

The payroll counted every `absent` row in the month regardless of what day it
fell on. A school that marked a register on a Sunday, on Eid, or on a Saturday
half its staff are not expected in on **docked them for it** — silently, on a
payslip whose only clue was a number one day too large. Absences are now
excluded per person for days that were not working days for *that person*.

A run's **working days** are computed from the calendar too, instead of counting
every non-Sunday. A school with no calendar yet gets exactly the number it got
yesterday.

### 🔴 A defect fixed: the bell had never rung for an announcement

Announcements have been written to the notice board since Sprint 11 and to the
notification bell **never**. The bell in every portal header was correct and
empty. It now moves, and takes each person to their own portal's notices.

---

## Part C — the payroll a principal signs

*Only teachers' and coordinators' payroll comes to the principal. A principal
assigned a whole campus approves every teacher and coordinator at it. Where a
school runs several principals, each approves those in their own grades.*

A run now goes **draft → awaiting approval → approved → paid**. Each head signs
their own slice; the run advances when every slice is signed. A rejection sends
it back to HR as a draft with a reason, and clears every signature so the next
submission is a clean sheet.

**`/dashboard/payroll/approvals`** shows a head the staff they are answerable
for, with gross, loss of pay and net, plus *Override deduction* — which asks for
the amount **and a reason**, both required and both stored. The original figure
is kept beside the override: a teacher asking why they were paid more than the
register implies is owed both numbers.

**A school with no principal is not affected at all.** The run behaves exactly
as it did before this sprint — submitting it approves it. Staff no assignment
reaches are **named** on the run screen rather than quietly blocking it.

**`payroll.approve` is deliberately not HR's.** The person who computes the
payroll is not the person who signs it off.

---

## New permissions

| Key | Held by default |
| --- | --- |
| `calendar.manage` — add a holiday, move one, load the year's public holidays | School Administrator, Branch Administrator, Principal, HR Manager |
| `payroll.approve` — approve a run for the staff you are responsible for, and override a deduction | School Administrator, Principal |

**Reading the calendar needs no permission at all.** Every portal user sees when
the school is closed; that is the point of publishing one.

---

## Not in this release, said plainly

1. **`0043` is unapplied.** Everything above that touches a new table or column
   is inert until `sprint-devops` runs it.
2. **Nothing here has been driven in a browser.** The build is green, every gate
   passes and every new statement executes against the real schema — that is all
   that is claimed. No QA round has been run.
3. **The staff register is not narrowed by a principal's assignment.** A
   principal opening `/dashboard/hr/attendance` still sees every active member
   of staff. The *day-off* half of that requirement is built; the narrowing is
   not.
4. **The Islamic dates for any year beyond the six asserted in
   `check-sprint27`** are the arithmetic's, not a school's — which is precisely
   why every one of them is written tentative.
