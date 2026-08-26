# Sprint 16 — Feedback, global search, and a dashboard that fits on the screen

**Migration `0032` — APPLIED and verified on 2026-08-26.** Four new tables, no
column changed and no row rewritten.

---

## Tell us what is wrong, and hear back

Every administrative portal now has **Feedback** in the sidebar.

A school administrator writes a title and a description, marks it a **Bug** or a
**Suggestion** — Suggestion is the default — and attaches up to **five** PNG,
JPEG or PDF files of up to 10 MB each. A screenshot is usually the fastest way
to explain a bug, and now there is somewhere to put one.

Sending it does three things at once: the ticket appears in the school's own
list, the people who build this product get a notification in their portal, and
they get an email. Nothing sits in an inbox nobody watches.

**The conversation stays on the ticket.** When we change its status or write
back, the school gets an in-app notification *and* an email, and the reply is on
the ticket where the original message is. A school administrator opening
Feedback can see, for every message they have ever sent, what was said and where
it got to.

### The five states, and what each of them means

| Status | What it means |
| --- | --- |
| **Unread** | It has arrived. Nobody here has opened it yet. |
| **Read** | Somebody has read it. No decision has been taken. |
| **Work in progress** | It is being worked on now. |
| **Future development** | Agreed, and scheduled for a later release. |
| **Resolved** | Done, or answered. |

A ticket starts **Unread** and becomes **Read** the moment it is opened — the
school does not have to ask whether anybody has looked at it. The other three
are decisions somebody takes deliberately, and each one emails the school.

There is no "Rejected". A school told its suggestion was rejected learns nothing
it can act on; *Future development* is the honest form of the same answer.

### What the platform side looks like

The Super Admin's queue is one list in four sections — **Active**, **Work in
progress**, **Future development**, **Resolved** — with filters by nature and by
school, sorting from any column title, pagination, and a full-text search across
titles, messages, sender names and school names.

- Each row reads **"Title — School name"**, which is what an operator scans.
- **A bug is marked.** The row carries a red left edge *and* a "Bug" badge with
  the word in it, so it is legible to somebody who cannot tell the two tints
  apart.
- **Active is two statuses, not one.** Unread and Read are both active: opening
  a ticket must not make it disappear from the list of things still to decide.
- **A counter beside each section title, behind a toggle.** Off by default, and
  the choice is remembered. A permanent "0" beside three of four headings is
  three numbers nobody reads, which would cost the fourth its meaning.
- The status can be set **from the listing as well as from the ticket**.
  Triaging twenty tickets should not mean opening twenty pages.
- **Delete** removes a ticket, its replies and its files. The dialog says
  exactly what is about to go, and points out that *Resolved* is what you want
  if you mean to close it rather than erase it.

**New feedback is on the platform dashboard**, as a tile counting what is
unread, and as a chip at the top of the screen.

### Attachments are private

Clicking an attachment downloads it. The file is never given a public URL: the
link goes through a route that checks who is asking and which school the ticket
belongs to, and a school administrator following a link to another school's
attachment gets "no such attachment". A bug report's screenshot is a picture of
a school's own data, and a public link to one works forever for anybody who
sees it.

---

## Search, on every portal

There is a search box in the header of all five portals, and a results page
behind it. Press `/` or `Ctrl`/`⌘`+`K` from anywhere to jump into it. The box
shows the best few matches as you type; Enter opens the full page.

**Results are grouped by category, and every result says which screen it opens.**
Three rows all reading "Ahmed Raza" is a puzzle; the same three rows labelled
*Student detail*, *Guardian on a student record* and *Staff record* are an
answer.

What each portal searches:

| Portal | Finds |
| --- | --- |
| Administrative | Students, parents & guardians, teachers & staff, portal accounts, classes & sections, subjects, fee challans, applications, announcements — and screens |
| Teacher | The students in their own classes, subjects, the notice board, and screens |
| Parent | Their own children, their own challans, the notice board, and screens |
| Student | Their own challans, their subjects, the notice board, and screens |
| Super Admin | Schools, campuses, and the people who run them, across every tenant |

**Nothing appears that the reader could not already open.** Each category is
gated on the same permission the destination screen enforces, so an accountant
searching a name finds the challans and not the staff file, and a principal
scoped to three grades finds students in those three grades. A teacher finds the
children in the classes they teach and no others; a parent finds their own
children and nobody else's.

**"Screens" is a category too.** Search *defaulters*, *payslips* or *grading* and
the screen itself comes up — built from that person's own navigation, so it can
never point somewhere they are not allowed to go.

---

## The dashboard

### How far your school has got

A new **School setup** panel: a progress bar and six headcounts — **Principal**,
**Teachers & staff**, **Classes**, **Subjects**, **Timetable**, **Enrolled
students**. Anything not yet set up is marked and links straight to the screen
that sets it up.

A step counts as done when there is at least one of the thing. That is the only
threshold true of every school: with no subjects there is no timetable, with no
timetable there is no register, and with no students there is nothing at all.

Once every step is in place the panel keeps its numbers and stops nagging, so it
goes on being a one-line summary of the school rather than becoming furniture.

### Three fixes you asked for

**The two big charts now match the others.** *Class strength* and *Recent exam
outcomes* were full-width cards, which stretched the same drawing to roughly
twice the height of the eight charts above them — thicker bars, larger labels,
and a card that read as a different component. They now sit two-up in the same
grid as everything else. Nothing about the charts changed; they were the wrong
width.

**Quick links are at the top, as chips.** They were a grid of bordered tiles at
the *bottom* of the dashboard, under nine charts — two scrolls from the top, so
the links most likely to be wanted were the hardest things on the page to reach.
Every dashboard now opens with a row of chips: the school admin's, the platform
operator's, the teacher's, the parent's and the student's.

**The second scrollbar is gone.** Every portal screen had two — one on the page
content and one on the document behind it, which scrolled a blank strip. It was
caused by the hidden text this product writes for screen readers: it is
positioned in a way that escaped the scrolling area, so the browser grew the
page behind it. One scrollbar now, on every portal.

---

## Smaller things

- **The bell.** A notification icon in every portal header with an unread count,
  showing what has happened and linking to it. It is general — the next feature
  that needs to tell somebody something writes one row rather than inventing a
  second mechanism.
- **A dashboard tile that says "All healthy" no longer announces itself to a
  screen-reader user as "an improvement".** Four tiles state a condition rather
  than a movement, and they were being read out as though a number had gone up.
- **The header search box has a minimum width.** Squeezed between a long school
  name and a sign-out control it had collapsed to 165px, narrow enough to cut
  the placeholder off mid-word.

---

## What is not in this release

- **Feedback is administrative-portal only.** Teachers, parents and students
  cannot send it. That was the requirement, and it is the right scope: a
  school's questions should reach its own office first.
- **A school cannot delete its own feedback, and cannot change a status.**
  Both are the vendor's. A bug report that could be deleted is one that
  disappears the week before anybody looks at it.
- **No attachments on replies.** The files go on the original message.
- **Search does not cover exams, payroll runs, lesson plans, expenses or ledger
  entries.** Those are reached from their own screens, which the *Screens*
  category now finds by name.
- **Search is unindexed.** It is fast at the scale any school here is at, and it
  is a trigram index away from being fast at ten times that. Nothing about the
  queries needs rewriting when that day comes.
- **The teacher, parent and student portals were not signed into during
  verification** — no test account exists for those roles on the live tenant.
  Their search scoping is asserted in code and their pages refuse the wrong
  role, but nobody has held one of those logins and typed into the box.
