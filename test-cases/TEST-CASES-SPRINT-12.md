# Test cases — Sprint 12: Reports & analytics

Traces to [`RELEASE-NOTES-SPRINT-12.md`](../release-notes/RELEASE-NOTES-SPRINT-12.md).
**No migration, nothing to configure.**

**These are the figures a school reports to a board, a parent or an auditor.**
The note's own warning is the reason half these cases exist: "A number whose
meaning depends on a rule nobody can see is how a school reports the wrong
figure to a board in good faith."

So the caveat cases (04–08) are not documentation checks. **A correct number
with its caveat missing is a failed case**, because the reader will draw the
wrong conclusion from a right figure.

---

## Every report, three things each

#### UC-S12-01 · Filters live in the address bar and survive sharing — P2
**Role** Any report-holder · **Traces to** "They live in the address bar, so a filtered report can be sent to a colleague as a link and the browser's back button works"
1. Filter a report, copy the URL, open it in a clean session (with rights).
2. Use the back button after changing filters.
- **Expect** the link reproduces the same filtered report; back works.
- **Fail** if filters are held in memory — then the URL is not the preset, and the note says "The URL is the preset — bookmark it."

#### UC-S12-02 · The printed sheet carries school, filters and timestamp — P1 · **NEEDS PAPER**
**Role** Any report-holder · **Traces to** "the school's name and logo, the filters written out as a sentence, and the moment it was produced, so a printout found six months later still says what was asked for and when"
1. Print each report to real A4.
- **Expect** all four on the sheet, and the filters as a readable sentence rather than a query string.
- **Fail** if any is missing. A printout found later that cannot say what was asked is a figure nobody can defend.

#### UC-S12-03 · CSV rows match the screen, totals included — P1
**Role** Any report-holder · **Traces to** "**Export CSV** — the same rows as a spreadsheet file, totals included"
1. Export each report and compare row-for-row against the screen.
- **Expect** identical, with totals.

---

## The five caveats that must be on screen **and** on paper

#### UC-S12-04 · Subject-wise attendance is labelled as derived — P1
**Role** Coordinator · **Traces to** "**Subject-wise attendance is derived, not measured.** The register is taken once a day, not once a period… **a section with no timetable contributes nothing to this report**"
1. Open it, and print it.
- **Expect** the caveat on both, including the timetable dependency.
- **Fail** if it reads as measured per-period data. A head would conclude a subject is being skipped when the register simply is not per-lecture.

#### UC-S12-05 · A section with no timetable contributes nothing, visibly — P1
**Role** Coordinator · **Traces to** the same
1. Run it where at least one section has no timetable.
- **Expect** that section contributes nothing **and the report says so**.
- **Fail** if it silently reads as zero absence — indistinguishable from perfect attendance.

#### UC-S12-06 · Attendance percentages exclude holidays and count late as present — P1
**Role** Coordinator · **Traces to** "A school closure is not an absence and must not drag a percentage down; a child who arrived late was in the class"
1. Cross-check the attendance summary against the register and the parent portal for the same child and range.
- **Expect** identical, per UC-S06-08. The caveat appears on screen and on paper.

#### UC-S12-07 · Fee collection follows billing; monthly revenue follows cash — P1 · **NEEDS SEED**
**Role** Accountant · **Traces to** "In Fee collection, a challan issued inside the range is billed there and whatever has been paid against it is collected there, whenever the money arrived — so Billed − Collected is exactly Outstanding. Monthly revenue is the other view"
1. Create a challan in month 1 paid in month 2. Run fee collection for month 1 and monthly revenue for both.
- **Expect** month 1's fee collection shows it billed **and** collected; monthly revenue shows the cash in month 2. Billed − Collected ties exactly to Outstanding.
- **Fail** if the two reports are expected to agree — they answer different questions, and the caveat must say so on both.

#### UC-S12-08 · Academic results counts published papers only, never turning absence into zero — P1
**Role** Coordinator · **Traces to** "A student is graded once every published paper carries a mark for them; anyone absent from a paper, or not yet marked on one, is counted under 'Not graded'"
1. With one paper unpublished and one student absent, run academic results.
- **Expect** both land in **Not graded**; neither becomes a zero.
2. Compare against the report card and the dashboard charts for the same exam.
- **Expect** all three agree. "This is the same rule the report card and the dashboard charts follow, so the three cannot disagree about the same exam."

---

## The nine reports

#### UC-S12-09 · Attendance summary — P2 · **NEEDS SEED**
**Role** Coordinator · **Traces to** "How many days each class was present for, over a date range"
1. Run it over a range covering known register data.
- **Expect** figures cross-check with UC-S06-08 and with the register itself.

#### UC-S12-10 · Subject-wise attendance — P2 · **NEEDS SEED**
**Role** Coordinator · **Traces to** "Which subjects lose the most teaching time to absence"
1. Build a timetable for at least one section, then run it.
- **Expect** absence charged against the subjects that section had on the timetable that weekday.
- **Note** the release says this "**has never run against real data**, because no school in the database has a timetable. The query executes; it has had nothing to count." Build a timetable first or the case proves nothing.

#### UC-S12-11 · Academic results — P1 · **NEEDS SEED**
**Role** Coordinator · **Traces to** "Pass rate, average, highest and lowest for every exam in a term"
1. Run it for a term whose report cards and tabulation sheets you can open.
- **Expect** all four figures, tying exactly to Sprint 9's documents for the same exam (UC-S09-19).

#### UC-S12-12 · Enrollment funnel — P2
**Role** School administrator · **Traces to** "**The enrollment funnel is about the funnel, not the roll.**"
1. Run it at a school with directly enrolled students.
- **Expect** those students are **absent** from the funnel and the report says why. See UC-S04-14.
- **Note** the seeded school "has no staff and no applications" — the query "returns correctly empty".

#### UC-S12-13 · Fee collection — P1 · **NEEDS SEED**
**Role** Accountant · **Traces to** "Billed against collected, class by class"
1. Run it over a range with known challans and payments.
- **Expect** Billed − Collected ties exactly to Outstanding (UC-S05-10).

#### UC-S12-14 · Outstanding & aging — P1 · **NEEDS SEED**
**Role** Accountant · **Traces to** "Every rupee owed, split across five age buckets"
1. Run it with overdue challans of varying ages, including one cancelled and one waived.
- **Expect** five buckets, correctly assigned; the cancelled and waived amounts absent (UC-S05-08).

#### UC-S12-15 · Monthly revenue — P1 · **NEEDS SEED**
**Role** Accountant · **Traces to** "Twelve months of money in, and how it arrived"
1. Run it and add up the cash, bank transfer and cheque columns.
- **Expect** the splits sum **exactly** to the collected total — the release records verifying precisely that.
- **Fail** on any drift; it is the same money counted two ways.

#### UC-S12-16 · Payroll summary and Leave summary — P2
**Role** HR manager · **Traces to** "The salary bill month by month, and what reduced it" and "Who took leave, how much, and how much was unpaid"
1. Seed staff, salary structures, a paid payroll run and some leave. Run both.
- **Expect** the salary bill reconciles with the payslips, and unpaid leave is separated from paid.
- **Note** both currently have no data; the queries "run and return correctly empty". **Seed staff before treating an empty report as a defect.**

---

## Who sees what

#### UC-S12-17 · Each report is gated by its source screen's permission — P1
**Role** Accountant, coordinator · **Traces to** "an accountant opens the four financial reports and nothing else, a coordinator opens the academic ones, and no school has to set anything up"
1. Open the index as each role; attempt a report not listed, by URL.
- **Expect** the index lists only what they may open, and the URL refuses.

#### UC-S12-18 · A branch administrator is not shown the campus filter at all — P1
**Role** Branch administrator · **Traces to** "The campus filter is not shown to them at all, rather than shown and quietly ignored"
1. Open any campus-filterable report.
- **Expect** the filter is **absent**, and the data is their campus only.
- **Fail** if the filter is shown — an operator selecting another campus and seeing their own figures back would reasonably report the numbers as wrong.

---

## The exported file

#### UC-S12-19 · The CSV opens correctly in Excel on Windows — P1
**Role** Accountant · **Traces to** "It carries a byte-order mark, without which Excel reads the file in the system's own codepage and mangles every non-ASCII name"
1. Export a report containing Urdu or accented names. Open in Excel on Windows by double-clicking.
- **Expect** names render correctly.
- **Fail** on mojibake — and test by double-clicking, not by importing, which is a different code path.

#### UC-S12-20 · Formula injection is neutralised, and numbers stay summable — P1
**Role** Accountant · **Traces to** "A cell whose text begins `=`, `+`, `-` or `@` is prefixed with an apostrophe. Spreadsheets execute those as formulas, and a name typed into a student record reaches every export the office opens" and "Figures are exported as plain numbers, not as `12,500`"
1. Put a student name beginning `=` into a record. Export and open.
2. Sum a column of rupees in the spreadsheet.
- **Expect** the name is inert text; the column sums without cleaning.
- **Fail** if a formula executes, or if figures carry thousands separators.

---

## Not in this release

- **Nothing here has been seen in a browser** — the standing sign-in limitation.
  Every query was executed against the live database and the figures cross-check
  between independently written reports, "but no screen and no printed sheet has
  been looked at".
- **No charts** — tabular by design; charts are the dashboards' (Sprint 10.5).
- **No scheduled or emailed reports.** Every report is pulled, not pushed.
- **No saved filter presets** — the URL is the preset.
