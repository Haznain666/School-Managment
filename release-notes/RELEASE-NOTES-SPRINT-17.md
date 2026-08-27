# Sprint 17 — Getting in, getting billed, and the discount that never arrived

**Migration `0033` — APPLIED and verified, 2026-08-27.** One new table
(`student_credits`) and three new columns (`fee_challans.credit_applied`,
`fee_challans.challan_kind`, plus the index that polices admissions). No
existing column is changed and no row is rewritten.

**This release is live.** Everything below is in use.

---

## Inviting somebody now sends one email, not two

Adding a member to your school used to send an invitation link, and then — after
they had opened it and typed their name — a **second** email with a six-digit
code to copy across. The second email proved the same mailbox the first one had
already proved.

Now there is one email with one link. They click it, choose a password, and they
are in. It is the same email the people who set up your school received, so
there is one thing to explain to a new bursar instead of two.

**Invitations already sent still work.** If somebody has an invite link in their
inbox from before this release, it behaves exactly as it did and will keep
working until it expires.

**Forgot Password still sends a code, and that is deliberate.** An account that
already has a password should have to prove the mailbox.

### Send access email

Every member's profile now has a **Send access email** button. If they have
never signed in, it sends them a fresh password-setup link. If they already have
a password, it sends them the portal address and nothing else — we will not mail
a password-setting link to an account that has one.

---

## The admission fee panel now knows what the admission fee is

The *Admission fee* card on a student's profile had no connection to the
Admission Fee in your fee structure. It asked one question — has somebody marked
this admission as paid — and offered that button even on a class whose admission
fee had never been priced. So an admission could be marked settled against an
amount that did not exist.

It now shows one of four things, and only one of them is a guess-free tick:

| What you see | What it means |
| --- | --- |
| **A red warning** naming the class | No admission fee amount is set for that class this year. There is a link straight to the fee structure. No voucher button, no confirmation button. |
| **Generate the admission fee voucher** | The amount is set. You can see the fee, the discount and what the voucher will demand, before raising it. |
| **The challan number, and *Confirm the fee was paid*** | It has been billed. Only now can a payment be confirmed. |
| **Cleared** | Paid, waived or confirmed, with the voucher number when there is one. |

The rule the school asked for holds everywhere: **you cannot confirm a payment
for a fee that was never billed.**

If your school renamed its admission fee — "Registration Charges", say — it
still works: the panel finds your one-time fee head whatever it is called.

---

## The sibling discount now actually applies

A discount written without naming a fee head — "20% sibling discount", which is
how almost everybody writes it — applied **only to monthly fees**. It could
never reach the admission fee, the annual charges or the examination fee, and
nothing anywhere said so. On screen, a discount that did not apply looked
exactly like a discount that had never been granted.

A discount with no fee head named now applies to **every** fee head. If you want
one that applies only to tuition, name the tuition head — that has always
worked and is now the way to say it.

### And a discount granted late reaches the bills already out

Granting or amending a discount now **reprices every unpaid voucher** that
student is holding, immediately. You see what moved, and what did not:

* A voucher already **paid**, waived or cancelled is never edited. What was
  collected was collected.
* A voucher folded into a **family voucher** is left alone and reported, because
  the family voucher is the piece of paper the parent has and it is priced as a
  whole.

The prices on a voucher are never re-read from the fee structure. A voucher is a
record of what was demanded — if you raise tuition in March, February's voucher
still says what it said. **Only the discount moves.**

---

## A voucher can never total less than zero

*Live.*

When a discount is larger than what is left to collect, the voucher is floored
and the difference is kept as **credit carried forward** for that child. It
appears:

* on the student's profile, with a link to the voucher that created it;
* on the voucher detail screen;
* and on the **next** voucher, as a line reading *Adjustment — credit carried
  forward*, taken off the total.

A credit is never quietly lost and is never edited away — a correction is
another entry, so the history of it stays readable.

---

## School setup progress: every area now shows how far, not just whether

The setup panel on the school-admin dashboard used to answer six yes/no
questions. Three of them were not yes/no questions, and the ticks flattered a
half-finished job:

* **Classes** ticked with sections on five of your fourteen grades.
* **Timetable** ticked with a week covering a third of the school.
* **Fees** said nothing at all about which fees were priced.

Now every area has its own bar and its own `n/m`:

* **Classes** — grades that have at least one section, out of all your grades.
* **Timetable** — sections with at least one entry, out of all your sections.
* **Fee structure** — **one row per fee head**, showing how many grades are
  priced under it. A school with Tuition, Admission, Annual, Library and
  Examination sees five rows, and an Examination Fee nobody has priced reads
  **0%** instead of hiding inside a green tick.

The headline percentage is the average of those bars, so it moves when the work
moves.

### Enter 0. Do not leave it blank

A blank cell in the fee structure means *the decision has not been made yet*,
and the panel counts it as outstanding. If a class genuinely pays nothing under
a head, **type 0** — that is a decision, and it counts as done.

---

## A principal sees the same setup figure the administrator does

A principal was shown 50% where their administrator saw 100%, on the same
school, on the same day. Setup progress was being narrowed to that principal's
own division — and a principal who has not been assigned a division yet has no
grades at all, so three of the six areas read zero.

Whether the school has created its classes, priced its fees or enrolled anybody
is a fact **about the school**. It is no longer narrowed for anybody.

**And the real problem is now stated.** A principal who has not been assigned a
campus or division sees a warning at the top of their dashboard saying so, with
a link to where the assignment is made — instead of a portal that is empty
everywhere for a reason nothing explained.

---

## New schools start with their fee heads

Creating a school now gives it the five heads every school bills under —
Tuition, Admission, Annual Charges, Library and Examination — instead of an
empty Fees screen and an invitation to invent a naming scheme.

**Amounts are not seeded**, only the heads. A new school has no classes and no
academic year yet, so there is nothing to price; and a seeded 0 would tell the
setup panel every fee had been deliberately set to free.

Existing schools are unaffected. The **Seed default fee types** button still
works and still leaves anything you have edited exactly as it is.

---

## Guardian is a valid first guardian

The first guardian on a student record could only be Father, Mother or Sibling.
For a child living with relatives or with a legal guardian, that forced the
admissions desk to record the responsible adult as "Other" — which is the one
answer that list exists to prevent — or as a parent they are not.

**Guardian** is now selectable. A child still has only one father and one
mother, but may have two guardians.

---

## The student photo

Three separate problems, reported together.

* **It kept disappearing between steps.** The enrolment wizard now shows a
  thumbnail of the photo you chose, with its name and size, and a **Remove
  photo** button — the only thing that clears it. Opening the file picker and
  pressing Cancel no longer discards a photo you selected a minute ago.
* **A failed upload said nothing.** The photo could fail to upload — too large,
  wrong format, a server error — and the enrolment would complete with a blank
  avatar and no explanation anywhere. The profile now says what went wrong and
  offers to upload it again. The enrolment itself is still never rolled back
  over a photo.
* **It could not be changed afterwards.** A student's profile now has **Add
  photo** / **Change photo** on the avatar, for anybody who can edit
  admissions.

---

## Four things QA caught before you did

Driving the fee module against Lahore Grammar School's real data found four
defects that no automated check would have caught, because all four needed a
real voucher raised against a real discount.

1. **The admission voucher was born overdue — and that silently cancelled the
   discount.** A voucher raised on the 27th was falling due on the 10th, of the
   same month: seventeen days in the past. Because a voucher applies whichever
   discounts are in force on its due date, any discount granted *after* that
   past date was quietly ignored. The sibling discount this release exists to
   fix was billing 50,000 instead of 40,000, and nothing said why. A voucher can
   no longer fall due in the past, and an admission now applies the discounts in
   force on the day it is raised.

2. **Cancelling a voucher left the student with no way forward.** The screen
   treated a cancelled admission fee as a settled one, offered nothing, and no
   corrected voucher could ever be raised — even though the database was built
   to allow exactly that. Cancelling now makes room for the replacement, which
   is the only reason anyone cancels.

3. **Carry-forward was not happening at all.** A discount larger than the fee
   floored the voucher at zero and the remainder simply disappeared — the school
   believed it had granted relief the parent never received. The surplus is now
   banked and spent on the next voucher, as intended.

4. **The product contradicted itself about guardians.** It accepted a legal
   guardian as a first guardian and then told the clerk who chose one that it
   would not. The message now comes from the rule itself.

---

## What has not been checked in a browser

The screens were verified by reading what the server produced and by driving
every endpoint against the live database. What could **not** be exercised is
anything that only happens once a page is interactive in a real browser:

* choosing a photo in the enrolment wizard, and the *Remove photo* control;
* the guardian dropdown itself (the rule behind it was verified directly);
* typing a `0` into the fee structure grid and saving it.

None of these is known to be broken; none has been watched working. Worth ten
minutes with a real browser before you rely on them.

**One limitation, recorded rather than hidden:** cancelling a voucher does not
give back credit it had already spent. That is arguably wrong, but returning it
is a design decision about the audit trail rather than a bug fix, so it was left
alone.
