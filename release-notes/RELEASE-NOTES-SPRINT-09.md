# Release notes — Sprint 9: Exams, results & report cards

**Status:** shipped. Migration `0016_sprint9_exams.sql`, applied and verified
2026-08-09. Driven through a browser against the live database.

The keystone of the pilot release. A school's academic year is organised around
exams, and three things already promised elsewhere — an academic results report,
a parent-facing report card, a student results history — could not exist until
this did.

---

## What a school gets

### Terms, exams and papers

**Exam terms** — the unit a report card is issued for, inside an academic year.
**Exams** — one term's examination for one section, with a datesheet.
**Papers** — one subject within an exam, with its own maximum marks, pass mark,
date and sitting.

Maximum marks are frozen on the paper, not read from the subject: a school that
runs Mathematics out of 100 in the first term and out of 75 in the second must
keep both answers, or a percentage recomputed later silently changes a report
card that was already handed out.

### Marks entry

A teacher enters one paper for one section on one screen, saves as a draft, and
submits it. **Publishing is somebody else's action** — the check on a teacher's
marks, and the person a parent's complaint about a wrong grade comes back to.

**Absence is a fact, not a zero.** "Did not sit the paper" and "sat it and
scored nothing" are different things about a child, and a school is asked about
both.

**Re-sits** are a second attempt at the same paper, with their own publication
state, so a re-sit sat in week six does not drag the whole paper back into draft
and its marks do not appear the instant they are typed.

### Grading, in the school's own terms

**Grading schemes and bands, per school.** Every school in this market grades
differently — one runs A1/A/B from 80/70/60, another an O-Level ladder, a
primary school may want "Excellent / Good / Needs work" and no GPA at all. A
hard-coded table would be wrong for all three, and the first school that asked
for its own would need a deploy.

A school that has configured no scheme gets **no letter grades**, and the report
card says so with a dash. Silently grading a school's children against numbers
nobody at that school chose is exactly what this table exists to prevent.

### Three documents

- **Report card** — subject marks, totals, position in class, grade, attendance
  for the term, and remarks. This is the artefact parents judge the entire
  system by, which is why it shipped in the same sprint as the marks.
- **Tabulation sheet** — the class-wide grid a principal reviews after exams,
  with totals, grades and position holders. It deliberately *includes*
  unpublished marks, flagged, because reviewing them is its whole purpose.
- **Admit card** — one per student per exam, carrying the datesheet, issuable
  once the datesheet is announced.

### Three separate gates

Announcing a datesheet, publishing one paper's marks, and issuing a term's
report cards are three different decisions with three different audiences.
Collapsing any two would mean a school could not tell students when an exam is
without also showing marks that do not exist yet, or could not correct one
subject in week three without having already put a half-finished report card in
front of a parent.

### Permissions

`exams.read`, `exams.write`, `exams.publish`, `results.enter`,
`results.publish` — with a teacher holding `results.enter` and not
`results.publish` by default, which is the whole marks-entry design.

---

## Rules that everything since has had to agree with

- **An absent paper still counts towards the marks available**, and contributes
  nothing to the marks obtained. A percentage that shrank its own denominator
  would let a child improve by missing their weakest paper.
- **A student absent from any paper takes no position in class.** Schools award
  prizes by position and do not rank a child who did not sit everything against
  children who did.
- **A published re-sit replaces the original everywhere**; the original stays in
  the table, and the sheets mark the cell as a re-sit.
- **A report card only ever reads published papers.**

Sprint 10.5's exam charts were built on these same rules, through the same
grading helper, so a chart cannot contradict the document printed beside it.

---

## Not in this release

- Charts of any kind — the charting decision had not been made. Grade
  distribution, subject averages and pass rate arrived with Sprint 10.5.
- A per-subject bar on the report card itself. Still not built, deliberately: it
  changes a print template that has never been checked against a real printer.
- Any promotion of a student to the next class on the strength of their
  results — Sprint 10.

---

## Verification

The migration was verified against the database's own catalogue rather than by
trusting the tool's exit code: six tables, `location_id` on all six and indexed,
19 foreign keys, and the CHECK constraints including the rule that an absent
student has no mark. Purely additive — no existing table altered.

The module was driven through a browser against live data, which not everything
in this product has been.
