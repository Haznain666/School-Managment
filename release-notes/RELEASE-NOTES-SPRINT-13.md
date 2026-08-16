# Release notes — Sprint 13: Portals, the installable app, and two principals

**Status:** merged to `main`. **Migration `0023_sprint13_portals.sql` is
applied** to the live database — nothing to run, nothing to configure. Ready to
use.

The three portals a school does not log into — parent, teacher and student —
stop being previews. Every placeholder in their navigation is now a real screen.
Alongside that, the platform becomes an app a parent can install on a phone, and
a school running two heads can finally say so.

---

## What a parent gets

**My children.** Every child, side by side, on one screen: class, campus, roll
number, this month's attendance and what is owed. Previously a parent with four
children switched between them one at a time, so "who is behind" was a question
they had to assemble themselves.

**An attendance calendar.** The last thirty days used to be a list. It is now a
month grid with arrows to move through the year. A list answers "which days was
my child away"; only a grid answers "is there a pattern", and every Monday
sitting in one column is what makes "off sick every Monday" visible without
anybody counting.

- A blank school day means **the register was not taken** — not that anybody was
  absent. Schools miss registers, and drawing a missing one as an absence would
  put a mark against a child who was in class.
- Every marked day carries a letter as well as a colour, so the calendar is
  readable without colour vision.
- The month is in the address bar, so a particular month can be sent as a link.

**Report cards.** Each published term, with the subject table, the total,
the grade, position in class and the term's attendance — and a **Print** button
that produces the same A4 sheet the school issues. Not a second version of it:
the same component, from the same query, so a figure a parent reads on screen
cannot differ from the one on the paper in their hand.

Only terms the school has **published** ever appear. Draft marks are not
something a family can see, which is exactly what Sprint 9 made publishing a
separate, deliberate act for.

**Notification preferences.** A parent can now switch off the emails they do not
want — announcements, fee reminders, absence notices — from their own Settings
page.

> **What this deliberately does not do:** switching an email off never hides
> anything. Notices stay on the notice board, challans stay on the fee page. The
> screen says so in those words, because a preference page that appeared to
> switch off fee notices and did not would leave a parent believing nothing was
> owed.

Everyone starts with every email on, and nobody's existing account changed.

---

## What a teacher gets

**My classes.** The roster for each class they teach, in register order, roll
numbers first. It was previously reachable only inside the act of marking
something.

**Gradebook.** A whole class across every subject of an exam — the view wanted
at a parents' evening, which could not be assembled from the marks-entry screen.
Marks that are not yet published are shown *and marked as unpublished*, because
a number quoted to a parent from an unpublished column is one the school has not
stood behind yet.

**Lesson plans.** One plan per class, per subject, per week. Save it as a draft
that only you can see, or share it with the school's coordinators and heads.
Sharing sends nothing to anybody; it makes the plan visible. Saving the same
week twice corrects it rather than adding a near-duplicate.

**My payslips and My leave.** The two things a teacher previously had to walk to
the office to ask for. Payslips appear once a payroll run has been **paid** —
never while it is still being computed, because a figure that then changes on
payday is the software telling somebody something untrue about their salary.

> **Applying** for leave is still done through the office. What a teacher gets
> here is the record: what was applied for, what was decided, and the school's
> note. Who approves a head's leave, and what happens to an application for a
> day already on the register, are product questions — shipping a form that
> half-answered them would put applications into a queue nobody had agreed how
> to work.

**Taking the register on a phone** is easier: the P/A/L/E buttons are full-size
touch targets on a handset, and the Save bar follows you down a class of forty
instead of sitting below all of them.

---

## What a student gets

Three placeholders became real screens: **My Exams** (the datesheet, split into
what is coming and what has been sat), **My Results** (every published term) and
**Fee Status** (what has been billed and paid).

Only exams the school has **announced** appear — a school scheduling an exam and
telling students about it are two acts, and showing the first would spread a
date the school had not committed to.

A student sees their fee position but gets no printable voucher. That is
deliberate: a challan is paid at a bank counter by whoever holds the money, and
a second printable copy in circulation is how a fee gets paid twice.

---

## Install it on a phone

Every school subdomain is now an **installable app**. A parent opening the
portal in Chrome or Safari can add it to their home screen and it opens without
browser furniture — in the school's own name, colours and icon, generated from
the school's palette so no operator step is needed.

A parent with children at two schools installs two apps.

**What it does offline: almost nothing, on purpose.** A connection failure gets
a plain "you are offline" page. Nothing you have looked at is stored on the
device.

> That is the most important sentence in this note. Attendance, fees and results
> are per-family and per-school, and phones in this market are frequently
> shared. A cached fee page outlives the session that fetched it and is not
> cleared by signing out — so the next person to open the app on a dead
> connection would be handed somebody else's bill. Storing them safely needs a
> cache tied to the session and emptied on sign-out, which arrives with push
> notifications rather than being bolted on now.

**No notifications yet.** Installing is the groundwork; push arrives in a later
sprint, and shipping the shell first means parents are already installed when it
does.

---

## Two principals

A school running O-Levels and Matric under separate heads — or a group with a
head per campus — can now say so. In **Settings → Principals**, switch from one
principal to separate principals, and assign each one a campus, a division
("O-Levels", "Girls' Wing"), the classes it covers, and the dates they hold it.

An assignment narrows what a head **sees**, not what their role may **do**: the
Principal role keeps exactly the permissions it always had. A head assigned to
the O-Levels sees the O-Levels' students; the rest of the school is not theirs
to look through.

Some deliberate choices:

- **A school with one principal sees none of this.** Every existing school is
  unchanged, the switch is off, and no assignment screen appears. A school with
  one head should not be made to configure one.
- **Ending an assignment is not deleting it.** A head who leaves the post gets an
  end date, and the row stays — "who ran the O-Levels last year" is a question
  schools are asked. Delete is there for the row that should not have been
  written.
- **Only a school administrator can edit assignments.** A principal deliberately
  cannot: a head who could edit assignments could widen their own view, which
  would make the boundary a suggestion.
- **A division with no classes reaches no students**, and the screen says so
  rather than showing a blank — otherwise the head assigned to it opens an empty
  school with no explanation.

---

## What is not in this sprint

- **An assignment tracker for students.** There is no homework or assignments
  table in the product yet; it belongs to the e-learning sprint along with the
  homework diary. Inventing one here would have meant building it twice.
- **Applying for leave from the teacher portal** — see above.
- **Push notifications** — the app shell is the substrate; push is a later
  sprint.
- **Offline access to your own data** — see above, and it is a decision rather
  than an omission.
- **None of this has been clicked in a browser.** Signing in has never worked
  from a development machine, which is a standing limitation of this project
  rather than anything specific to this sprint. Every query behind these screens
  was executed against the real database, and the calendar arithmetic and the
  principal scope are asserted by an automated check — but no page and no
  printed sheet has been looked at.
