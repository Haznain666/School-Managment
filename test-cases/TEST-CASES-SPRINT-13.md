# Test cases — Sprint 13: Portals, the installable app, and two principals

Traces to [`RELEASE-NOTES-SPRINT-13.md`](../release-notes/RELEASE-NOTES-SPRINT-13.md).
Migration `0023_sprint13_portals.sql`, applied.

**The most important case in this file is UC-S13-18**, and it is a case that
must *fail to find* something. The note calls its own sentence the most
important in the release:

> A cached fee page outlives the session that fetched it and is not cleared by
> signing out — so the next person to open the app on a dead connection would be
> handed somebody else's bill.

Phones in this market are frequently shared. If anything authenticated is being
cached, that is not a defect report, it is a data breach on a family's fees.

---

## The parent portal

#### UC-S13-01 · My children shows every child side by side — P2
**Role** Parent of several · **Traces to** "class, campus, roll number, this month's attendance and what is owed… Previously a parent with four children switched between them one at a time"
1. Open as a parent with three or more children.
- **Expect** all five facts per child, on one screen.

#### UC-S13-02 · A parent sees only their own children — P1
**Role** Parent · **Traces to** parent portals "answer by identity, not by permission"
1. Try another family's child ID in every parent URL — children, attendance, report cards, fees.
- **Expect** refused everywhere.
- **Fail** anywhere. There is no permission gate behind this to catch a miss.

#### UC-S13-03 · The attendance calendar is a month grid — P2
**Role** Parent · **Traces to** "A list answers 'which days was my child away'; only a grid answers 'is there a pattern', and every Monday sitting in one column is what makes 'off sick every Monday' visible"
1. Open the calendar; move through months with the arrows.
- **Expect** a month grid with weekdays aligned in columns.

#### UC-S13-04 · A blank school day means the register was not taken — P1
**Role** Parent · **Traces to** "**not** that anybody was absent. Schools miss registers, and drawing a missing one as an absence would put a mark against a child who was in class"
1. Find or create a school day with no register. Open the calendar.
- **Expect** blank, and distinguishable from absent — with the meaning stated.
- **Fail** if it renders as an absence. That is a mark against a child who was in class, visible to their parent.

#### UC-S13-05 · Every marked day carries a letter as well as a colour — P2
**Role** Parent, colour-blind simulation · **Traces to** "so the calendar is readable without colour vision"
1. View with colour vision simulation.
- **Expect** P/A/L/E letters legible independently of colour.

#### UC-S13-06 · The month is in the address bar — P3
**Role** Parent · **Traces to** "so a particular month can be sent as a link"

#### UC-S13-07 · Only published terms appear, and print identically — P1 · **NEEDS PAPER**
**Role** Parent · **Traces to** "Only terms the school has **published** ever appear" and "the same component, from the same query"
1. With one term published and one in draft, open report cards; print the published one.
2. Compare against the school's own printed copy.
- **Expect** only the published term; the sheets are identical.

#### UC-S13-08 · Switching an email off never hides anything — P1
**Role** Parent · **Traces to** "**What this deliberately does not do:** switching an email off never hides anything. Notices stay on the notice board, challans stay on the fee page. The screen says so in those words"
1. Switch off announcement and fee-reminder emails.
2. Have the school send both. Open the notice board and the fee page.
- **Expect** no emails; **both still visible in the portal**; the settings screen says so explicitly.
- **Fail** if either is hidden — "a preference page that appeared to switch off fee notices and did not would leave a parent believing nothing was owed." The inverse is just as bad.

#### UC-S13-09 · Everyone starts with every email on — P2
**Role** Parent · **Traces to** "Everyone starts with every email on, and nobody's existing account changed"
1. Check a parent who has never opened Settings.
- **Expect** all on, with no back-fill having altered any existing account.

---

## The teacher portal

#### UC-S13-10 · My classes shows the roster in register order — P2
**Role** Teacher · **Traces to** "in register order, roll numbers first. It was previously reachable only inside the act of marking something"

#### UC-S13-11 · The gradebook marks unpublished columns as unpublished — P1
**Role** Teacher · **Traces to** "Marks that are not yet published are shown *and marked as unpublished*, because a number quoted to a parent from an unpublished column is one the school has not stood behind yet"
1. Open a gradebook with a mix of published and draft papers.
- **Expect** drafts are visible **and clearly flagged**.
- **Fail** if unflagged — this screen is used at a parents' evening, and the flag is what stops a provisional mark being quoted as final.

#### UC-S13-12 · A lesson plan is drafted privately and shared deliberately — P2
**Role** Teacher · **Traces to** "Save it as a draft that only you can see, or share it with the school's coordinators and heads. Sharing sends nothing to anybody; it makes the plan visible"
1. Save a draft; confirm no coordinator can see it. Share; confirm they can.
- **Expect** exactly that, and **no notification** is sent on sharing.

#### UC-S13-13 · Saving the same week twice corrects rather than duplicates — P2
**Role** Teacher · **Traces to** "Saving the same week twice corrects it rather than adding a near-duplicate"
1. Save a plan for one class/subject/week, then save it again changed.
- **Expect** one plan, corrected.

#### UC-S13-14 · My payslips appear only once a run is paid — P1
**Role** Teacher · See UC-S07-11.

#### UC-S13-15 · My leave is a record with no apply form — P2
**Role** Teacher · See UC-S07-12.

---

## The student portal

#### UC-S13-16 · Only announced exams appear — P1
**Role** Student · **Traces to** "a school scheduling an exam and telling students about it are two acts, and showing the first would spread a date the school had not committed to"
1. Create an exam without announcing the datesheet. Open My Exams.
- **Expect** absent. Announce it; it appears, split into coming and sat.

#### UC-S13-17 · A student sees fee status but gets no printable voucher — P1
**Role** Student · **Traces to** "a challan is paid at a bank counter by whoever holds the money, and a second printable copy in circulation is how a fee gets paid twice"
1. Open Fee Status; look for any print or download.
- **Expect** the position is visible; **no printable voucher anywhere**, including by URL.
- **Fail** if one exists. This is a money-duplication risk, not a missing feature.

---

## The installable app

#### UC-S13-18 · Nothing authenticated is stored on the device — P1
**Role** Parent, installed app · **Traces to** "**What it does offline: almost nothing, on purpose.**… That is the most important sentence in this note"
1. Install the app. Browse fees, attendance and results.
2. Kill the connection and reopen. Sign out, kill the connection, reopen. Inspect the service worker caches and storage.
- **Expect** a plain "you are offline" page every time, and **no authenticated content in any cache**.
- **Fail** on any cached fee, attendance or result page. On a shared handset "the next person to open the app on a dead connection would be handed somebody else's bill."

#### UC-S13-19 · Each school installs as its own app — P2
**Role** Parent with children at two schools · **Traces to** "A parent with children at two schools installs two apps"
1. Install from both subdomains.
- **Expect** two apps, each in its own school's name, colours and icon.

#### UC-S13-20 · The icon and name are generated from the palette, with no operator step — P2
**Role** Operator · **Traces to** "generated from the school's palette so no operator step is needed"
1. Create a school, set a palette, install.
- **Expect** a correct icon with nothing configured. Confirm `/icon/<unknown>` 404s, as the Sprint 13 deployment check recorded.

#### UC-S13-21 · The service worker registers at the right scope — P2
**Role** Operator · **Traces to** the deployment check: "`/sw.js` serves `Service-Worker-Allowed: /`"
1. Fetch `/sw.js` and read the header; confirm the manifest and icons serve.

---

## Two principals

#### UC-S13-22 · A school with one principal sees none of this — P1
**Role** School administrator · **Traces to** "**A school with one principal sees none of this.** Every existing school is unchanged, the switch is off, and no assignment screen appears"
1. Open Settings at an untouched school.
- **Expect** no assignment screen; `principal_model` is `single`.
- **Fail** if a one-head school is made to configure one.

#### UC-S13-23 · An assignment narrows what a head sees, not what they may do — P1
**Role** Principal · **Traces to** "the Principal role keeps exactly the permissions it always had. A head assigned to the O-Levels sees the O-Levels' students; the rest of the school is not theirs to look through"
1. Assign a principal to a division. Compare their permission set before and after.
2. Try to reach a student outside the division, by list and by URL.
- **Expect** permissions unchanged; out-of-scope students unreachable both ways.

#### UC-S13-24 · Only a school administrator can edit assignments — P1
**Role** Principal · **Traces to** "A principal deliberately cannot: a head who could edit assignments could widen their own view, which would make the boundary a suggestion"
1. As an assigned principal, attempt to edit any assignment — screen and route.
- **Expect** refused both ways.

#### UC-S13-25 · Ending an assignment is not deleting it — P1
**Role** School administrator · **Traces to** "'who ran the O-Levels last year' is a question schools are asked. Delete is there for the row that should not have been written"
1. End an assignment with a date. Confirm the row survives and history is answerable.
2. Separately, delete one.
- **Expect** ending keeps the row; delete removes it. Both available and distinct.

#### UC-S13-26 · A division with no classes says so — P2
**Role** Principal · **Traces to** "**A division with no classes reaches no students**, and the screen says so rather than showing a blank — otherwise the head assigned to it opens an empty school with no explanation"
1. Assign a principal to a division with no classes. Sign in as them.
- **Expect** an explanation, not a blank school.

---

## Not in this sprint

- **An assignment tracker for students** — no homework table exists; it belongs
  to the e-learning sprint.
- **Applying for leave from the teacher portal** — deliberate; see UC-S07-12.
- **Push notifications** — the app shell is the substrate.
- **Offline access to your own data** — "a decision rather than an omission".
- **None of this has been clicked in a browser.** Every query was executed
  against the real database, and the calendar arithmetic and principal scope are
  asserted by `npm run check-portals` — "but no page and no printed sheet has
  been looked at."
