# Test cases — Sprint 9: Exams, results & report cards

Traces to [`RELEASE-NOTES-SPRINT-09.md`](../release-notes/RELEASE-NOTES-SPRINT-09.md).
Migration `0016_sprint9_exams.sql`.

**"The artefact parents judge the entire system by."** A wrong report card is
not a defect report, it is a conversation between a head teacher and a family.
Nearly everything here is P1.

**Four rules that everything since has had to agree with**, and every one of them
is easy to implement backwards:

1. An absent paper still counts toward marks **available**, and contributes nothing to marks **obtained**.
2. A student absent from **any** paper takes **no position** in class.
3. A published re-sit replaces the original everywhere; the original stays in the table.
4. A report card only ever reads **published** papers.

Sprint 10.5's exam charts were built on the same rules through the same grading
helper, "so a chart cannot contradict the document printed beside it" — which
means UC-S09-19 belongs to this file, not to 10.5's.

---

## Terms, exams and papers

#### UC-S09-01 · Maximum marks are frozen on the paper — P1
**Role** School administrator · **Traces to** "a school that runs Mathematics out of 100 in the first term and out of 75 in the second must keep both answers, or a percentage recomputed later silently changes a report card that was already handed out"
1. Create Term 1 Mathematics out of 100 and Term 2 out of 75. Publish both.
2. Reopen Term 1's report card.
- **Expect** Term 1 still reads out of 100.
- **Fail** if it follows the subject's current maximum. A report card already in a parent's hands would then disagree with the one on screen.

#### UC-S09-02 · A paper carries its own pass mark, date and sitting — P2
**Role** School administrator · **Traces to** "one subject within an exam, with its own maximum marks, pass mark, date and sitting"

#### UC-S09-03 · The three gates are genuinely separate — P1
**Role** School administrator · **Traces to** "Announcing a datesheet, publishing one paper's marks, and issuing a term's report cards are three different decisions with three different audiences"
1. Announce a datesheet without publishing any marks.
2. Publish one paper's marks without issuing report cards.
3. Correct a second subject after the first is published.
- **Expect** each is possible independently.
- **Fail** if any two are collapsed — a school must be able to "tell students when an exam is without also showing marks that do not exist yet", and to "correct one subject in week three without having already put a half-finished report card in front of a parent".

---

## Marks entry

#### UC-S09-04 · An absent paper counts toward marks available, not as a zero — P1
**Role** Teacher, then parent · **Traces to** "An absent paper still counts towards the marks available, and contributes nothing to the marks obtained"
1. Mark a student absent on Paper 1 (out of 100); give 80/100 on Paper 2. Publish both.
2. Open the report card.
- **Expect** available 200, obtained 80, 40%.
- **Fail** if available reads 100. "A percentage that shrank its own denominator would let a child improve by missing their weakest paper."

#### UC-S09-05 · Absent and zero are different facts — P1
**Role** Teacher · **Traces to** "'Did not sit the paper' and 'sat it and scored nothing' are different things about a child, and a school is asked about both"
1. Record one student absent and another with 0. Read both on the report card, the tabulation sheet and the gradebook.
- **Expect** visibly distinct on all three.
- **Fail** if absence renders as 0 anywhere. The database CHECK "that an absent student has no mark" should also refuse it.

#### UC-S09-06 · A teacher enters and submits; publishing is somebody else's action — P1
**Role** Teacher · **Traces to** "**Publishing is somebody else's action** — the check on a teacher's marks, and the person a parent's complaint about a wrong grade comes back to"
1. As a teacher, save a draft and submit. Attempt to publish, by button and by route.
- **Expect** publish refused both ways.

#### UC-S09-07 · Draft marks are invisible to families — P1
**Role** Teacher, then parent and student · **Traces to** Sprint 13: "Draft marks are not something a family can see, which is exactly what Sprint 9 made publishing a separate, deliberate act for"
1. Save marks as a draft. Open the parent and student portals.
- **Expect** nothing appears.
- **Fail** on any leak, including through a direct URL.

#### UC-S09-08 · A re-sit does not drag the paper back into draft — P1
**Role** Teacher · **Traces to** "a re-sit sat in week six does not drag the whole paper back into draft and its marks do not appear the instant they are typed"
1. Publish a paper. Enter a re-sit for one student.
2. Check the published paper's state and whether the re-sit mark is visible.
- **Expect** the paper stays published for everyone else; the re-sit is not visible until it is itself published.

#### UC-S09-09 · A published re-sit replaces the original everywhere — P1
**Role** Teacher, then parent · **Traces to** "A published re-sit replaces the original everywhere; the original stays in the table, and the sheets mark the cell as a re-sit"
1. Publish a re-sit. Read the report card, tabulation sheet, gradebook and exam charts.
- **Expect** the re-sit mark everywhere, each flagged as a re-sit; the original still in the database.
- **Fail** if any surface still shows the original, or if the original was deleted.

---

## Grading

#### UC-S09-10 · A school with no scheme gets no letter grades — P1
**Role** School administrator · **Traces to** "A school that has configured no scheme gets **no letter grades**, and the report card says so with a dash"
1. At a school with no grading scheme, publish marks and open a report card.
- **Expect** a dash where the grade would be — not "F", not blank, not a default ladder.
- **Fail** if any letter appears. "Silently grading a school's children against numbers nobody at that school chose is exactly what this table exists to prevent."

#### UC-S09-11 · Two schools with identical marks grade differently — P1 · **NEEDS TENANCY**
**Role** Two school administrators · **Traces to** "Every school in this market grades differently… A hard-coded table would be wrong for all three"
1. Configure A1/A/B from 80/70/60 at one school and an O-Level ladder at another. Enter identical marks.
- **Expect** different letters, per each school's own bands.

#### UC-S09-12 · A scheme with no GPA is allowed — P2
**Role** School administrator · **Traces to** "a primary school may want 'Excellent / Good / Needs work' and no GPA at all"
1. Configure word bands with no GPA.
- **Expect** accepted; the report card shows the words and no GPA column.

---

## Position in class

#### UC-S09-13 · A student absent from any paper takes no position — P1
**Role** School administrator · **Traces to** "Schools award prizes by position and do not rank a child who did not sit everything against children who did"
1. In a class where one student missed one paper, publish the term and open the report card and tabulation sheet.
- **Expect** that student has **no position**; the others' positions are unaffected by their exclusion.
- **Fail** if they are ranked. Prizes are awarded from this.

---

## The three documents

#### UC-S09-14 · The report card carries all six elements — P2 · **NEEDS PAPER**
**Role** School administrator · **Traces to** "subject marks, totals, position in class, grade, attendance for the term, and remarks"
1. Print one to real A4.
- **Expect** all six present and readable; the term attendance obeys the Sprint 6 formula (UC-S06-08).

#### UC-S09-15 · A report card only ever reads published papers — P1
**Role** School administrator · **Traces to** "A report card only ever reads published papers"
1. With three papers published and one still in draft, issue the report card.
- **Expect** the draft paper is absent from both the marks and the totals — including the denominator.
- **Fail** if an unpublished paper's maximum is counted while its mark is not; that reads as a child failing a paper nobody has marked.

#### UC-S09-16 · The tabulation sheet **includes** unpublished marks, flagged — P1
**Role** Principal · **Traces to** "It deliberately *includes* unpublished marks, flagged, because reviewing them is its whole purpose"
1. Open the tabulation sheet with some papers unpublished.
- **Expect** they appear, clearly flagged.
- **Fail** if they are hidden — the sheet exists to review them, and a principal reviewing a partial grid would sign off on nothing.

#### UC-S09-17 · An admit card issues once the datesheet is announced — P2
**Role** School administrator · **Traces to** "issuable once the datesheet is announced"
1. Before announcing, attempt to issue. Announce, then issue.
- **Expect** refused, then one card per student carrying the datesheet.

#### UC-S09-18 · A parent's report card is the same sheet the school issues — P1 · **NEEDS PAPER**
**Role** Parent · **Traces to** Sprint 13: "Not a second version of it: the same component, from the same query, so a figure a parent reads on screen cannot differ from the one on the paper in their hand"
1. Print from the parent portal and from the admin side. Compare figure by figure.
- **Expect** identical.

---

## Charts must agree with the documents

#### UC-S09-19 · Exam charts use the school's own bands, and agree with the report card — P1
**Role** School administrator · **Traces to** "Grades are bucketed by **the bands your school configured**, through the same rule that grades the report card… the chart cannot contradict the document printed from the same marks"
1. Open the grade distribution, subject averages and pass rate for an exam.
2. Compare against the tabulation sheet for the same exam.
- **Expect** they agree exactly.
- **Fail** on fixed percentage buckets, or any disagreement with the printed sheet.

#### UC-S09-20 · Absent students are in no band and no pass rate, and the chart says so — P1
**Role** School administrator · **Traces to** "Students absent from a paper are in no grade band and no pass rate, and each chart says who it left out"
1. With absentees present, read each chart.
- **Expect** they are excluded **and** the exclusion is stated on the chart.
- **Fail** if excluded silently — a pass rate whose denominator is unexplained is a figure reported to a board in good faith and wrong.

#### UC-S09-21 · Every chart emits its figures as a table — P2
**Role** Screen-reader user · **Traces to** Sprint 10.5: "alt text can summarise a trend but a parent checking their child's results needs the numbers"
1. Read each exam chart with a screen reader.
- **Expect** the underlying figures are available as a real table.

#### UC-S09-22 · Tenancy holds across all six exam tables — P1 · **NEEDS TENANCY**
**Role** Two schools · **Traces to** the verification: "six tables, `location_id` on all six and indexed"
1. Attempt to reach another school's exam, paper, result and report card by ID.
- **Expect** refused in every case.

---

## Not in this release

- **A per-subject bar on the report card.** Still not built, deliberately: "it
  changes a print template that has never been checked against a real printer."
  Gated on the **NEEDS PAPER** sign-off. Do not raise it.
- **Promotion on the strength of results** — Sprint 10.
