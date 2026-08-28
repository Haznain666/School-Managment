# Sprint 18 — A challan is now a Voucher, and a concession is something your school owns

**Migration `0034` — APPLIED and verified, 2026-08-28.** Three new tables
(`concession_schemes`, its fee-head list, and `fee_challan_reminders`), one new
column on student concessions, one on voucher lines, three on your fee settings,
and four new permission keys. No existing column is changed and no row is
rewritten.

**This release is live.** Everything below is in use.

---

## The word is Voucher now

Every screen, button, page title, email and printed slip that said *challan* now
says **voucher**. Nothing moved and nothing was renamed underneath — your
bookmarks still work, your voucher numbers are unchanged, and every slip your
school has already printed still matches what is on screen.

---

## Concessions belong to the school, not to one child at a time

You used to create a discount from scratch for every student who received it.
Twenty siblings meant typing the sibling discount twenty times, and any one of
those twenty could be typed slightly differently.

Now you create it **once**, as a scheme, and apply it to as many students as you
like.

**Fees → Concessions** has two tabs:

| Tab | What it holds |
| --- | --- |
| **Schemes** | The discounts your school offers — name, percentage or fixed amount, which fee heads it covers, and when it runs from and until |
| **Granted** | Which students actually hold which discount |

**Applying a scheme to students** is a picker: search by name or admission
number, narrow by class and section, tick as many students as you like, and
apply. Students who already hold that scheme are skipped, and you are told how
many were skipped rather than left wondering.

**A scheme's terms are frozen onto each student when you grant it**, in exactly
the way a voucher freezes its prices. Editing the scheme next year does not
silently rewrite what a child was granted this year.

### "Applies to" takes more than one fee head

The applies-to control is now a multi-select. A discount can cover Tuition and
Transport and nothing else, which was not expressible before — it was one head
or all of them.

**Leaving it empty still means every fee head**, which is what a school means by
"20% off her fees" with no qualifier.

### Open vouchers re-price themselves

Granting, changing or removing a concession immediately re-prices that student's
**unpaid and partly-paid** vouchers. Paid vouchers are history and are left
alone — where a discount arrives after payment, the surplus is carried forward
as a credit against the next voucher, exactly as it was before.

---

## A voucher now explains its own discount

A voucher line used to show a concession as an amount, with nothing to say where
it came from. Every line now names the discount and its rate:

> Siblings Discount 10%, Staff Discount PKR 2,000

It appears on the printed voucher, on the voucher's own page, and in the email.
It is written onto the line when the voucher is raised, so renaming a scheme in
March does not rewrite what February's slip said.

---

## The printed voucher is landscape, three copies across

The three copies — School, Bank, Student — are unchanged in content and are now
three columns across a **landscape** A4 sheet with cut lines between them, which
is the shape a bank counter actually takes. Each line carries a short details
row explaining what it is for. Bulk printing still gives one student per sheet.

---

## Vouchers reach parents by themselves

**Every voucher raised is now emailed to the primary contact** — one at a time,
in an admission, or in a whole month's bulk run. It names the child, the period,
the lines, the total and the due date.

**Optional: send the month's vouchers automatically.** *Fees → Settings* has a
new switch and a day of the month, set to the 28th. It is **off** until you turn
it on, and it never raises a voucher — it only sends ones your school has
already raised.

---

## The aged-debt screen can now act, not just report

**Fees → Defaulters** gains, on every row:

* **Send reminder** — emails that family about everything they owe.
* **Mark as paid** — records payment of the full outstanding balance across
  every open voucher of that student, and posts it to the books like any other
  payment.

**Every reminder leaves a mark.** Each row shows a chip per reminder sent —
`Reminder 1 · 02-Aug-2026`, `Reminder 2 · 16-Aug-2026` — so anyone picking up
the phone can see what has already been said and when.

The whole screen is now sortable on every column and filterable, with a search
box.

---

## Enrolment asks for the CNIC first, and means it

On the guardian step, **every field except the CNIC starts locked**.

* Enter a CNIC nobody at the school holds → everything unlocks, empty.
* Enter one that **matches** an existing guardian → the card fills itself in,
  and the name, email and phone become **read-only**.
* No CNIC to hand? One button unlocks the form. A parent is never turned away
  because a card is not in the room.

**Why the identity fields lock.** Changing a father's phone number while
enrolling his second child used to create a second father — and two fathers is
what silently splits one family into two on the sibling lookup and the family
voucher. Corrections belong on that person's own record, and there is a link to
it. Relationship, occupation and primary contact stay editable, because those
are facts about *this* child.

**The relationship is now prefilled from the record you matched.** A mother
enrolling her second child is offered Mother, not Father.

---

## Two things that were showing you the wrong thing

**The Guardian phone column was showing the student's ID.** It was reading the
student's own directory row, which holds a placeholder rather than a number.
It now shows the primary guardian's phone, and searching by phone searches that.

**Numbers you had typed came back looking wrong.** A guardian's number is stored
in one canonical form, and the form was displaying that raw form against a mask
that did not fit it — so a number the system itself had saved came back showing
an error. It now displays in the format it was entered: `(0321) 123-4567`.

---

## The student list tells you where the fees stand

A **Fees** column on **Admissions → Students**, and a filter to match:

| Chip | Meaning |
| --- | --- |
| **Cleared** | Nothing outstanding |
| **Due** | Something owing, nothing past its date |
| **Overdue** | Something past its due date |
| **Admission unpaid** | The admission voucher is still open |

---

## The Vouchers register was hiding admission vouchers

The register opened filtered to the current month. An admission voucher does not
belong to a month, so it could never appear — an unpaid admission fee was
invisible on the one screen built to list what is owed.

The register now opens showing **everything**, with a **Kind** filter for
Monthly, One-off and Admission. It also gains a **Family vouchers** tab, which is
where an issued family voucher now lives and where its payment is recorded.

---

## Family vouchers, as three questions

**Fees → Family Vouchers** is rebuilt, and families who could take one voucher
are listed first, most children first.

1. **Find the family.** Search a parent *or* a child, by name, admission number
   or phone, and press Search. Only guardians with more than one child enrolled
   come back.
2. **Choose the month**, from the months that family actually has something open
   in, with the count and total for each.
3. **Choose what to club.** Every unpaid and part-paid voucher for that month
   across all their children, ticked as you like, with a running total.

**A part payment is now split evenly across the children**, capped at what each
one actually owes, rather than clearing the oldest child's voucher first and
leaving the others untouched.

---

## Student records are four separate permissions

**Settings → Permissions** gains a **Student records** group: **see**, **enrol**,
**edit** and **delete**, each grantable to any role on its own.

**Nothing changed for anybody on the day this shipped.** Every role that could
see students still can; every role that could enrol or edit still can. *Delete*
is School Administrator only.

**Deleting a student is refused when any payment has been recorded** against
them. Money received is a fact the school cannot erase — withdraw the student
instead, which is what that situation actually calls for.

---

## Dates read 02-Aug-2026

Every date on every screen, and every printed date, now reads `DD-MMM-YYYY`. The
month is a name, so there is no ambiguity about whether `02-08` is February or
August.

---

## Money reads 12,500

Every amount now carries thousands separators, everywhere — screens, reports,
printed vouchers and emails. There is an automated check in the build that keeps
it that way.

---

## Known limitations, stated plainly

* **Removing a concession does not take back a credit it already generated.**
  Where a discount was larger than the fee, the surplus was banked as credit
  against the next voucher. Removing the concession re-prices the open voucher
  correctly, but the banked credit stays. Reducing it is a decision about money
  that may already be partly spent, so it is left to a person.
* **Cancelling a voucher does not return the credit it consumed** — carried over
  from Sprint 17, unchanged.
