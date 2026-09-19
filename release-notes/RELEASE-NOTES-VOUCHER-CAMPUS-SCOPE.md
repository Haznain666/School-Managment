# Release notes — the fee voucher's campus boundary

**Date:** 19 September 2026
**Not a sprint.** Sprint 33c's QA round 1 raised six findings; five were fixed
with that sprint and this one — **F5** — was held back because the defect
predates it. `git show 8c0bc0c:` proves the guard was byte-identical for as
long as the voucher page has existed.
**Migration:** none. Code only.
**Status:** merged and deployed.

## Fixed

### A campus-bound head could open another campus's fee voucher

At a school running more than one campus, somebody bound to one of them — a
Principal, a Vice Principal, a branch administrator, an accountant — could
open a **fee voucher belonging to another campus** if they had its link.

What they were shown was the whole record: the student's name, class and
guardian, every line of the bill, every payment taken against it, and the
printable voucher headed with **that other campus's name, address and bank
account details**.

Nothing about it looked wrong. The student was not in their student list and
never had been; only the voucher was reachable.

From this release the voucher is scoped the same way the student list already
was. A voucher at a campus you cannot open now behaves exactly as a voucher
that does not exist — **"not found"**, not "not allowed", because telling
somebody they may not see a record confirms the record is there.

### The same gap was on eight more screens, and three of them mattered more

The voucher page was where it was found, but it was never only the page.

| Screen or endpoint | Before | Now |
| --- | --- | --- |
| The voucher, and its print sheet | any campus | not found |
| Record payment | any campus | not found |
| Print several vouchers at once | any campus, up to 400 at a time | out-of-campus vouchers are left out of the run |
| The voucher API, read and change | any campus | not found |
| The payments API, read and record | any campus | not found |
| **The voucher register** | **the whole group's billing** | the campuses you hold |
| The outstanding report and the chase list | the whole group | the campuses you hold |
| Aged debt | one campus, always the same one | every campus you hold |
| **"Send reminders"** | **could email any campus's parents** | the campuses you hold |

Three are worth saying plainly.

**The register is where the links come from.** It was narrowed by teaching
division but not by campus, and the division narrowing applies to Principals
only — so a campus-bound accountant or vice principal was reading the entire
group's billing, and every voucher link in it worked. At Askari that was 946
vouchers instead of 686.

**"Send reminders" could reach the wrong parents.** Selecting vouchers and
sending overdue notices was not campus-checked, so a clerk at one campus could
email another campus's families about bills that were not theirs — and the
school's own record would show those families as having been chased.

**Aged debt was too narrow rather than too wide.** It showed a single campus
even to somebody given access to two, with no way to widen it and nothing on
screen explaining why. Those people now see both.

## What has not changed

- **A school-wide administrator sees everything, exactly as before.** Head
  office loses nothing: the register still returns all 946 vouchers at Askari
  and every voucher still opens.
- **A school with one campus is unaffected.** There is no second campus to be
  kept out of.
- **Parents are unaffected.** A parent belongs to no campus; what limits them
  is that the voucher must be their own child's, which is unchanged.
- **No permission changed**, no role gained or lost anything, and there is
  nothing to configure. Who may read fees is the same question it was; this
  only fixes *whose* fees.

## For administrators

If somebody reports that a voucher they used to be able to open now says "not
found", check which campus that voucher belongs to and which campuses that
person holds. Campus access is granted per person under **Users & Staff**; a
person can hold more than one, and somebody who needs every campus should not
be bound to one at all.

## Known, and not fixed here

- **Family vouchers are not campus-scoped.** A family voucher deliberately
  spans siblings who may sit at different campuses, so narrowing it is a
  decision about what a family voucher is rather than a gap to close quietly.
  It is recorded as its own question.
- **A separate pre-existing fault, unrelated to this one:** seven staff-rating
  permission keys added in Sprint 32 were never written into the database's
  permission list. A school that changes one of those keys on the permission
  matrix will get an error when saving. It needs a migration and has its own
  task.
