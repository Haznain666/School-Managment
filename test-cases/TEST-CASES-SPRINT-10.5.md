# Test cases — Sprint 10.5: Design system, application shell & dashboard charts

Traces to [`RELEASE-NOTES-SPRINT-10.5.md`](../release-notes/RELEASE-NOTES-SPRINT-10.5.md).
**No migration.**

**Two of these cases are worth more than the rest put together**, because they
defend faults that were *live* rather than hypothetical:

- **UC-S10.5-08** — below 768px, four of the five portals had **no navigation at
  all**. Parents and students, "the people most likely to be on a phone and
  least likely to own a desktop", had the worst of it.
- **UC-S10.5-13** — a print regression that would have sent dark sheets through
  every printer at a school with a dark palette. It was caught before shipping;
  it can come back.

**Use `/design-system` for most of this.** The note explains why it exists: every
real screen sits behind a sign-in that has never worked from a development
machine, "so without it the hostile-palette check would be one nobody ran". It
404s in production.

---

## Colour and contrast

#### UC-S10.5-01 · A school's five colours reach the bottom of the interface — P2
**Role** Any school role · **Traces to** "A school picked maroon and got a maroon frame around a grey system… Those five now compute around forty-four more"
1. Set a distinctive palette. Walk an admin screen, a portal screen and a chart.
- **Expect** surfaces, borders, text and chart colours all follow.
- **Fail** if colour stops at the top navigation.

#### UC-S10.5-02 · No text fails contrast on any surface it can appear on — P1 · **AUTOMATED**
**Role** Tester · **Traces to** "Every colour is checked for legibility against every surface it can appear on — not just the page background. That check found 18 real contrast failures that a narrower one had passed"
1. Run `npm run check-theme`.
2. Open `/design-system` and read every component against all seven palettes.
- **Expect** 0 failures; the note's own result was "994 rendered text elements across 7 palettes, **0 contrast failures**".
- **Fail** on any — and check it against a *surface*, not just the page background. That narrower check is the one that passed 18 real failures.

#### UC-S10.5-03 · Status colours lean toward the brand without swapping meaning — P1
**Role** Tester · **Traces to** "so a school's brand moves them without letting 'paid' and 'overdue' swap appearances"
1. Across all seven palettes, compare the paid / partial / overdue badges.
- **Expect** they shift with the hue but stay distinguishable and keep their sense.
- **Fail** if on any palette "paid" and "overdue" could be confused. A parent reading a fee status is the person harmed.

#### UC-S10.5-04 · Both real bugs the migration surfaced stay fixed — P2
**Role** Tester · **Traces to** "two real bugs surfaced rather than being carried over — including a timetable cell printing white text on a pale yellow subject colour"
1. Give a subject a pale colour; view and print the timetable.
- **Expect** readable.

---

## Navigation

#### UC-S10.5-05 · Every portal has a drawer on mobile — P1 · at 375px
**Role** Parent, student, teacher, school admin, Super Admin · **Traces to** "**Below 768px, four of the five portals had no navigation at all.** Once on a page, the only way to another was the browser's back button"
1. At 375px, open each of the five portals and navigate between two pages **without** the back button.
- **Expect** a working drawer in all five.
- **Fail** anywhere. This was a live fault, and it hit parents and students hardest.

#### UC-S10.5-06 · Super Admin does not eat a third of a phone screen — P2 · at 375px
**Role** Super Admin · **Traces to** "the mirror fault, a permanent 240px column eating a third of a phone screen"
1. Open the panel at 375px.
- **Expect** the sidebar is a drawer, not a permanent column.

#### UC-S10.5-07 · Drawer and sidebar cannot drift — P3
**Role** Tester · **Traces to** "built from one list so the two cannot drift"
1. Compare the drawer's entries against the desktop sidebar's, per role.
- **Expect** identical.

#### UC-S10.5-08 · The current page is marked by more than a tint — P2
**Role** Any · **Traces to** "the current page is now marked by an edge marker as well as a tint, so 'which page am I on' is answerable at a school whose accent colour is close to its background"
1. On a palette whose accent nearly matches its background, identify the current page.
- **Expect** an edge marker, visible independent of the tint.

#### UC-S10.5-09 · No sideways scrolling at 375px — P2
**Role** Any · **Traces to** "No sideways scrolling at 375px, and every table scrolling inside its own box"
1. Walk every portal at 375px, including the widest tables and charts.
- **Expect** the page never scrolls sideways; wide tables scroll **inside their own box**.

---

## Headings and structure

#### UC-S10.5-10 · Pages have real top-level headings — P2
**Role** Any · **Traces to** "**only 7 of 91 pages had a top-level heading at all**… 49 screens now have a proper page header"
1. Sample screens across all five portals with a screen reader or an outline tool.
- **Expect** one real page heading each — not the navigation bar acting as the document's heading.

#### UC-S10.5-11 · Deep pages carry breadcrumbs, not a one-level back link — P3
**Role** Any · **Traces to** "pages three levels deep have breadcrumb trails rather than a 'back' link that only ever went up one level"
1. Reach a three-level-deep page and use the trail to jump two levels.
- **Expect** it works.

#### UC-S10.5-12 · One table component everywhere — P3
**Role** Tester · **Traces to** "no hand-rolled table markup remains outside the four printed documents"
1. Sample tables across the product.
- **Expect** consistent behaviour — sorting, stickiness, overflow. The four printed documents are exempt.

---

## Printing

#### UC-S10.5-13 · A dark palette does not print dark sheets — P1 · **NEEDS PAPER**
**Role** Any, at a dark-palette school · **Traces to** "the page background moved to a themed colour, which would have printed dark sheets for a school with a dark palette on any machine with background graphics enabled"
1. At a dark-palette school, print a challan, a payslip, a report card and a report — **with background graphics enabled**.
- **Expect** white sheets, dark text.
- **Fail** on heavy ink coverage. This regression was caught before shipping and would cost a school a toner cartridge per class.

---

## Charts

#### UC-S10.5-14 · Every documented chart renders on its screen — P2
**Role** Various · **Traces to** the list: school dashboard (collection trend, attendance trend, class strength), fees (billing status, outstanding by age, collection by month), attendance reports (rate by class), parent portal (their child's attendance), Super Admin (see below)
1. Open each and confirm it draws with real data and shows a sensible empty state with none.
- **Note** the Super Admin module-adoption chart was **replaced** — see the dashboard release note and its cases. Do not test for it here.

#### UC-S10.5-15 · Every chart emits its figures as a real table — P1
**Role** Screen-reader user · **Traces to** "alt text can summarise a trend but a parent checking their child's results needs the numbers"
1. Read each chart with a screen reader.
- **Expect** the actual figures, not only a summary.
- **Fail** on alt text alone — a parent checking results needs numbers.

#### UC-S10.5-16 · Charts survive printing and add no client JavaScript — P2 · **NEEDS PAPER**
**Role** Tester · **Traces to** "**No charting library was added.** A chart on a report card has to survive being printed, and the shared JavaScript budget is tight; these are server-rendered graphics with nothing to hydrate"
1. Print a page containing a chart. Check the shared first-load JS against the 200 kB budget.
- **Expect** the chart prints intact; the budget holds.

---

## Not in this release, and one of them is gated

- **A chart on the report card.** Deliberately not built, and **gated on printing
  one of each document on real A4 first**. "It is the emblematic case for the
  whole server-rendered approach *because it prints*, and that is exactly why it
  must not be added to a template nobody has ever put on paper." Do not raise it.
- **Verification inside a real session.** The note is explicit that everything
  was checked against fixtures, and that "'the sidebar renders' and 'the sidebar
  renders the right things for a branch administrator at a school with three
  modules on' are different claims, and only the first has been tested." **The
  second claim is untested and is what UC-S10.5-05 and UC-S02-07 together
  cover** — run them as a pair once a session is available.
