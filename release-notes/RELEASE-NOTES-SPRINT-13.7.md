# Release notes — Sprint 13.7: Parent accounts, period schedules, colours and the teacher calendar

**Status:** live at `schoolhub.codexmill.com`, confirmed 2026-08-20. **Migration
`0025_period_structures_parent_access.sql` is applied** to the live database and
verified against the real schema — nothing to run, nothing to configure. Ready
to use.

Four things, three of them asked for and one of them found while building them.
The found one is the largest.

---

## Parents can now actually get into the parent portal

This is the fix behind "I created a parent and the father never received a
welcome email", and the missing email turned out to be the smaller half of it.

Sprint 13 shipped a parent portal with six screens. It was routed. It was
permissioned. It had an attendance calendar, report cards and fee challans in
it. **And no parent at any school could reach it**, because nothing in the
system had ever created a parent an account. A guardian was a name, a phone
number and an address on a child's record; the table that lets somebody sign in
had nothing for them, and no screen offered to change that. Every guardian in
every school showed "No portal account", and nothing suggested that was a state
anyone could leave.

**What happens now.** A guardian with an email address gets a parent portal
account and a welcome email carrying a link to choose their own password. They
sign in with their address and that password, and see their children.

- **One account, however many children.** A father with three at the school gets
  one login showing all three, and one welcome — not three.
- **A guardian with no email address gets no account,** and the screen says so
  rather than failing. Most guardians on a Pakistani school roll have a phone
  and no email; an enrolment that refused to complete without one would be worse
  than the problem it fixed. Add an address later and there is a **Send portal
  invite** button on the record.
- **A resend** for the parent who rings to say nothing arrived. Somebody who has
  already set a password gets a reminder of where to sign in, not a fresh
  password link — a link that could reset an established account by email would
  be a permanent way around Forgot Password.

## The welcome waits until the admission fee is paid

Per the school's own rule: a new student is enrolled, but the admission is not
**confirmed** until the money is in — and confirmation is what sends the
parents their login.

- A newly admitted child starts **Fee outstanding**. They are on the register,
  the class lists and the challan run from the first minute; nothing about them
  is hidden or held back except the parents' portal welcome.
- Recording payment against their challan **confirms the admission and sends the
  welcome by itself**. Nobody has to remember a second step. A part payment does
  not: it clears when nothing is still owed.
- **Waiving** the fee confirms it too. A waiver settles an account as surely as
  cash does, which matters for a child admitted on a scholarship — otherwise
  their parents would wait forever for a payment nobody was going to make.
- For a school that takes the admission fee in **cash across a desk and never
  raises a challan**, there is a **Confirm the fee was paid** button on the
  student's profile. Without it that school's gate would never fire and its
  parent portal would stay empty permanently. It needs the fee permission, and
  it cannot be undone — it sends email to real people.

**Students already on your roll are unaffected.** Every existing enrolment is
recorded as already paid, and every existing guardian as already welcomed. This
does not re-open settled admissions, invent a debt, or mail your entire parent
body on the day it goes live. The rule applies to admissions from here on.

## Grades that keep different hours can now say so

A school teaching Pre-Nursery and Class 10 on one campus does not ring one bell.
The infants sit three long periods and go home at noon; the seniors sit eight
short ones and take their interval an hour later. Until now the timetable held
**one** bell schedule per school, so the junior grid carried five rows that could
never be filled — and a school that tried to enter its second schedule was told
the periods already existed.

**Period schedules** are named — "Junior school", "Senior school", "Ramadan
timings" — and **grades are assigned to them**. Grades and not sections, because
nobody rings a different bell for Class 5 A and Class 5 B, and because a new
section is then timetabled correctly the day it is created without anyone
remembering to configure it.

- Everything is on the **Timetable** screen, under the grid, where the old bell
  schedule was.
- Picking a class shows **that class's own periods**, and names the schedule
  above the grid.
- **A school with one bell sees almost exactly what it saw before.** Your
  existing periods are now a schedule called "Standard", it is the default, and
  every grade uses it. If you never open this, nothing changes and you need not
  know the feature exists.
- A grade you have not assigned runs on the default, so nothing is ever laid out
  against nothing.

⚠ **Moving a grade onto a different schedule does not carry its timetable
across.** The two schedules have different periods at different times and there
is no honest way to map one onto the other. The lessons are **not deleted** —
they stay filed against the old schedule's periods, and moving the grade back
shows them again — and the builder says so on screen with a count rather than
going quietly blank. Plan a reassignment before a term's timetable is built, not
after.

## Any colour you like for a subject

The subject colour was eight fixed swatches. It is now those eight **and** a
colour picker with a hex box, so a school can use its own house colour or match
a printed prospectus.

- The palette is still first and still one click. The eight are chosen to stay
  apart from one another in a full week's grid, which is the property that
  actually matters, and they remain what you get if you do not care.
- The preview is **a real timetable cell** at real size with the real lettering,
  not a round swatch. A colour looks different behind two lines of small text
  than it does as a dot.
- You are **warned, never stopped**, if a colour will be hard to read, or if it
  is very close to one another subject already uses. It is your timetable.

Fixed in passing: one of the eight shipped swatches — the pink — had never been
quite legible enough, at 4.4:1 against a target of 4.5:1. It has been darkened.
**Subjects you have already saved keep the colour you chose**; nothing rewrites
stored colours.

## A teacher's day, week and month

New screen: **Academics → Teacher Calendar**. Pick a teacher, and see their day,
their week or their month.

- **Day** lists their periods in clock order with the gaps visible as gaps —
  which is what "is Sumera free on Thursday afternoon?" actually asks.
- **Week** is the seven-day version of the same.
- **Month** is a calendar grid: how many periods each day, coloured by subject,
  so a heavy fortnight is visible as a shape. Click a day to open it.
- A teacher who teaches across two period schedules reads correctly, in clock
  order — position 3 is different minutes in each.
- **Approved leave is drawn on the days it covers**, because that is usually the
  question behind the other ones. A colleague's leave is an HR record: it shows
  only to somebody with HR access, or to the teacher looking at their own
  calendar.

Teachers get the same day and month views of **their own** schedule, on their
existing **My timetable** page, under the weekly grid. There is no teacher
selector there — nothing on that page could be changed to show a colleague's.

⚠ **School holidays are not subtracted.** There is no school-holiday calendar
anywhere in the system yet, so a day the school is shut still shows its periods.
The screen says this rather than implying otherwise.

---

## What is not in this release

- **No school holiday calendar.** Named above, because it is the one thing that
  would make the teacher calendar complete and it is not here.
- **Moving a grade between period schedules does not migrate its lessons.**
  Deliberate, explained above, and reported on screen.
- **The fee gate looks at challans, not at a named admission-fee head.** This
  product has no "admission fee" fee type; what a student owes is the sum of
  their open challans, and that is what the gate reads.
- **These screens have not been signed off visually.** Every rule in this release
  was driven end to end against the live database inside a real signed-in
  session — a new admission held its welcome back, a part payment did not release
  it, the payment that settled the balance did, the email arrived, its link set a
  password, and the parent portal then showed the child. What could not be done
  was look at the finished pages: the environment's preview browser does not
  render, so no screenshot exists. Worth twenty minutes of clicking before you
  rely on the layout.
