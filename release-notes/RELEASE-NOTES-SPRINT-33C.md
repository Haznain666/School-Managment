# Release notes — Sprint 33c: the portal work

**Date:** 18 September 2026
**Part C of three, and the last.** Part A (the three defects, the campus gap
and the two notification faults) and Part B (the Section Head, the chain of
command and HR leave) are already live.
**Migration:** `0049`, one file. **Apply it before the code deploy** — there is
an unavoidable window either way and this is the cheap side of it; see
**Deployment**.
**Status:** applied, merged as `44a4ad50`, live as build `44a4ad50668d`.

## New

### A parent can see their child's timetable
`Parent → Timetable`, between Results and Fees. It shows the child's week —
period, subject, teacher and room — laid out against **that class's own bell
schedule**, so an infant class is not drawn against the senior school's eight
periods.

Families with more than one child get the same child switcher the rest of the
portal uses, and each child's timetable is checked against the parent's own
record before it is shown.

### A teacher change no longer rewrites the past
This is the half of the timetable work nobody sees, and it is the more
important half.

Until now a lesson had no dates on it. Changing who takes Tuesday's Maths
changed who had taken it **every Tuesday since September**, everywhere — on the
parent's screen, in the teacher's calendar, in the KPI load, in who a parent was
allowed to message. There was no record that it had ever been otherwise.

From this release a lesson is a **version**. Changing the teacher or the subject
**closes** the standing lesson and **opens** a new one from today. Nothing is
overwritten and nothing is deleted.

- There is **no history screen** and none was asked for. What changes is that
  the past stops being edited.
- Every timetable read in the product now shows the version in force **today**,
  so nothing looks different on the day this ships.
- Correcting a mistake made the same day still simply corrects it — a version
  that has not lasted a day is not history worth keeping.
- A **room** change is still a correction, not a new lesson.

### A paid voucher prints a receipt
A voucher that is paid — or part-paid — now offers **Print receipt**, on the
parent's screen and on the school's.

The receipt is the same familiar document with four differences: it is headed
**RECEIPT**, it lists **every payment with its date, amount, mode and
reference**, it shows **Outstanding: 0.00**, and it carries **no bank details
and no "valid upto"**. A parent cannot be handed a receipt that a bank counter
might read as a demand.

- A **part-paid** voucher offers both, and the two buttons are named: *Print
  voucher* for what is still owed, *Print receipt* for what has been taken.
  Only one of them ever reaches the paper.
- **The month is on both documents**, labelled — *Fee for: September 2026* and
  *Payment for: September 2026*. A drawer of receipts is only useful if each one
  says which month it settles.
- The vouchers list has a **Print receipts** button beside *Print vouchers*, for
  a whole selection at once.
- Sprint 20's rule stands: a settled voucher still does not print as a demand.

### The recipient picker, on every portal
Starting a conversation used to mean scrolling one long dropdown. It now has
**role chips** and a **search box**, and the same change reaches the admin,
teacher, parent and pupil portals, because they share one screen.

What the entries say has changed too, and this is the part that makes a school's
directory usable:

- a **pupil** now reads *their parent's name · their class* instead of the word
  "student" repeated two hundred times;
- a **parent** reads *their children's names*;
- everybody carries their **campus**, where they have one;
- the **school offices** are their own group, because a desk is not a role and
  is not held by one.

Searching matches the name, the description and the campus — so a teacher can
find a father by typing the **child's** name, and a head can find a pupil by
typing "5 A". Nothing new is disclosed: the list is the same list the server
already worked out for that person, and the server still re-checks every send.

### Cover for the day
A new section on the administrative dashboard. Pick a date, a class and a
period, and it lists **who is free to take it** — every teacher in your reach,
minus anyone already teaching an overlapping period, anyone already covering
one, anyone on approved leave, and anyone the holiday calendar or the Saturday
roster says is not in that day.

**Send as substitute** records the cover and tells the teacher — a bell
notification, and a chat message from the person who arranged it where the
school runs chat.

- Who is **not** free is shown too, with the reason. The name you had in mind
  being missing is not an answer.
- A substitution is **for one date**. It is not a timetable change and it does
  not touch the timetable.
- **Who you can ask is your own chain of command**: a coordinator sees their own
  teachers, a section head their coordinators' teachers, a head their campus.
- Arranging cover is a **permission** — *Arrange a substitute teacher for one
  day* on the Academics row of the permissions matrix. Principal, Vice
  Principal, Section Head and Coordinator hold it by default, and a school that
  wants somebody else to can grant it without waiting for a release.

## Changed

- **Print voucher** has moved out of the voucher's action row into its own pair
  of buttons beside it, so that the two documents can be told apart.
- The bulk print page takes a `document` parameter and prints one kind of
  document per run. A mixed stack is a stack somebody has to read before they
  can hand it out.

## Deployment

**Apply `0049`, then deploy the code.** Unlike Part B there is no data step and
no four-stage order.

`0049` **replaces** the timetable's unique index with a partial one over the
lessons still in force. That is what lets a superseded lesson sit beside its
replacement; without it the first teacher change would be refused.

### There is a window, it is unavoidable, and this is what it costs

An earlier draft of this section said the migration was safe to apply while the
old code was running, because "the old code simply never selects the new
columns". That is true of every **read** and false of the one **write**: the
previous `POST /api/school/timetable/entries` sent a bare `ON CONFLICT`, and
Postgres cannot infer a *partial* index unless the statement repeats the
index's predicate. Both forms were attempted against the migrated database —
the new route's is accepted, the old route's fails `42P10` — so this is
measured rather than argued.

There is therefore **no ordering that avoids a window**, and it is worth saying
why so nobody goes looking for one: while the index is whole the old code works
and the new code's supersede is refused; once it is partial the new code works
and the old code fails. The swap is atomic and the two versions want opposite
indexes.

| Order | What breaks, and for how long |
| --- | --- |
| **Migration first** ← the one to use | *Saving* a timetable cell fails, on one administrative screen, until the deploy lands |
| Code first | **Every timetable read** fails, across four portals and seven query modules |

Because the host auto-deploys from a push to `main`, code-first is what happens
by default unless the migration is applied **before** the merge. Apply it
outside school hours.

### What was actually done, 18 September 2026

`0049` applied first, then merged as `44a4ad50` and deployed; live build
`44a4ad50668d`. `scripts/verify-0049.mjs` — which applies and proves in one
pass, and reads whether the migration is applied rather than being told —
reported **50 assertions, 0 failed**:

- `relfilenode` unchanged at `21105` and `attmissingval = {2026-09-18}`, so the
  column was metadata-only and **no row was rewritten**;
- **1027 of 1027** existing lessons came out live, which is the whole of the
  claim that nothing looks different on the morning this ships;
- the re-created index carries its predicate — read back out of
  `pg_get_indexdef`, because an index re-created *without* one has the same
  name, the same columns and the same uniqueness flag, and would refuse the
  first teacher change at every school;
- the supersede driven against a real lesson: closed, replaced, and a second
  *open* row for that cell still refused — while two *closed* ones are accepted;
- all 61 permission keys accepted and a key outside the list still refused.

Every attempt ran inside a transaction that was rolled back, and the row counts
were read back afterwards to show the proofs wrote nothing.
