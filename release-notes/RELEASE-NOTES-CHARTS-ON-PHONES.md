# Release notes: charts on a phone

**Branch:** `claude/vertical-charts-phones`
**Migration:** none. `0045` is still the next free migration number.

---

## For the school

**Every bar and line chart is now readable on a phone.**

Until today a chart on a phone was a shrunken copy of the desktop chart. The
drawing fitted the screen, but every month, class name and figure on it was
about 5 pixels tall. Nothing overlapped, and nothing could be read.

On a phone, each chart is now drawn at phone size, with text about twice as
large as before. Nothing is cut off, and nothing needs scrolling sideways.

What you will notice:

- **Collection by month, and any chart with many bars, turns on its side on a
  phone.** Each month gets its own row with its name on the left and the
  figure at the end of the bar. On a computer it looks exactly as before.
- **Attendance trends show fewer month labels on a phone.** A phone shows
  about four, such as Jan, May, Aug and Dec. The last month is always labelled.
- **Charts with a few short labels, such as grade bands, look the same on a
  phone,** just larger.
- **Attendance by class no longer scrolls sideways on a phone.** The whole
  chart fits, percentages included.

Also fixed, on computers as well: **where two figures share a row, they no
longer print over each other.** The dashboard's *Recent exam outcomes* chart
shows a pass rate and an average for each exam, and the two numbers on every
row overlapped. Each now has its own line.

Printed report cards are unchanged.

---

## For whoever maintains this

- `BarChart` and `LineChart` render two drawings: `DESKTOP` (640 units) and
  `PHONE` (320 × 220).
  - `ChartFrame` takes the second as `phone` and shows one by breakpoint
    (`hidden sm:block` / `sm:hidden`).
  - The hidden drawing is `display: none`, so it is out of the accessibility
    tree, and the data table is emitted once.
- Orientation and label thinning are decided per drawing.
- The `minWidthClass` scroll floor from the Attendance-by-class change is
  removed, along with its `contain: inline-size` wrapper.
- Measured in Chromium, three estimates were wrong. Each is fixed:
  1. **Glyph width.** Category labels run 6.3–7.2 units per glyph, not 5.6.
     Twelve months drew 1px apart on a phone.
  2. **Line-chart thinning.** It ignored the start-anchored first label, so
     "Jan 2026" touched "Apr 2026".
  3. **Row height.** A horizontal row was 26 units whatever the series count,
     so two series' value labels overlapped by 2.4 units. This was already live
     on desktop.
- `check-forms` gained a *Charts on a phone* section (74 → 98 assertions),
  checked per drawing.
- STATE.md §5bx has the numbers and the reasoning.

### Verified

- `typecheck`, `lint`, all ten no-database checks, and `npm run build` pass.
- The real components were rendered with this build's CSS, in dashboard-shaped
  cards, and measured on the browser's own text boxes:
  - **375px:** phone drawing shown, 0 overlapping labels, smallest text 8.9px,
    no sideways scroll.
  - **1440px:** desktop drawing shown and unchanged, 0 overlaps.
- **Not** checked signed in on a live school.
