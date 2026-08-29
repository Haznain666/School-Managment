# Sprint 19a — A campus is a boundary, and the owner sees across all of them

**Migration `0035` — applied and verified, 2026-08-29.** One new table
(`school_user_branches`), one nullable column on nine setup tables, and one new
permission key. No existing column is changed and no row is rewritten: every
subject, fee head, grading scheme, exam term, concession, leave type, pay head
and performance descriptor your school has stays exactly as it is, shared by
every campus, until somebody says otherwise.

The schema went in **before** this build did, and deliberately: the campus
resolver reads the new table on every screen that has a campus scope, so the
database had to know about it first. It was applied while the previous build was
still serving, and nothing about that build could see it.

**Driven in a browser since, at a school with two campuses.** Four defects came
out of that and all four are fixed — see *Fixed after QA* at the end. None of
them needed a schema change.

---

## What was wrong

A school group with three campuses had one product for all three. A campus
administrator signed in and saw the whole group's subjects, fee heads, exam
terms and leave types — and, through the search box, the whole group's students,
staff and vouchers. Nothing on any screen said which campus a figure belonged
to, because every figure belonged to all of them.

And the person who owns the group had the worst screen of the lot: a dashboard
that told them the group had collected PKR 4.2 lakh this month, and nothing at
all about which campus was behind.

---

## Every list now knows which campus it is on

A campus is a boundary now. Sign in as the administrator of one and you see
that campus's students, staff, classes, vouchers, applications and portal
accounts — and nobody else's. The search box is scoped the same way, which
matters most, because it is the one control that crosses every module at once.

**Nothing your school has already set up moved.** A subject, a fee head or an
exam term with no campus against it is *shared by every campus*, and that is
what all of yours are. A three-campus group that has always run one price list
goes on running one price list.

What is new is that a campus can now have its own. Add a fee head from the
Karachi campus and it is Karachi's; the other two never see it and are never
billed for it.

---

## Somebody can be given a second campus

New in Users & Staff's underlying model: the school owner can grant a campus
administrator or a campus principal access to *additional* campuses, one person
at a time. A head who runs Karachi and covers Hyderabad on Thursdays gets both,
and the campus selector at the top of their screens offers exactly those two.

This is per person, deliberately. Granting it to "every principal" would give it
to a principal you did not mean, and taking it back from one of them would take
it from all.

---

## The owner's dashboard answers a different question

A principal asks *did we collect this month*. The owner of three campuses asks
**which campus is behind, and by how much** — and no total answers that.

With **All campuses** selected the dashboard now shows:

- **Five headline figures, each naming its worst campus.** Enrolment across N
  campuses, the group's collection rate and the campus furthest behind it, how
  much of what is owed is more than ninety days old, and the campus with the
  lowest attendance over thirty days.
- **Collection by campus** — billed against collected, side by side.
- **Income against expense by campus**, this month, from the ledger.
- **Enrolment share** — a donut up to five campuses, bars beyond that.
- **Twelve months of collections, one line per campus.** Past six campuses the
  five largest are drawn and the rest are folded into one line labelled *Other
  campuses (N)*, so nothing is silently dropped.
- **A per-campus scorecard** — students, attendance, billed, collected, rate,
  outstanding and over-90-days, sortable on every column, with each row linking
  straight to that campus's own dashboard.

Choose a single campus and the screen becomes exactly the dashboard it has
always been, scoped to that campus. There is nothing to compare, so nothing is
compared.

**A school with one campus sees none of this and is asked nothing.** No
selector, no group charts. A dropdown with one option is a question with one
answer.

---

## You can edit and delete a campus yourself

Until now a campus could be created from inside the school and never touched
again: a misspelt name, a landline that changed, a duplicate typed while
somebody was learning the product — every one of them was a message to support.

Open **Branches → a campus** and you get the whole record, the campus's
principal assignment, an **Edit** button and a delete.

Deleting is deliberately hard to do by accident:

- It is refused outright — with the counts named — while the campus still has
  students, staff, portal members or ledger entries against it. Deleting it
  would detach every one of them from any campus at all, with no record of where
  they were.
- The confirm asks you to **type the campus code**. Every school group has two
  campuses called "Main", and a yes/no box is clicked through.

Editing and deleting are a new permission, **Add, edit and delete a campus**,
which only the School Administrator holds until you change it. Creating a campus
is unchanged and still comes with the school profile permission.

---

## Creating a campus now asks who runs it

The campus form — the same one everywhere it appears — has two new optional
questions: **Branch Administrator** and **Branch Principal**. Each offers:

- **The school owner.** No invitation and no password email; they already have a
  login, and the campus is simply added to what they can see.
- **Somebody else.** Their name, mobile and email, which creates their account
  and emails them a link to set their own password.

Both can be answered at once, which is the normal case at a school group rather
than the exception. The old "invite this email as the branch administrator"
toggle is gone: it could only ever invite the campus's own address and produced
an account called *"Johar Town Campus administrator"* — a role, not a person.

---

## Reports

All fourteen reports now offer a campus. Four of them could not be narrowed
before: **Academic results**, **Account summary**, **Monthly accounts** and
**Income and expense summary** — the last three of which are the ones a group
takes to a board meeting.

The campus is printed in the sheet's header line and carried into the CSV, so
the screen, the printout and the spreadsheet cannot be of three different
campuses.

---

## Smaller things

- **"Principal name" is now "Head of School"** on the school profile. It is the
  whole group's head, whose name prints on a letterhead; each campus's own
  principal is set on that campus.
- **The sidebar collapses.** Every group starts closed except the one holding
  the page you are on, which opens by itself and cannot be closed under you.
  Your choices are remembered.
- **Charts stop drawing over their cards.** A long exam name — *"Mid-Term
  Examination · Grade 5 - A"* — used to run off the left edge of the Recent exam
  outcomes chart. It is now shortened with a "…", and hovering shows the whole
  thing. Anything read by a screen reader still gets the full name.
- **Settings lost its principal card**, which now lives on each campus's page —
  where the question "who runs this campus" is actually asked.

---

## Not in this release

Academic-year runs across campuses, the promotion screen's campus, student
documents, academic history and the guardian address are **phase 19b** and are
not in this release.


---

## Fixed after QA

Sprint 19a was released and then driven at a real school with two campuses,
which is the only thing that finds any of the following. All four are code
fixes: **no migration, no DDL, and nothing rewritten in the database.**

- **The dashboard no longer contradicts itself about where money came from.**
  *Collection by campus* credited PKR 20,000 to Defence Branch while *Income
  against expense by campus*, on the same screen, filed the same rupees under
  *No campus*. Every fee payment ever recorded was posted to the ledger without
  a campus, because the payment route never passed one — the fee module reaches
  a campus through the student and never reads that column, so nothing noticed
  until the two figures were put side by side. New payments now carry the
  campus, and the campus of an existing payment is worked out when the chart is
  drawn. **No historical row was altered:** the ledger is append-only, the money
  was always right, and only the label was missing.
- **A campus filter that does not exist no longer breaks the dashboard.** A
  mistyped or stale `?branch=` in the address bar returned a server error. It
  now falls back to *All campuses*. A campus id belonging to a **different**
  school used to be accepted in silence and quietly emptied every figure on the
  page — an all-zero dashboard with nothing on it to say it was wrong. It is
  now rejected the same way.
- **Money charts stop printing over the card beside them.** An axis labelled in
  rupees — *Ageing of receivables*, and *Collections by campus* — needs more
  room than one labelled "20k", and did not take it, so the labels were drawn
  outside the chart. The axis now measures its own widest label. *Ageing of
  receivables* has been drawing outside itself since Sprint 15.
- **Deleting a campus can no longer destroy a term's setup in silence.** The
  refusal counted students in a table the product has never written to, so the
  count was always nought and the warning could never name anybody. A campus
  that was set up but had nobody enrolled yet tripped nothing at all — and
  deleting it took every class, every section and the whole fee structure with
  it, without a word. Deleting a campus now refuses with the real numbers:
  *"Defence Branch still has 12 enrolled students, 14 classes, 8 portal
  members"*. Deactivating it is still offered, and is still the right answer for
  a campus that is closing.
