# Test cases — Sprint 14: Exam terms, datesheets, descriptors and promotion

Traces to [`RELEASE-NOTES-SPRINT-14.md`](../release-notes/RELEASE-NOTES-SPRINT-14.md).
Migrations `0029` and `0030`, both **APPLIED** to the live database.

## Status — 2026-08-22

Sprint 14 went through one static QA pass and one live pass. The static pass
raised twelve findings; running the sprint's own rules against the real schema
raised a thirteenth. **All thirteen are fixed** — commits `892927c`, `8c2674e`,
`c74c747`, `82f9262`, `5572da0`, `7a57c2f`.

| Mark | Meaning |
| --- | --- |
| ✅ | executed and passing |
| 🔁 | **was a defect, now fixed — re-run this first** |
| ⬜ | not executed: needs seed data, a printer, or a second tenant |

**What was actually executed.** A 34-assertion integration suite against the
live schema, covering every rule the database is meant to enforce: **34 of 34
pass**. Plus, in the browser as a signed-in school administrator: the exams
module, the settings screen, descriptor rendering and contrast, the new
promotions screen, and the sidebar. Console clean, no errors.

**What was not.** Anything needing a populated term. The test school has three
students, two subjects and no exam terms, so no report card, tabulation sheet or
parent portal has been rendered with real results. The 🔁 cases below are where
that matters most — the fix is in and typechecked, but the *rendering* of a
descriptor report card has not been seen by a human.

⚠ **Seed before starting.** Several cases need state a fresh school lacks:

- **two grades on different mechanisms** in one year — one `marks_grades`, one
  `descriptors` — each with two active sections;
- a class with **papers of unequal maxima** (Mathematics out of 100, Art out of
  20). This is the *only* way the mean-versus-ratio cases can differ, and it is
  why the defect behind UC-S14-43 survived review;
- **three teachers**: class teacher of section A, class teacher of section B, and
  one timetabled to A as a subject teacher and class teacher of nothing;
- a school with **no grading bands at all**, for the em-dash cases;
- a **second school**, for tenancy.

---

## Terms — naming, ordering, archiving

#### UC-S14-01 · A term name is capped at fifty characters — P3 ✅
**Role** School administrator (`exams.write`)
1. **Exams → Terms & datesheets → New term**. Type 60 characters into the name.
- **Expect** the counter to show the limit and the save to be refused naming 50.
- **Verified at the database:** a 51-character name is refused by
  `exam_terms_name_length_check`. The CHECK is the backstop; a clerk should meet
  the counter first.

#### UC-S14-02 · A term name is unique within a year among unarchived terms — P2 ✅
1. Create **Mid-Term** twice in one session. → refused
   (`exam_terms_location_year_name_idx`).
2. Create **Mid-Term** in a *different* year. → saves. Uniqueness is per year.

#### UC-S14-03 · Archiving a term frees its name — P2 ✅
1. Archive **Mid-Term**, create a new **Mid-Term** in the same year.
- **Verified:** accepted. The index is partial on `archived_at IS NULL`. A
  refusal here would mean a school can never reuse a name it has retired.

#### UC-S14-04 · A school may keep as many terms as it likes — P3 ⬜
Create six terms in one year. No cap, no warning.

#### UC-S14-05 · Sequence order drives the reading order everywhere — P2 ⬜
1. Create three terms, drag **Final Term** to the top.
2. Check the terms screen, the **Report cards** picker, the teacher's **My
   exams**, and the **Result history** table on the parent portal.
- **Fail** if any falls back to start date. Half the terms may now have no start
  date at all, and a list ordered by a column half the rows lack rearranges
  itself.

#### UC-S14-06 · Reorder is one transaction — P2 ⬜
Drag a term, reload immediately. No two terms sharing a position, no gap.

#### UC-S14-07 · A reorder payload mixing two years is refused — P3 ⬜
`PATCH /api/school/exam-terms/reorder` with terms from two years → 400. A 200
means a silent renumber of a year nobody was looking at.

#### UC-S14-08 · A term's dates may be left blank — P2 ⬜
1. Create a term with no dates; give it a schedule running 3–14 Nov.
- **Expect** the header to show 3–14 Nov, derived from its schedules.
- **Expect** that term's report-card attendance to count the same window.
- **Fail** on 0% attendance for the whole class — that is how a null window
  counting nothing disappears a class's register with nothing saying so.
- *(Insertion of a dateless term is verified; the derived window is not.)*

#### UC-S14-09 · A term's own dates sit inside the academic year — P2 ⬜
Set a term's start to `2028-01-05` on a 2026–27 session → refused, naming the
real bounds.

#### UC-S14-10 · Archiving a term archives the whole tree — P1 ⬜
Build a term → one schedule → two grades → six papers → generate. Archive the
term. Check `exam_terms`, `exam_schedules`, `exam_schedule_grades`,
`exam_schedule_subjects`, `exams`, `exam_subjects`.
- **Expect** `archived_at` set on every row of all six. **Zero rows deleted.**

#### UC-S14-11 · An archived term does not lock its classes out of a new one — P1 ✅
1. Archive the term above; create a new term, a schedule, the same two grades.
- **Verified at the database:** archiving an `exam_schedule_grades` row releases
  that grade for another schedule in the term.
- **Fail** would be a refusal naming a term that appears on no screen — the
  partial index still holding live rows under an archived schedule. This is the
  subtlest failure the design allows and the one with no way out through the UI.

#### UC-S14-12 · An archived term's exams vanish from every picker — P1 🔁
**Was a defect.** `archived_at` was written by three paths and read by four
readers out of twelve, so **a teacher could still enter and save marks against a
term the school had deleted** — `teacherOwnsPaper` and `getExamPaper` both
ignored it. Fixed in `892927c`.
1. Archive a generated term. Check: the admin exam list, the exam page, its
   **Tabulation**, the teacher's **Marks** list, the **Gradebook**, and the
   parent's **Datesheet**.
- **Expect** absent from all six.
- **Expect** `POST /api/school/exam-subjects/{id}/results` on one of its papers
  to be refused.

#### UC-S14-13 · Historical report cards still render after archiving — P1 ⬜
Publish a term, print a card, archive the term, re-open that card.
- **Expect** it to render exactly as issued. Archiving is what Delete now means,
  and a school that loses its issued cards by pressing Delete has lost the
  record.

---

## Datesheets

#### UC-S14-14 · A term holds more than one datesheet — P2 ✅
**Junior** (Grades 1–3, 1–10 Oct) and **Senior** (Grades 4–5, 15–25 Oct) under
one term. Verified: two schedule instances, each with its own window.

#### UC-S14-15 · One datesheet carries several classes — P2 ✅
Multi-grade assignment verified.

#### UC-S14-16 · A class cannot sit two datesheets in one term — P1 ✅
1. With Grade 3 on **Junior**, add Grade 3 to **Extra**.
- **Verified:** refused by `exam_schedule_grades_term_grade_idx`.
- **Still to check in the UI:** that the refusal reads as a sentence naming
  *Junior*, not a raw `duplicate key value violates unique constraint`. The
  index is the guarantee; the sentence is the requirement.
2. Repeat by *editing* **Extra** rather than creating it — both authoring paths
   enforce it.

#### UC-S14-17 · A schedule's own grades are not a conflict with itself — P2 ⬜
Open **Junior**, change only the name, save. **Fail** if it refuses with "Grade 3
already sits Junior" — the edit path must exclude the schedule being edited.

#### UC-S14-18 · Schedule dates fall inside the academic year — P2 ⬜
Start `2027-06-01` on an Apr–Mar session → refused, naming the session's bounds.

#### UC-S14-19 · A schedule ends on or after it starts — P3 ✅
Verified: refused by `exam_schedules_dates_check`. A schedule with **no** end
date is accepted — optional by design.

#### UC-S14-20 · A paper's date sits inside its schedule's window — P2 🔁
**Was a defect.** The upper bound was only applied when the schedule had an end
date, and the end date is optional — so `2099-01-01` was accepted onto a 2026–27
datesheet. Fixed in `5572da0`: papers are now bounded by the session too.
1. Schedule 3–14 Nov, paper on `2026-11-20` → refused, naming the window.
2. Clear the end date, paper on `2099-01-01` → refused, naming the session.

#### UC-S14-21 · A subject appears once per datesheet — P3 ✅
Verified: refused by `exam_schedule_subjects_schedule_subject_idx`.

#### UC-S14-22 · A paper carries date, time, duration and both marks — P2 ✅
Round-trip of all five verified. Duration 700 → refused (1–600). Pass mark above
maximum → refused.

#### UC-S14-23 · Marks are required in marks mode and refused in descriptor mode — P1 🔁
**Was a defect (F13).** `exam_schedule_subjects_marks_check` was
`(both null) OR (max > 0 AND passing >= 0 AND …)`, which for
`max = 100, passing = NULL` evaluates to `FALSE OR NULL` = **NULL** — and
Postgres passes a CHECK unless it is FALSE. The constraint read as a pairing
rule and enforced nothing. Migration `0030` rewrites it with `num_nonnulls`;
`5572da0` closes the route in (the parser demanded the pair only once it knew
the mechanism, and a schedule with no grades yet has none).
1. Marks-mode schedule, maximum left blank → refused.
2. Descriptor-mode schedule → the marks fields are absent from the form; refused
   if reached through the API.
3. **Half-configured row (max marks, no pass mark) → refused.** Verified.

#### UC-S14-24 · Classes judged differently cannot share a datesheet — P2 ⬜
Put a `marks_grades` grade and a `descriptors` grade on one schedule → refused,
naming both. Generating from it would have to write a marks paper and a
descriptor paper from one row.

#### UC-S14-25 · Archiving a datesheet frees its classes — P1 ✅
Verified at the database, same mechanism as UC-S14-11. Confirm the archive of
`exam_schedule_grades` happens in the **same statement batch** as the schedule's.

---

## Generate

#### UC-S14-26 · One datesheet becomes every section's papers — P1 ⬜
**Junior** on Grades 1–3 (four active sections), six papers. Generate.
- **Expect** four exams, twenty-four papers, each carrying the datesheet's date,
  slot, order, maximum and pass mark. Closed sections get nothing.

#### UC-S14-27 · Generate is idempotent — P1 ⬜
Press it twice. Same four exams, same twenty-four papers, second response
reporting zero created and twenty-four updated.

#### UC-S14-28 · Moving a paper's date updates every section — P2 ⬜
Move Mathematics 5 Nov → 7 Nov, raise 50 → 100, regenerate. All four sections
follow. **Fail** on a second Mathematics paper appearing beside the first.

#### UC-S14-29 · A dropped subject with marks is archived, not deleted — P1 ⬜
Enter marks for Art, remove Art from the datesheet, regenerate.
- **Expect** the response to say one paper was archived and that it carried
  marks; the `exam_subjects` row still present with `archived_at` set; its
  `exam_results` untouched.

#### UC-S14-30 · A paper added by hand is left alone — P2 ⬜
A paper with no `schedule_subject_id` is neither updated nor archived.

#### UC-S14-31 · Removing a class from a datesheet removes its papers — P1 🔁
**Was the worst defect in the sprint.** Dropping a grade archived only the grade
row. The generate loop walks the schedule's *current* grades, so the dropped
class's exams and papers stayed live and attached — and the class was then free
of the partial index, so it could join a second datesheet and generate a **second
full set of papers against the same children**. `getSectionReportCards` selects
by term and section with no schedule filter, so every subject appeared twice and
the marks available doubled: **every child's percentage halved, with nothing on
any screen saying why.** Fixed in `892927c`.
1. **Junior** on Grades 3 and 4. Generate. Both have papers.
2. Edit **Junior** to Grade 3 only, regenerate. → Grade 4's exams and papers
   archived, response says so.
3. Put Grade 4 on a new schedule in the same term, generate.
4. Open a Grade 4 report card. **Each subject exactly once.**

#### UC-S14-32 · Generate refuses an empty or unassigned datesheet — P3 ⬜
No papers → asks for papers. No classes → asks for classes.

#### UC-S14-33 · A descriptor datesheet generates papers with no marks anywhere — P1 ⬜
- **Expect** `max_marks = 1`, `passing_marks = 0` in the database and the number
  `1` on **no** screen — not the marks sheet, report card, portal or print.
- **Fail** on "out of 1" or a child showing 0%.

---

## The two mechanisms — the seam this sprint lives or dies on

#### UC-S14-34 · A descriptor class shows no marks column anywhere — P1 ⬜
Walk all seven surfaces for one `descriptors` class: teacher **Marks**, admin
marks, **Report cards** on screen, **Report cards → Print**, parent portal,
student portal, **Tabulation**.
- **Expect** Subject / Sub-category / Comment on every one. No Marks, no %, no
  Grade, no Position, no GPA.
- **This is the single most important case in the suite.** The mechanisms are
  alternatives, and one screen that forgot is a parent reading 0% for a
  five-year-old.

#### UC-S14-35 · The tabulation sheet honours the mechanism — P1 🔁
**Was a defect.** `getTabulation` was never given a descriptor path and
`TabulationDocument` was never touched. Because generate writes `max_marks = 1`,
a descriptor class tabulated as **0% for every child**, and `assignPositions`
turned that into **a class of joint firsts** — a sheet a principal would have
acted on. Fixed in `8c2674e`: the grid resolves the mechanism, drops the total,
percentage, grade and position columns and the position-holders block, and draws
each child's descriptor instead.
1. Open **Tabulation** for a descriptor exam (admin) and via the teacher's
   **Gradebook**.

#### UC-S14-36 · A marks class shows no sub-category column anywhere — P1 ⬜
Same seven surfaces. Subject / Marks / % / Grade / Comment. No chips.

#### UC-S14-37 · Marks are refused for a descriptor class — P1 ⬜
`POST …/results` with `marksObtained: 45` → 400, no row written.

#### UC-S14-38 · A sub-category is refused for a marks class — P1 ⬜
`POST` with `subcategoryId` on a marks paper → 400.

#### UC-S14-39 · A descriptor row is writable at all — P1 ✅
**Verified at the database.** A present child with no mark, a descriptor and a
comment saves. The old `exam_results_marks_check` demanded a mark whenever
`is_absent` was false, which made the only valid descriptor row unwritable;
`0029` relaxes it. Also verified: an **absent** child carrying a mark is still
refused, and a negative mark is still refused.

#### UC-S14-40 · An absent child carries no mark and no descriptor — P2 ⬜
Saved row has `is_absent = true`, `subcategory_id` null; the card prints **ABS**,
not a chip.

#### UC-S14-41 · The mechanism is frozen on an issued card — P1 ⬜
Run and publish a descriptor term for Grade 1. Change Grade 1 to `marks_grades`
for next year *and* the current one. Re-open last term's card.
- **Expect** it still renders as a descriptor sheet. **Fail** if it re-renders as
  a marks sheet with every column empty — a parent's kept document changing
  shape under them.

#### UC-S14-41a · The failing descriptor is frozen too — P2 🔁
**Was a defect (F11).** The card counted "subjects needing attention" against
the class's *current* failing descriptor, so changing it rewrote the count on
cards issued last year. `0030` adds
`student_term_results.failing_subcategory_id`, frozen at compute time.
1. Compute and publish a descriptor term. Change the grade's failing descriptor.
2. Re-open the issued card. **The count is unchanged.**

---

## Grading

#### UC-S14-42 · The overall percentage is the mean of the subject percentages — P1 ⬜
Mathematics 40/100 (40%), Art 18/20 (90%). Publish. Read
`student_term_results.overall_percentage`.
- **Expect 65.0** — the mean. **Fail** on 48.3 (58 ÷ 120). A 20-mark Art paper
  should not count a fifth of a 100-mark Mathematics paper towards whether a
  child moves up.

#### UC-S14-43 · One percentage per term, on every surface — P1 🔁
**Was a defect.** The card and the parent summary printed total-over-total while
the history table and the promotion engine used the mean. Both render on the
same page: a parent saw **48.3% · C** on the card and **65.0% · B** for the same
term three inches below, and the promotion decision had been taken on the second
while the document they keep carried the first. Fixed in `c74c747` — the mean is
authoritative, and the band, GPA and remark resolve from it too. The marks
column still totals honestly; it is simply not what the percentage is from.
1. Open the parent portal for the UC-S14-42 child.
- **Expect** the summary figure, the history row and the printed card to be one
  number with one letter.
- *The two only diverge when maxima differ — which is why this survived review.*

#### UC-S14-44 · Below every band is `U`, not blank — P2 ⬜
Bands starting at 33, overall mean 20% → **U**.

#### UC-S14-45 · A school with no bands grades nothing, and that is not `U` — P1 ⬜
On a school with **no grading scheme at all**, publish a term.
- **Expect an em dash** in every grade column, on screen and on paper.
- **Fail** on **U**. "This school does not grade" and "this child failed" are
  different facts, and turning the first into the second on a printed card is a
  letter to a parent the school did not write.

#### UC-S14-46 · An absent paper contributes no percentage to the mean — P2 ⬜
Mathematics 40/100, absent for Art → mean 40.0 from one paper, while the card's
*marks available* still counts Art (the Sprint 9 rule, unchanged).

---

## Sub-categories and the colour switch

#### UC-S14-47 · A school opens with four descriptors — P3 ✅
**Verified on the live database after `0029`:** Exceeding `#22C55E`,
Satisfactory `#3B82F6`, Emerging `#F59E0B`, Needs Improvement `#EF4444`, in that
order, seeded for the existing school. Still to check: a **newly provisioned**
school gets the identical four, so a school created either side of the migration
behaves the same.

#### UC-S14-48 · Create, rename, recolour, reorder — P2 ✅
Create and delete verified through the API. A duplicate label differing only by
case is refused (`result_subcategories_location_label_idx`, on
`lower(btrim(label))`). A malformed colour is refused; a null colour is allowed.
Drag-reorder itself not exercised.

#### UC-S14-49 · Colour on paints a chip with readable text — P2 ✅
**Verified in the browser** by measuring computed styles against WCAG:

| Descriptor | Background | Foreground | Contrast |
| --- | --- | --- | --- |
| Exceeding | `#22C55E` | dark slate | **7.83:1** |
| Needs Improvement | `#EF4444` | dark slate | **4.74:1** |
| a dark navy `#1E3A8A` | navy | **light** | **9.90:1** |

The navy case is the one that matters: the foreground **flipped to light**, so
the contrast is computed rather than hard-coded. All three clear AA.

#### UC-S14-50 · Colour off is plain text, not a grey chip, everywhere — P1 ⬜
Switch the toggle off, then check all eight surfaces: settings, teacher marks
sheet, promotion sheet, report card on screen, report card **printed**, parent
portal, student portal, result history.
- **Expect** the plain label — no pill, no background, no rounded corner.
- One implementation exists (`components/exams/SubcategoryBadge.tsx`) and a
  static sweep confirmed every surface goes through it, so this should hold; it
  has not been watched.

#### UC-S14-51 · The colour switch is retroactive — P1 ⬜
Issue cards with colour on, switch it off, re-open and print a card from last
month. **Fail** if it keeps its colour — that would mean the colour was copied
onto the row.

#### UC-S14-52 · Deleting a descriptor in use is refused with a count — P1 ⬜
Award **Emerging**, then delete it.
- **Expect** a refusal naming the counts and offering **Archive**.
- **Fail** on a 500, a silent success, or a message that says only "in use". A
  number is a decision a head can make; "in use" is not.

#### UC-S14-53 · Archiving a descriptor hides it from pickers and keeps history — P1 ⬜
Archive **Emerging**. Gone from every picker; every card it was awarded on still
prints **Emerging** with its colour. **Fail** on an em dash there.

#### UC-S14-54 · A descriptor named as a class's fail is not silently lost — P3 🔁
**Was a defect (F10).** The deletion guard counted awards but not the classes
naming a descriptor as their *failing* one, so it could be archived with no
warning; the criteria picker then excluded it, the screen showed "none chosen",
and the next save cleared the school's failing descriptor — after which that
class could never hold anybody back. Fixed in `5572da0`.
1. Set **Needs Improvement** as a grade's failing descriptor, then delete it.
- **Expect** a refusal naming how many classes depend on it.

---

## Promotion criteria and the engines

#### UC-S14-55 · A class with no criteria row behaves as before — P1 ⬜
Never open the screen; run a term and recompute. Marks and grades, the school's
default scheme, everybody promoted.
- **Fail** if anybody is held back. The product has never withheld a promotion
  by itself and this sprint must not start.

#### UC-S14-56 · A null criterion is not applied, not treated as zero — P1 ⬜
Set **only** a minimum overall percentage of 40. The decision turns on that
alone, and the reason mentions neither subjects nor attendance.

#### UC-S14-57 · The reasons explain the decision — P2 ⬜
Each child's status carries the rules that produced it, in plain sentences. A
status with no explanation is a status that gets overridden on a hunch.

#### UC-S14-58 · Descriptor promotion counts the failing descriptor — P2 ⬜
Failing descriptor **Needs Improvement**, at most 2. Three → not promoted; two →
promoted; both reasons name the counts. Clear the failing descriptor → everybody
promoted, with a reason saying none is set.

#### UC-S14-59 · A limit with no failing descriptor is refused — P3 ⬜
"At most 2 failing" with none chosen → refused. A rule that can never fire is a
rule a school believes is protecting it.

#### UC-S14-60 · An empty register does not fail a child on attendance — P1 ⬜
Minimum attendance 75% on a class whose register was never taken → everybody
promoted, no attendance reason. **Fail** if the class is held back at 0% — that
is failing children for the school's own omission.

#### UC-S14-61 · Only the fields the mechanism reads are shown — P3 ⬜
Toggling the radio swaps the field set; never both.

#### UC-S14-61a · Criteria validation — P3 ✅
Verified at the database: an invented mechanism is refused; the same grade twice
in one year is refused; a percentage above 100 is refused.

---

## The override

#### UC-S14-62 · A class teacher may change their own class's status — P1 ⬜
Change a child from promoted to not promoted with a 30-character reason. Saves,
badge reads **Overridden**, reason shows beside the child.

#### UC-S14-63 · A reason under ten characters is refused — P1 ✅
**Verified at the database:** disagreeing with no reason is refused; a 9-character
reason is refused; a real reason is accepted — all by
`student_term_results_override_check`.
- **Still to check in the UI:** that the class teacher meets a **422 with a
  sentence**, not a 500 naming the constraint. The CHECK is the backstop.

#### UC-S14-64 · Setting the status back clears the override completely — P1 ✅
**Verified:** the database refuses to leave **half an override** behind — status
reverted with the reason kept is rejected. Reverting properly clears it.
- **Still to check:** `overridden_by` and `overridden_at` clear too, and the
  reason disappears from both portals and the printed card.

#### UC-S14-65 · The form and the server agree about what needs a reason — P1 🔁
**Was a defect (F6).** The sheet compared the draft against a `computedStatus`
recomputed on every read; the route compared against the one **stored** on the
row. They part company the moment marks or criteria change after a recompute,
and the failure was cruel: the sheet said *"this matches what the rules decided,
so no reason is needed"*, enabled **Save**, and the request came back **422**
demanding a reason with no field on screen to type it into. Fixed in `82f9262` —
the sheet now gates on the stored value the route uses, and still shows the live
one and its reasons as guidance.
1. Recompute a class. Raise `min_overall_percentage` past a child's mean.
2. Without recomputing, set that child to the status the screen says the rules
   now decided, and **Save**. It must succeed, or ask for the reason *before*
   letting you press Save.

#### UC-S14-66 · Recompute keeps a live override — P1 ⬜
Override a child, press **Recompute the class**. The override, its reason, who
set it and when all survive. A head who decided something in March is not
reversed by a clerk pressing a button in April.

#### UC-S14-67 · Recompute drops an override the rules now agree with — P2 🔁
**Was a defect (F9).** The recompute cleared `override_reason` but left
`overridden_by` and `overridden_at` pointing at an override that no longer
existed — the exact "half an override" the design set out to prevent, and the
`PATCH` path already cleared all three. The row's meaning depended on which door
it came through. Fixed in `5572da0`.
1. Override a child to promoted; lower the bar so the rules agree; recompute.
- **Expect** all three columns cleared, not just the reason.

#### UC-S14-68 · The overall descriptor is settable, and only in descriptor mode — P2 ⬜
Set it from the promotion sheet; it appears on the card's Overall row, both
portals and the history. Sending `overallSubcategoryId` for a marks class → 400.

---

## Who may decide — the permission matrix

#### UC-S14-69 · The key exists in both places — P1 ✅
**Verified:** `results.promotion` is present in the live
`role_permissions_permission_check` constraint, and in `PERMISSIONS`, the `exams`
group, the labels, the descriptions and `DEFAULT_ROLE_PERMISSIONS` for
`school_admin`, `branch_admin` and `principal`.
- **Fail** would be a key in `PERMISSIONS` but not the role defaults — existing,
  assignable by hand, and held by nobody.

#### UC-S14-70 · A teacher does not hold `results.promotion` — P1 ⬜
**Settings → Roles & permissions**, teacher row: unticked by default. A role key
would hand every teacher in the school every class in it.

#### UC-S14-71 · A subject teacher of the section is refused — P1 ⬜
Timetabled to section A but not its class teacher: `PATCH …/sections/{A}/results`
→ **403**; **Promotions** absent from their nav; the page refuses a typed URL.
This is the exact person the design excludes — they mark one paper and have no
view of the child's year.

#### UC-S14-72 · The class teacher of A is refused for B — P1 ⬜
→ 403. Being a class teacher somewhere is not being one everywhere.

#### UC-S14-73 · The `GET` is gated the same way as the `PATCH` — P1 ⬜
Reading a class's promotion statuses is the same fact as writing one.

#### UC-S14-74 · A `results.promotion` holder can reach the feature — P1 🔁
**Was a defect (F4).** The only promotions UI was `/teacher/promotions`, behind
`requireSchoolRole(['teacher'])`. A principal, school admin or branch admin
holding the new key **had no screen at all**, so `student_term_results` rows only
came into existence when a named class teacher pressed **Recompute the class** —
and a school that had named no class teachers got no promotion status on any
report card and no way to produce one. The sprint's headline feature, unreachable
for the three roles the key was created for. Fixed in `8c2674e`.
1. **Verified in the browser** as a school administrator:
   `/dashboard/exams/promotions` renders, with a class picker and the correct
   empty state. Console clean.
2. Still to check as **principal** and **branch admin**, and that a branch admin
   sees only their own campus's classes.

#### UC-S14-74a · Every exam screen is reachable from the sidebar — P2 🔁
**Was a gap found in the running app, not the diff.** Three of the four new admin
screens existed only as links on the Exams overview; the sidebar still offered
the Sprint 9 section. Fixed in `7a57c2f`.
- **Verified:** the sidebar now reads *Terms & Exams · Terms & Datesheets ·
  Promotions · Promotion Criteria · Report Cards · Grading Schemes · Exam
  Settings*, with **Promotions** shown only to a `results.promotion` holder.

#### UC-S14-75 · Only marked staff are offered as class teachers — P2 ⬜
Set **Class Teacher (Home Room)** on one staff record and not another. Only the
first is offered. `PATCH` naming the second → refused.

#### UC-S14-76 · A branch admin cannot name another campus's teacher — P1 🔁
**Was a defect (F7).** The `GET` scoped candidates by campus; the `PATCH`
validated against the whole school. A branch admin could hand
promotion-override authority over one of their classes to staff on a campus they
do not run — and the picker would never show who it was. School-level tenancy
held; the campus boundary did not. Fixed in `82f9262`.
1. As branch admin of campus 1, `PATCH` a section with a class teacher from
   campus 2 → refused.

---

## Legacy results

#### UC-S14-77 · The default hides history from teachers — P1 ⬜
Untouched settings, class teacher opens **Promotions**: no **History** link, no
history panel.
- **Fail** on a disabled control with a tooltip. Absent, not disabled — a control
  a teacher can see and not use is a control they ask the office about.

#### UC-S14-78 · Switching it on reveals every year — P2 ⬜
Every academic year, newest first, each rendering by its own frozen mechanism.

#### UC-S14-79 · Admins and principals are exempt — P2 ⬜
With the switch **off**, a school admin and a principal still get full history.

#### UC-S14-80 · A teacher cannot read another class's history through the URL — P1 ⬜
With the switch on, as class teacher of A, request
`/teacher/promotions?section={A}&student={aChildInB}`.
- **Expect** no history panel. The `student` parameter comes out of a request and
  is checked against the class the teacher actually owns. *(The same guard is in
  the new admin screen.)*

---

## Parent and student portals

#### UC-S14-81 · The promotion status reaches the family — P1 ⬜
**Promotion: Promoted** (or Not promoted) on the term's card.

#### UC-S14-82 · The reason for a change reaches the family too — P1 ⬜
Override with a reason, publish, check the parent portal, the student portal and
the printed card.
- **Fail** if it appears only in an audit log or only on the admin screen. The
  product owner asked for it to be visible to all relevant parties **including
  parents**.

#### UC-S14-83 · An unpublished term's status does not leak — P1 ⬜
Compute promotions, do **not** publish. Nothing on either portal — no card, no
history row, no status. **Fail** on a "Not promoted" badge: that is the software
telling a family something the school has not decided to say yet.

#### UC-S14-84 · The history is newest first and renders per frozen mechanism — P2 ⬜
A child in a descriptor class two years ago and a marks class now: current year
top, descriptors on the old rows, percentages on the new. **Fail** if every old
row is blank — that is the history re-resolving the mechanism instead of reading
the frozen one.

---

## Print

#### UC-S14-85 · The descriptor card is a real A4 page — P2 ⬜ **NEEDS PAPER**
One card per page, three columns ruled, chips coloured or plain per the switch,
one page break per child, no orphan row.

#### UC-S14-86 · A class of forty breaks across pages correctly — P2 ⬜ **NEEDS PAPER**
Forty self-contained pages, letterhead on each. **Fail** if a subject table
splits across a break.

#### UC-S14-87 · Preview is unmistakable — P3 ⬜
Print before publishing → **PREVIEW** banner on every card.

---

## Tenancy

#### UC-S14-88 · Another school's term is not readable — P1 ⬜ **NEEDS TENANCY**
School B's ids on `GET …/exam-terms/{id}/schedules`, `…/exam-schedules/{id}`,
`…/terms/{id}/sections/{id}/results` → **404** on all three. Not 403, not an
empty 200 that confirms the id exists.

#### UC-S14-89 · Another school's data is not writable — P1 ⬜ **NEEDS TENANCY**
`PATCH …/exam-schedules/{B}`, `POST …/generate`, `DELETE …/result-subcategories/{B}`,
`PATCH …/exam-terms/reorder` with B's ids, `PUT …/promotion-criteria` with B's
grade → 404 on all five, **zero** rows changed at B.

#### UC-S14-90 · A foreign id inside a body is refused, not accepted by the FK — P1 ⬜ **NEEDS TENANCY**
B's `failingSubcategoryId`, `gradingSchemeId`, `overallSubcategoryId` and
`classTeacherId` each → refused. The foreign keys are not tenant-scoped, so every
one of these must be re-read through a `location_id`-filtered query. A static
sweep found every write path doing so; a second tenant is the only proof.

#### UC-S14-91 · `location_id` never comes from the request — P1 ⬜
Include another school's `locationId` in every `POST` and `PATCH` body → ignored;
every row carries the session's tenant.

---

## Regressions this sprint could have caused

#### UC-S14-92 · Sprint 9's exams still work untouched — P1 ⬜
On exams created before `0029` (`schedule_id IS NULL`): open, enter marks,
publish, print. Exactly as before.

#### UC-S14-93 · The absent-paper denominator is unchanged — P1 ⬜
Re-run **UC-S09-04**. Sprint 14 added a second overall figure; it must not have
moved the first.

#### UC-S14-94 · Absent students still take no position — P1 ⬜
Re-run **UC-S09-13**.

#### UC-S14-95 · A descriptor class takes no positions at all — P2 🔁
Covered by the UC-S14-35 fix. Every child reads "Not ranked"; nobody is first.
**Fail** if everybody is joint first.

#### UC-S14-96 · A comment can be saved before a mark — P3 🔁
**Was a defect (F12), pre-existing but newly visible.** The save skipped any
present child with no mark, dropping a comment typed beside an empty marks box —
and Sprint 14 promotes the comment to a printed report-card column in both
mechanisms, so that was losing the only part of the row the teacher had filled
in. Fixed in `5572da0`.
1. In a marks class, type only a comment and save. It persists.

#### UC-S14-97 · Every new screen has the right loading state — P3 ✅ **AUTOMATED**
`npm run check-loaders` — **PASS, 251 assertions**, both directions. Do not click
this one.

#### UC-S14-98 · The green build — P1 ✅ **AUTOMATED**
All nine gates green after the fixes: `typecheck`, `lint`, `check-loaders`,
`check-forms`, `check-address-phone`, `check-cnic`, `check-sprint-periods`,
`check-accounting`, `build`. Delete
`D:\School-Management-System\.claude\worktrees\node_modules` before the build.

#### UC-S14-99 · The database rules hold against the real schema — P1 ✅ **AUTOMATED**
The 34-assertion integration suite: **34 of 34 pass** against the live schema
after `0029` and `0030`. It creates its own data under the marker `ZZQA14` and
removes all of it, including on failure. This is the case that found F13, which
no amount of reading would have — a CHECK constraint is read in two-valued logic
and evaluated in three.
