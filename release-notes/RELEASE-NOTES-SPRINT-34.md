# Release notes — Sprint 34: Features and Roadmap

**Date:** 19 September 2026
**Migration:** none. `0050` remains the next free number.
**Surface:** Super Admin only. Nothing a school sees has changed.

## New

### Two tabs that answer "what does this product do"

**Super Admin → Features** and **Super Admin → Roadmap**, at the bottom of the
side menu, immediately after Feedback.

Until now that question had no answer anywhere. It lived in the heads of the
people who built it, in a 15,000-line handover file, and in a sprint plan whose
numbering had drifted from what actually shipped. Answering a prospect meant
remembering; answering "can a Coordinator publish results" meant opening
`lib/permissions.ts`.

**Features** lists what the platform does **today**, grouped into three pillars:

| Pillar | What is under it |
| --- | --- |
| **Academics & Learning** | the timetable, the register, exams, marks, report cards, promotions, lesson plans, cover and the school calendar |
| **Finance** | admissions, pupil records, fees, concessions, aged debt and the accounting ledger |
| **People & Operations** | users and permissions, campuses, staff, leave, payroll, performance, chat, announcements and reporting |

A fourth section, **Platform**, covers what the operator does above the tenants
— provisioning, module switches, branding, support access, the feedback queue.
It is marked operator-only and is deliberately **not** sold as a pillar.

Each entry says, in this order: what it does in one line a customer would hear,
what it does in one line that is merely accurate, what it actually does as a
list, **which roles reach it and how far**, which module flag switches it on,
which permission keys gate it, and where it lives.

**Roadmap** lists what is not built yet, in the same three pillars, with the
same search, the same filters and the same glossary. Name, what it does, who it
is for. **No dates and no ordering** — nothing on that tab implies when.

### It reads as a reference and as sales copy

Both registers are there on purpose. *"Build the week once. Every class and
every teacher sees the same timetable, and the school can run more than one
bell schedule"* sits above *"Subjects, period structures and the weekly grid,
with a teacher-by-teacher view that shows a clash before it is saved."* The
first is for the room; the second is for the person who has to answer a
follow-up question.

### Find anything in one or two clicks

- **Full-text search** across names, descriptions, capability lines, role names
  and glossary terms.
- **Filter by pillar**, and on Features **by role** — pick Teacher and the page
  narrows to the eighteen things a teacher can reach at all.
- **A glossary that stays open** — a docked rail on a wide screen, a bottom
  sheet on a phone. 57 terms: the pillars, every module, every role, the
  platform's own vocabulary, and the GoHighLevel terms.
- **Anchors on everything**, so a filtered view is a link you can paste into a
  message and somebody else opens exactly what you were looking at.

## What makes it stay true

This is the part that matters in six months, and it is the reason the tabs are
code rather than a document.

**The role matrix is derived, not written down.** Each feature names the
permission keys it is gated on, and the page resolves the roles from
`DEFAULT_ROLE_PERMISSIONS` when it renders. Change what a Coordinator holds by
default and the Features tab changes with it, in the same commit, with nothing
to remember.

**A new role is a compile error.** The role profiles are generated from
`USER_ROLES`, so adding a thirteenth role without describing it fails
`typecheck` rather than shipping a tab that quietly lists twelve.

**Dead references cannot ship.** Every module key, every permission key and
every glossary reference is checked when the file loads.

## What it deliberately does not claim

**LMS, Events, Transport, Library and Hostel are on Roadmap, not Features.**
All five are switches a school can already see in the Modules grid, and none of
them has a screen behind it: the first two land on a placeholder, the other
three have no route at all. A Features tab that listed Library as shipped is
one that loses a deal in the room, and then loses the customer.

The reverse correction was also needed. Chat, web push, the campus calendar and
discount repricing are on **Features** — all four have shipped, even though the
sprint plan still lists them as planned work.

## What it deliberately does not claim, part two

One entry says less than it could, and the reason is worth knowing.

**Lesson plans** is listed as a teacher's own screen and nothing more. The
product stores whether a plan is shared, and there is a built endpoint that
would return every shared plan at the school — but no screen calls it, so no
head can read one today. An earlier draft of this tab said otherwise, because
the entry was gated on a permission seven office roles hold, and the tab
believed them.

It has been corrected rather than quietly kept, because the cost of the two
mistakes is not symmetrical: an absent claim loses nothing, and a claim that
fails in the room loses the room.

## What stops it going stale

`npm run check-product-catalogue` now runs on every push, alongside the other
thirteen checks. It asserts the three things about these tabs that cannot be
derived from the code and therefore could drift from it:

- every route an entry names **resolves to a real screen**
- every role's stated first-day sidebar **matches the sidebar the code builds**
- a feature reachable only from one portal **cannot claim office access**

That last one is the lesson-plans defect turned into a rule. All three were
found stale in review before this shipped, which is why they are assertions
rather than good intentions.

## Deployment

Nothing to do. No migration, no environment variable, no module key, no
permission key, no data step. Merging deploys it.

Rollback is one revert and a rebuild. No data is written by either tab, so
there is nothing to reconcile.

## Notes

- Neither tab reads the database or calls an API. The content ships in the
  bundle, so opening either one costs no query.
- Filter state lives in the URL fragment, which is never sent to the server.
- First load is 146 kB, below the Feedback screen's 173 kB. The two tabs share
  their code, so the second one costs nothing after the first.
