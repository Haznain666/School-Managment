# Sprint 20 — Your fee voucher, your discounts, and the account parents pay into

**Migration `0037` — applied and verified, 2026-08-30, and this release is live.** One new table
(`bank_accounts`), one new column on discount schemes, two new fee settings and
three new fields on your school profile. Nothing existing is changed and no row
is rewritten: every discount scheme you already have keeps its rate, its dates
and everybody who holds it.

**The schema goes in before this build does, and it is not optional.** Six
screens fail without it, and one of them is the one that matters most — **taking
a fee payment**, because the payment screen now reads three new fields off your
school profile before it records anything. It reads before it writes, so nothing
is half-done; but a fee counter that cannot take money, with a parent standing at
it, is the worst half-hour this release could have. The migration is safe to
apply while the previous build is still serving: that build knows none of this
exists.

**Not yet driven at a school.** Everything below is built and passing twelve
automated checks, but no screen in this release has been opened by a person, and
**the redesigned voucher has never been printed on paper.** Read the last section
before relying on any of it.

---

## The fee voucher, redrawn

The voucher a parent takes to the bank has been rebuilt to the layout schools
actually use, and it now carries the things it was always missing.

**Two copies, not three.** *Student copy* and *School copy*, side by side on one
landscape sheet with a cut line between them. The bank copy existed because the
bank's own details were not on the slip — now that the account title, number and
IBAN are printed on it, the teller reads them off the paper in front of them.
Two copies also mean each one gets half a sheet instead of a third, which is the
room the new blocks needed.

**Your bank details print on it.** Every account you mark as student-facing, in
the order you choose — bank, account title, account number, IBAN, and the SWIFT
and intermediary details for a school that banks internationally.

**Two totals, not one.** *Total payable within due date* and *total payable
after due date*, the second worked out from your own late-fee policy. If you
have not set one up, **the second row is not printed at all** — a row saying the
two figures are the same teaches a parent that paying late costs nothing.

**Valid upto** is the due date plus your grace days, so the slip says how long
the figure on it is good for.

**Each discount is its own line, named.** "Sibling Discount 20%" in brackets
under the charges, rather than a bare deduction a parent has to telephone about.

**Your NTN, website and finance email** are printed when you have set them —
they are on the School profile screen now, and each one appears on the voucher
only when it is filled in. The note asking parents to email their transfer
receipt is printed only when there is a finance address to send it to.

The **amount in words** stays. It is what stops a 1,000 becoming a 10,000
between the school gate and the cashier's window.

**A settled voucher can no longer be printed.** Once a voucher is paid,
cancelled or waived, the Print button disappears and it cannot be picked for a
bulk print run — the checkbox is greyed with the reason on it. A printed demand
for money already paid is indistinguishable from a live one at a bank counter. A
receipt for a paid voucher is a different document and is not in this release.

## Bank accounts — Settings → Bank accounts

A new screen holding the accounts fees are paid into and salaries are paid out
of. Each account records the bank, the branch, the account title and number, the
IBAN, the currency, and the international details if you have them.

**Each account is for students, for staff, or for both** — a single choice, not
a pair of tick boxes. Only the student-facing ones ever reach a voucher; your
payroll account never does.

**A switch decides whether an account prints.** Closing an account? Switch it
off and it comes off tomorrow's vouchers immediately, while the record of where
last month's money went stays. That is safer than deleting, and the delete
dialog says so — vouchers already in parents' hands carry whatever was printed
on them and do not change.

A group with several campuses can give an account to one campus, or leave it as
*All campuses* and have it print everywhere.

## Discounts, from the enrolment desk

**Discount schemes now have a kind:** Sibling Discount, Scholarship Discount, or
Other. The concessions list has a Type column and a filter on it.

Everything you already have has been marked **Other**, and nothing was guessed
from its name. A scheme called "Sibling Discount" is almost certainly one — but
so is "Sibling disc.", and a scheme wrongly marked as the sibling one is a
scheme the system would later *remove* from a child. One dropdown corrects it.

**A new Discounts step in the enrolment wizard**, between Documents and Review,
and a matching card on every student's profile just above the voucher section.

It says one of three things:

* *"Sara has a sibling at this school — Ahmed. They qualify for the sibling
  discount."* with an **Apply discount** button;
* the discounts already applied, as chips naming each one and its rate, each
  removable;
* or just the button, with your scholarship and other schemes behind it.

**One of each kind, at most.** The picker is a radio group per section:
selecting a second scholarship replaces the first rather than stacking on it.
The Sibling Discount section only appears when the child actually has a sibling
here — it is absent rather than greyed, because there is no setting that would
enable it.

Applying reprices anything the child still owes. A voucher already paid is never
touched.

**Removing keeps the history.** A removed discount is closed with a date rather
than deleted, so a parent asking in March why February's slip was lower still
gets an answer. Vouchers already issued keep the discount they were raised with;
the next one does not.

## Two new fee settings — Fees → Settings

**Apply the sibling discount automatically.** When a child is enrolled and you
already teach a brother or sister, grant the sibling discount without being
asked. **Off**, and it stays off until you turn it on — a discount applied by
surprise cannot be taken back once the vouchers have been printed and paid.

If you switch it on and have no active Sibling Discount scheme — or have two —
the screen tells you so, because a setting that silently does nothing is worse
than one that refuses.

**Keep the discount when only one child is left.** By default, once a family has
only one child still at the school, that child's sibling discount is closed
automatically and a note is written on it saying why. A discount for having
siblings is not owed to a child who no longer has any. Switch this on to keep
it.

The removal happens the moment a family's shape changes — when a student is
removed from the roll, or graduates in a promotion run — and a background check
every quarter of an hour catches anything else. Only the *sibling* discount is
ever removed; a scholarship is a judgement about that child and is untouched.

## Siblings across campuses

A child at one campus with a sister at another has always counted as having a
sibling — the rule matches on the guardian, not on the campus, and always has.
What was missing is that you could not *see* why: a sibling at another campus
appeared with no class beside their name and no explanation.

**The campus is now named** beside any sibling who is not at the one you are
looking at.

## Users & Staff: students no longer show `student:LGS-2026-0009`

Four rows of the live directory printed an admission number where a phone number
belongs. That is an internal placeholder — a seven-year-old has no telephone and
the column cannot be empty.

The Phone column now shows the **primary guardian's** number for a student, and
a dash where no guardian is on file. It never shows the placeholder.

## The aged debt report

**The guardian's phone was losing digits.** `+92321****5555` was being re-read as
a nine-digit number and printed as `(0321) 555-5` — a number that is not the
parent's and could not be anybody's. It now reads `(0321) ***-4567`: still
masked, still recognisably a mobile, still enough to confirm you are looking at
the right family.

**The numbers are still masked, deliberately.** The report exists to decide who
to chase; the reminder is sent server-side from the real number. A page listing
four hundred parents' full numbers is a contact list.

The header row also stopped disagreeing with itself — the sort arrow now follows
the label on every column instead of leading on three of them — and the small
print inside the cells is one size throughout.

## The owner's dashboard

**Collection by campus** and **Income against expense by campus** now share a
period selector: *This month* or *This academic year*. One control, so the two
charts can never be about different periods without saying so, and each card
states its period in words for a dashboard that gets screenshotted.

**A campus with no activity shows a dash, not `PKR 0` twice.** And the figures
at the end of the bars stopped being cut off at the edge of the card — the room
they need is measured against the longest one rather than assumed.

## "Challan" is no longer a word this product uses

The screens were renamed last sprint; this finishes it. Error messages, help
text, empty states, buttons, the parent portal and the notification settings all
say **voucher** now. Web addresses and anything you have bookmarked are
unchanged.

---

## What has **not** been checked

* **Nothing in this release has been opened in a browser.** It compiles, it
  passes twelve automated checks, and no person has clicked any of it.
* **The redesigned voucher has never been printed.** Two copies on a landscape
  sheet with a bank block is a layout claim, and a layout cannot be judged from
  code. The first thing to try is a voucher with six fee heads, two discounts
  and three bank accounts: does it still fit half a sheet?
* **The migration is applied**, and every one of the eleven new or widened
  statements has been executed against the live schema. But **no school has
  entered a bank account, classified a scheme or switched on either sibling
  setting yet** — the tables are correct and empty, and none of this has been
  read back off a screen a person was looking at.
* **The automatic sibling-discount removal has never run** against a real
  family.
* **Cross-campus siblings have never been seen working**, because there is still
  no two-campus school to test against.
* **The *after due date* figure is priced at one day past your grace period.**
  For a school charging a fixed late fee that is exactly right; for one charging
  per day it is the first day's charge, which is worth reading once before you
  rely on it.
