# Release notes — Sprint 10.5: Design system, application shell & dashboard charts

**Status:** shipped. **No migration** — nothing in this sprint changed the
database.

Built before Sprints 11–13 rather than after, because each of those adds screens
that would otherwise have been designed twice.

A school picked maroon and got a maroon frame around a grey system. This sprint
is why the colour a school chooses now reaches the bottom of the interface
instead of the top inch — and it is also the sprint that gave the product
navigation on a phone.

---

## What a school gets

### Its own colours, everywhere

A school stores five colours. Everything below the top navigation was previously
fixed grey, white and red regardless. Those five now compute around forty-four
more — surfaces, borders, text, four status colours in five forms each, and six
chart colours — per request, with no setup.

**Status colours are derived from the school's own palette**, chosen over fixed
red/amber/green. Each leans toward the school's hue as far as it can while
staying inside the range where it still means what it means, so a school's brand
moves them without letting "paid" and "overdue" swap appearances.

**Every colour is checked for legibility against every surface it can appear
on** — not just the page background. That check found 18 real contrast failures
that a narrower one had passed, all of them text on a surface it had never been
tested against.

1,155 hard-coded colours across 145 files were migrated onto this system, and
two real bugs surfaced rather than being carried over — including a timetable
cell printing white text on a pale yellow subject colour.

### Navigation on a phone

**Below 768px, four of the five portals had no navigation at all.** Once on a
page, the only way to another was the browser's back button. Parents and
students — the people most likely to be on a phone and least likely to own a
desktop — had the worst of it.

Every portal now has a drawer on mobile and a sidebar on desktop, built from one
list so the two cannot drift. The Super Admin panel had the mirror fault, a
permanent 240px column eating a third of a phone screen; that is fixed too.

Also: **the current page is now marked by an edge marker as well as a tint**, so
"which page am I on" is answerable at a school whose accent colour is close to
its background.

### Real page headings

A survey found that **only 7 of 91 pages had a top-level heading at all** — the
house pattern made every portal a document whose main heading was the navigation
bar. 49 screens now have a proper page header, and pages three levels deep have
breadcrumb trails rather than a "back" link that only ever went up one level.

### Charts

Five chart types, drawn on the server, on:

- **the school dashboard** — collection trend, attendance trend, class strength
- **fees** — billing status, outstanding by age, collection by month
- **attendance reports** — rate by class
- **the parent portal** — their child's attendance
- **the Super Admin panel** — module adoption

Every chart also emits its own figures as a real table for screen readers,
because alt text can summarise a trend but a parent checking their child's
results needs the numbers.

**No charting library was added.** A chart on a report card has to survive being
printed, and the shared JavaScript budget is tight; these are server-rendered
graphics with nothing to hydrate.

### Consistency

Every table in the product now uses one table component — no hand-rolled table
markup remains outside the four printed documents. Eleven missing interface
pieces were built and the eight existing ones rebuilt on the new colours.

---

## Things worth knowing

- **Printing was checked and one regression was caught before it shipped**: the
  page background moved to a themed colour, which would have printed dark sheets
  for a school with a dark palette on any machine with background graphics
  enabled.
- **A design-system page exists for development only** and returns 404 in
  production. It renders every component against seven palettes — four real and
  three deliberately hostile — which is how the 18 contrast failures were found.
  Every real screen sits behind a sign-in that has never worked from a
  development machine, so without it the hostile-palette check would be one
  nobody ran.

---

## Not in this release

- **Exam charts.** Grade distribution, subject averages and pass rate were built
  afterwards, as the sprint's Task 1 — they shipped alongside Sprint 11.
- **A chart on the report card.** Deliberately not built. It is the emblematic
  case for the whole server-rendered approach *because it prints*, and that is
  exactly why it must not be added to a template nobody has ever put on paper.
  It is gated on printing one of each document on real A4 first.
- **Verification inside a real session.** Everything above was checked against
  fixtures. The shell is the same code either way, but "the sidebar renders" and
  "the sidebar renders the right things for a branch administrator at a school
  with three modules on" are different claims, and only the first has been
  tested.

---

## Verification

994 rendered text elements across 7 palettes, **0 contrast failures**. No
sideways scrolling at 375px, and every table scrolling inside its own box.

The 27-file table conversion was checked mechanically rather than by eye: every
behaviour-carrying attribute counted before and after, and every file's content
compared with markup stripped. Both identical — only the markup changed. Those
two checks are worth reusing for any future bulk rewrite.
