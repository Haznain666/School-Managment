# Sprint 19b — Your calendar belongs to a campus, and a child's paperwork belongs to their record

**Migration `0036` — written, not yet applied.** Two new tables
(`academic_year_branches`, `student_documents`) and three new optional columns
on guardians. Nothing existing is changed and no row is rewritten: every
academic year your school already has stays exactly as it is, running at every
campus, until somebody says otherwise.

**The schema goes in before this build does, and it is not optional.** Three
screens fail without it — Academic years, Promote students and a student's
profile — and, more seriously, **enrolling a child stops working entirely**,
because the enrolment form now records the guardian's address and the column has
to exist first. `SPRINT-19B-DDL-NOTES.md` has the order and the checks.

---

## Academic years: one campus's calendar is not another's

A school group whose Karachi campus runs April–March and whose Lahore campus
runs August–July has two calendars, not one. Until now the year picker offered
every campus's sessions to every campus's clerk with nothing to tell them apart
— and enrolling a Lahore child into the Karachi session is not a mistake
anything catches. It shows up months later as a report card printed against the
wrong term.

Academic years now carry a **Campus** column and a campus filter.

**Nothing you have already set up moved.** A year with no campus against it runs
at *every* campus, and that is what all of yours are. A single-campus school is
not asked the question at all.

## Build a decade of calendar in one go

The create screen used to make you enter one session at a time: start month,
start year, end month, end year, save, repeat. Five years was five chances to
type 2028 where 2029 was meant, on a value that later decides which year a
child's fees, results and admission number are filed under.

Now it asks for the shape once — **start month, end month, the first year, and
how many** — and shows you exactly what it will create before you press the
button. The end year is worked out for you: August to July crosses into the next
calendar year, January to December does not.

**A run never refuses because something already exists.** If three of the ten
years you asked for are already there, it creates the seven that are not and
tells you: *"7 years created, 3 already existed."* Refusing the whole run over
one duplicate is how a school ends up with half a calendar and no way to tell
which half.

Creating a single year that already exists is still refused — by name, so you
can go and find it.

## The current year now follows the calendar

Exactly one academic year is active, and that is unchanged. What is new is what
happens when **nobody has chosen one**: the product now uses the session that
today actually falls inside, instead of behaving as though the school has no
year at all — which used to close the public application form, empty the
dashboard counts and refuse every enrolment.

A year you have explicitly set as active is **never** overridden. The list shows
the difference: *Active* is a year somebody chose, *Current by calendar* is the
one being used because nobody has.

The date is read from the database rather than from your computer, so everybody
looking at the school sees the same answer on the first of the month.

---

## Promote students: the screen was not broken, and now it says so

Two things were reported and both are fixed.

**"Goes to" was always empty.** It was not a broken dropdown. The list shows
classes in the year you are promoting *into*, and if the school has not built
next year's classes yet there is nothing to show — but the screen said nothing,
so it looked like a fault.

It now names the year and offers the button you actually wanted:
**"Copy this year's sections into 2027-28."** One click clones every active
class of the year you are leaving into the year you are entering, capacities
and all. Class teachers are deliberately *not* copied — who teaches 5-A next
year is a decision the school has not made in June.

**There is a campus selector**, and the classes, years and destinations are all
narrowed to the campus you are looking at.

**A promotion now stays inside one campus.** Moving a student from the Karachi
campus to the Lahore one is a *transfer* — it has its own screen, its own record
and its own fee split — so it is no longer offered here, and the server refuses
it by name if it is attempted anyway: *"A promotion stays inside one campus …
Ahmed Raza — Karachi Campus → Defence Campus."*

---

## A student's documents live on their record

New on every student profile: **Student documents**. A B-Form, a birth
certificate, the last school's leaving certificate, a vaccination card — the
paperwork that has always lived in a filing cabinet.

* **Ten per student, 5 MB each, PNG or JPG.** Both limits are on the screen.
* Each document is a chip with the title *you* gave it. Clicking it opens the
  image in a new tab, so you can check it against the record you are already
  reading.
* **Add document** is right there on the card — no separate screen.
* Deleting one asks first.

Uploading is checked properly: the product reads the file's own first bytes
rather than believing what the browser calls it, so something renamed to
`.png` is refused with an explanation rather than accepted and filed.

**The enrolment form has a new Documents step**, between Academic placement and
Review. It is **entirely optional and can be skipped in one click.** An
admissions desk with a queue in front of it must never be held up by a birth
certificate that is at home — and anything missed can be added from the profile
afterwards. If a document fails to upload after the enrolment lands, the profile
now says so instead of quietly leaving it out.

---

## Academic history, on one page

New from every student profile: **Academic history**. One row per exam the
school has published results for — year, term, exam, class, percentage, result
and the teacher's comment.

Clicking the **percentage** or the **comment** opens that exam's report card in
a new tab, so you can answer a parent on the phone without losing your place.

**Only published results appear.** A mark a teacher is part-way through entering
is not a fact about the child yet, and a history that showed it would change
after a parent had read it. Where the papers are published but the term's report
card has not been issued, the row says so.

Schools that grade with descriptors rather than marks see their own descriptors
— *Exceeding*, *Needs improvement*, and whatever else you have set up — instead
of a percentage and a pass/fail.

---

## Guardians have an address

The enrolment form's guardian step now asks for a **home address**, with the
same search-as-you-type field the school and campus forms use. It is never
required — leave it blank and nothing complains — and it is editable even for a
guardian the school already knows, because a family that has moved will say so
at the desk.

---

## "Enrol" is now "Enroll"

The product used the British spelling in about 270 places. It now uses the
American one everywhere it is *read* — buttons, headings, hints, messages and
help text.

Nothing you have bookmarked has changed. Every web address, every export column
and every stored value is exactly what it was.

---

## Nothing else changed

No permission was added or moved. No existing screen lost a control. Every
academic year, every guardian and every student record is exactly what it was
before this build, and the two new tables start empty at every school.
