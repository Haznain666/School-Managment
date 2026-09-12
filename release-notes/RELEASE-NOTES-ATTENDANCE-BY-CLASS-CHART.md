# Release notes — the Attendance by class chart

**Branch:** `claude/suspicious-colden-48b59a`
**Migration:** none — `0045` is still the next free migration number

---

## For the school

**Attendance by class is readable again.**

On *Academics → Attendance → Reports*, the chart at the top drew one upright bar
per class and wrote every class name underneath it at full size. A school with a
handful of classes never noticed. A school with twenty-nine sections got one
line of text with every name printed on top of the next —
"Pre-NurseryNurseryBNurseryPrep A…" — and no way to tell which bar was which.

The chart now runs **one row per class**, in school order, with the class name
on the left, the bar beside it and the percentage at the end of the bar. Every
name has its own line however many classes you have.

**Classes below 75% are marked** in the warning colour, which is the threshold
the page already names. The count of classes below it is still read out to
screen readers, so the colour is never the only way to know.

**Class strength on the main dashboard** had the same problem — one upright bar
per section — and now runs the same way.

Nothing about the figures changed. Same classes, same last 30 days, same rule
that late counts as present and holidays are excluded.

---

## For whoever maintains this

### The defect

`BarChart`'s vertical branch gives each label `plotWidth / categories.length`
viewBox units and never checked the label fitted. At 29 categories that is ~20
units for `"Pre-Nursery A"`, which needs ~73. STATE.md already recorded the rule
("past roughly a dozen categories, go horizontal") after the Super Admin
module-adoption chart did exactly this — but a rule held in a handover file is
enforced by nobody, and the attendance reports page was written without it.

### The fix

1. **`BarChart` now enforces the rule itself.** In vertical mode it measures the
   widest category label (5.6 units per 11px glyph, `axisGutter`'s figure, plus
   4 units of gap) against its bar's budget, and draws horizontally when the
   labels would overlap. `orientation="vertical"` is a preference, not a promise.
   Every chart that fits today is untouched — twelve months, the five ageing
   buckets, a paper's grade bands.
2. **The attendance reports chart** is `orientation="horizontal"` explicitly and
   capped at `max-w-3xl`. The chart scales its viewBox to its width, so at the
   card's full ~1,100px a 29-row chart would draw ~1,300px tall with 19px labels.
   Capped, it is ~880px with table-row-height rows.
3. **Its below-75% mark now exists.** The code carried a comment saying bars
   below 75% used the danger colour, beside a series with a single `fill-chart-1`.
   It now uses `fill-status-warning` — the dashboard's worst-classes mark — from a
   local `ATTENDANCE_CONCERN = 75`, which the screen-reader summary shares.
   Deliberately not the dashboard's constant, which is 85.
4. **Dashboard Class strength** is `orientation="horizontal"` explicitly.
4a. **On a phone, a horizontal chart scrolls sideways inside its card.** The
   viewBox scales to its container, so at 375px an 11-unit label was drawn at
   ~5px — no overlap, and still unreadable. `ChartFrame` gained `minWidthClass`
   (wraps the SVG in its own `overflow-x-auto`; the page body never scrolls),
   and every horizontal `BarChart` passes `min-w-[36rem] sm:min-w-0`. From
   `sm` up it is a no-op, so the dashboard's ~480px half-width cards do not
   start scrolling on a desktop. The wrapper carries `contain: inline-size`:
   without it, a chart inside a one-column grid widened the whole track and the
   *page* scrolled sideways on a phone.
5. **The loader matches the page.** `SkeletonChart` gained
   `orientation="horizontal"` (a label column and bars growing rightwards), and
   the reports route's `loading.tsx` stopped promising stat tiles and two
   side-by-side charts the page has never had.

### Rotation, every-nth and scrolling were weighed and not chosen

Rotated labels are a wall of diagonal text; every-nth labels hide which bar is
which, which is the only thing a ranking of classes is for; truncation renders
"Year 1 A" and "Year 1 B" as the same string at any useful length; and a
horizontally scrolling chart hides most classes behind a gesture. A row per class
is what a head reading a register expects.

### Verified

- Green build: `typecheck`, `lint`, all ten no-database checks including
  `check-theme` and `check-loaders`, and `npm run build`.
- The real `BarChart` rendered to static markup with 27 Askari-shaped section
  labels, styled by this build's CSS, measured in Chromium at 1440px and 375px:
  **0 overlapping labels** on the shipped chart; the same labels left at
  `vertical` fell back to horizontal with 0 overlaps; a 12-month control stayed
  vertical.
- **Not** opened signed in at the Askari tenant from this session — see STATE.md.
