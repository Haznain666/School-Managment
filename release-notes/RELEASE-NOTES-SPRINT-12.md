# Release notes — Sprint 12: Reports & analytics

**Status:** merged to `main`. **No database migration** — nothing to apply, and
nothing to configure. Ready to use.

Nine reports a school can filter, print on its own letterhead, and export to a
spreadsheet. They answer the questions a school is asked in writing — by a
board, by a parent, by an auditor — and they are documents rather than
dashboards: the charts and tiles are on the dashboards Sprint 10.5 built.

---

## What a school gets

A new **Reports** entry in the admin sidebar, leading to an index of every
report the person opening it is allowed to see, grouped under Academics, Fees
and People.

Each report has the same three things:

- **Filters** — a date range, a campus, a class, a term or a year, depending on
  what the report is about. They live in the address bar, so a filtered report
  can be sent to a colleague as a link and the browser's back button works.
- **Print** — the report on the school's own letterhead, through the browser's
  print dialog. The sheet carries the school's name and logo, the filters
  written out as a sentence, and the moment it was produced, so a printout found
  six months later still says what was asked for and when.
- **Export CSV** — the same rows as a spreadsheet file, totals included.

### Academics

| Report | Answers |
| --- | --- |
| **Attendance summary** | How many days each class was present for, over a date range |
| **Subject-wise attendance** | Which subjects lose the most teaching time to absence |
| **Academic results** | Pass rate, average, highest and lowest for every exam in a term |
| **Enrollment funnel** | Applications through to enrolled students, class by class |

### Fees

| Report | Answers |
| --- | --- |
| **Fee collection** | Billed against collected, class by class |
| **Outstanding & aging** | Every rupee owed, split across five age buckets |
| **Monthly revenue** | Twelve months of money in, and how it arrived |

### People

| Report | Answers |
| --- | --- |
| **Payroll summary** | The salary bill month by month, and what reduced it |
| **Leave summary** | Who took leave, how much, and how much was unpaid |

---

## Things worth knowing before reading a figure

Every report carries its own caveat on screen **and on the printed sheet**. A
number whose meaning depends on a rule nobody can see is how a school reports
the wrong figure to a board in good faith. The five that matter most:

**Subject-wise attendance is derived, not measured.** The register is taken once
a day, not once a period — that is what schools here report to their boards, and
a per-period register would multiply a teacher's marking by seven for a number
nobody asks for. So a day a child was away is charged against whichever subjects
their section had on the timetable that weekday. It is a real measure of
teaching time lost, and it is only as good as the timetable: **a section with no
timetable contributes nothing to this report.**

**Attendance percentages exclude holidays and count late as present.** A school
closure is not an absence and must not drag a percentage down; a child who
arrived late was in the class.

**Fee collection follows the billing, monthly revenue follows the cash.** In Fee
collection, a challan issued inside the range is billed there and whatever has
been paid against it is collected there, whenever the money arrived — so
Billed − Collected is exactly Outstanding. Monthly revenue is the other view:
what actually came in each month, split by cash, bank transfer and cheque.

**Academic results counts published papers only, and never turns an absence into
a zero.** A student is graded once every published paper carries a mark for
them; anyone absent from a paper, or not yet marked on one, is counted under
"Not graded" instead. This is the same rule the report card and the dashboard
charts follow, so the three cannot disagree about the same exam.

**The enrollment funnel is about the funnel, not the roll.** "Enrolled" means an
application became a student record. A school that enrols a child without an
application — a sibling, a walk-in, an imported roll — has students who appear
in no funnel.

---

## Who sees what

There is **no new permission to configure.** Each report is opened by the
permission that already governs the screen its data comes from: fee reports by
"See challans, the price list and fee reports", the payroll summary by "See
payroll runs and payslips", and so on. So an accountant opens the four financial
reports and nothing else, a coordinator opens the academic ones, and no school
has to set anything up.

A **branch administrator** sees only their own campus. The campus filter is not
shown to them at all, rather than shown and quietly ignored.

---

## The exported file

The CSV is written to open correctly in Excel on Windows, which is what a school
office runs. Two details in it are deliberate:

- It carries a byte-order mark, without which Excel reads the file in the
  system's own codepage and mangles every non-ASCII name.
- A cell whose text begins `=`, `+`, `-` or `@` is prefixed with an apostrophe.
  Spreadsheets execute those as formulas, and a name typed into a student record
  reaches every export the office opens.

Figures are exported as plain numbers, not as `12,500`, so a column of rupees
can be summed in the spreadsheet.

---

## What is not there yet

- **Nothing here has been seen in a browser.** The standing reason applies:
  signing in to a school portal from a development machine has never worked
  (Supabase Auth configuration, `STATE.md` §5d). Every query has been executed
  against the live database and against a real seeded school — the figures
  cross-check between reports that were written independently — but no screen
  and no printed sheet has been looked at.
- **Subject-wise attendance has never run against real data**, because no school
  in the database has a timetable. The query executes; it has had nothing to
  count.
- **Payroll, leave and enrollment-funnel likewise have no data yet** — the
  seeded school has no staff and no applications. The queries run and return
  correctly empty.
- **No charts.** These are tabular documents by design; the charts are the
  dashboards' (Sprint 10.5).
- **No scheduled or emailed reports.** Every report is pulled, not pushed.
- **No saved filter presets.** The URL is the preset — bookmark it.
