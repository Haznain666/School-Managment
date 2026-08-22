# Sprint 14 — exam terms, datesheets, descriptors and promotion

**Built 2026-08-22 to `SPRINT-14-SPEC.md`.** Migrations
`0029_sprint14_exam_terms_promotion.sql` and `0030_schedule_marks_pairing.sql`
are **both APPLIED to the live database.**

> ✅ **Live.** The bookkeeping table went 29 → 30 → 31. Verified against the real
> schema rather than trusting the success message: seven tables, eleven columns,
> the relaxed `exam_results` CHECK, `results.promotion` in the permission
> constraint, all four partial indexes, and the four default result
> sub-categories seeded for every existing school.
>
> **`0029` had to go in before the merge, not after.** `app/(teacher)/layout.tsx`
> awaits `listClassTeacherSections`, which reads `sections.class_teacher_id`. A
> layout runs on every page of the teacher portal and that call is unguarded, so
> deploying this against the old schema would have 500'd the whole portal — the
> §5aw incident again, one module over. The migration is expand-only, so
> applying it while the *old* build was still live cost nothing.

---

## The problem, stated exactly

Sprint 9 shipped a complete exam module, and it held only while every class in a
school sat the same papers on the same days.

Schools do not work that way. An infant class finishes its First Term in three
mornings; the senior school takes a fortnight. Both are "First Term", the school
pins **two** datesheets to the noticeboard, and the product had nowhere to put
the second one — a term was one window with exams hung off it, so a coordinator
either invented two terms or entered the same eight papers eleven times, once
per section, and got one of them wrong.

Two other things had no home at all:

* **A primary school does not give marks.** It does not tell a parent their
  five-year-old scored 68% in Art; it says where the child is against what was
  expected — *Exceeding*, *Emerging*, *Needs Improvement*. The product had one
  way of recording a result and it was a number.
* **Nothing recorded whether a child passed.** `promotion_runs` records which
  section a child sits in next September, which is enrolment plumbing. Whether
  the school judged them to have passed the year was not written down anywhere,
  so no report card could print it and no parent could be told.

---

## What changed

### A term holds datesheets, and the dates live on them

`exam_schedules` is the datesheet: a name, a window, the classes that sit it
(`exam_schedule_grades`) and the papers on it (`exam_schedule_subjects`) with
subject, day, start time, length and what each is out of.

`exam_terms.start_date` / `end_date` became **optional**. A school may still
type a term-level window for its calendar; where it does not, every screen shows
the earliest start and latest end across the term's schedules. Terms are listed
in `sequence_order` — the school's own reading order — because a list ordered by
a date half the rows do not have is a list that rearranges itself.

**A class sits one datesheet per term**, enforced by a partial unique index and
checked in the route so the answer is *"Class 4 already sits the Junior
schedule"* rather than a constraint violation.

### Generate: one datesheet, every section's papers

**Generate exams** writes an exam and its papers for every active section of
every class on the datesheet. Move the Maths paper and press it again — it
updates what it made, creates what is missing, and touches nothing else.

It never deletes a paper carrying marks. A subject dropped from the datesheet
has its paper archived, and the response says how many of those carried marks,
because the person who dropped it is the only one who can decide whether that
was intended.

### Two mechanisms, chosen per class per year

`grade_promotion_criteria` says how each class is judged:

| | Teacher enters | The sheet shows | Promotion decided by |
| --- | --- | --- | --- |
| **Marks and grades** | marks and a comment | Subject / Marks / % / Grade / Comment | percentages |
| **Performance descriptors** | a sub-category and a comment | Subject / Sub-category / Comment | descriptor counts |

They are **alternatives**. A descriptor class has no marks, no percentages and
no letter grades anywhere — not on the marks sheet, not on screen, not on the
printed card — and a marks class has no sub-category column at all.

**A class with no criteria row behaves exactly as the product did before this
sprint**: marks and grades, the school's default scheme, no thresholds. A school
that never opens the criteria screen sees no change. A blank threshold is *not
applied* rather than treated as zero, so a half-filled screen cannot start
holding children back on its own.

### The words a school uses instead of a mark

`result_subcategories` is the school's own list — the four seeded ones
(*Exceeding*, *Satisfactory*, *Emerging*, *Needs Improvement*) are a starting
point, renameable, recolourable and reorderable. Every school words this
differently and the wording is the product.

**Colour coding is one switch, and it is retroactive.** Whether a descriptor is
painted is read at render time and never copied onto a result row, so a school
that decides its report cards look like a traffic light gets the whole archive
back in one click. `components/exams/SubcategoryBadge.tsx` is the single
implementation; colour off renders the plain label with no chip.

A descriptor that has been awarded **cannot be deleted**. The refusal names the
count — "used on 412 subject results and 38 term results" — and offers Archive,
which hides it from every picker and leaves every card the school has issued
rendering exactly as it was.

### Promotion, and the reason it was changed

`student_term_results` records, per child per term: the mechanism (frozen), the
overall row, what the rules computed, what the school decided, and — where those
differ — the reason, who set it and when.

**The reason is compulsory at ten characters or more, and it is shown to the
parent.** It prints on the report card and appears on the parent and student
portals. Setting the status back to what the rules said clears the reason
completely; half an override left behind is a comment on a parent's portal about
a decision that was reversed.

Recomputing a class **keeps an existing override** while it is still a departure
from the rules. A head who decided something in March is not reversed by a clerk
pressing a button in April.

### Who decides

A holder of the new `results.promotion` permission — school admin, branch admin,
principal — **or the class's own class teacher**, checked per section.

`results.promotion` is deliberately **not** granted to teachers. A role key would
hand every teacher in the school every class in it. A class teacher's authority
comes from being named on `sections.class_teacher_id`, which the office sets on
the class, offering only staff whose record says *Class Teacher (Home Room)*.

A teacher who is the class teacher of nothing does not see Promotions in their
navigation, and is refused by the page if they type the URL.

---

## New screens

**School admin / branch admin / principal**

* **Exams → Terms & datesheets** — terms in the school's own order, with reorder,
  rename, archive and a 50-character name counter. Open one for its datesheets.
* **Exams → Promotion criteria** — one row per class for the chosen year, showing
  only the fields the chosen mechanism actually reads.
* **Exams → Exam settings** — sub-categories with a colour picker that previews
  through the same component the report card prints, plus **Enable colour
  coding** and **Allow teachers to view student legacy results**.
* **Exams → Promotions** — any class in the school, over the same sheet the class
  teacher uses. Gated on `results.promotion`, scoped to a branch admin's own
  campus, and exempt from the teacher legacy switch. Added during QA: without it,
  a promotion status could only ever be created by a named class teacher, so a
  school that had named none could not produce one at all.

All seven exam screens are reachable from the sidebar, not only from the Exams
overview.

**Teacher**

* **My exams** — the datesheet rows for the subjects they teach, and no others.
* **Promotions** *(class teachers only)* — each child's computed status with the
  reasons behind it, the override with its compulsory reason, and in descriptor
  mode the overall sub-category.
* **Marks** now shows the descriptor sheet for a descriptor class, and a comment
  per student in both modes.

**Parent and student**

Each term's report card renders by its own mechanism, and both portals gained a
**Result history** — every published term, newest first, with the promotion
status and the reason where the school changed it.

---

## Defaults worth knowing

| | |
| --- | --- |
| A class with no criteria row | Marks and grades, no thresholds — promotes everybody |
| A school with no exam settings row | Colour coding **on**, teacher legacy access **off** |
| Deleting a term, a datesheet or a sub-category | Archives. Nothing here issues a real delete |
| A descriptor class's `max_marks` | Stored as `1` and never read |

---

## Not in this sprint, by decision

* Merging `promotion_runs` with `student_term_results`. Two different facts,
  decided by different people at different times.
* Re-sit handling for descriptor mode. A descriptor is not re-sat.
* Any change to how `resolveBand` treats a score under every band. `resolveGrade`
  wraps it and returns `U`; the old function and its callers are untouched.

---

## What QA found, and what it cost to find it

Fifteen defects, all fixed. Seven were P1. They are worth recording
because of *how* each was caught — the three methods found different classes of
fault and none of them would have found the others.

### Found by reading the code against the spec

1. **Dropping a class from a datesheet orphaned its papers.** The generate loop
   walks the schedule's *current* grades, so a dropped class kept its live
   papers — and was then free of the one-class-one-datesheet index, so it could
   join a second datesheet and generate a **second full set of papers against
   the same children**. Report cards select by term and section with no schedule
   filter: every subject twice, marks available doubled, **every child's
   percentage halved**, with nothing on any screen saying why.
2. **"Delete" did not delete.** `archived_at` was written by three paths and
   read by four readers out of twelve. An archived term's exams stayed live *and
   writable* — a teacher could still save marks against a term the school had
   deleted, because the results route authorises through `teacherOwnsPaper` and
   loads through `getExamPaper`, and neither looked.
3. **Descriptor classes got a marks tabulation.** `generate` writes
   `max_marks = 1` on a descriptor paper because the column is NOT NULL, and the
   grid read it: 0% for every child, and `assignPositions` turned that into **a
   class of joint firsts** — a sheet a principal would have acted on.
4. **Nobody holding `results.promotion` had a screen.** The only promotions UI
   was behind `requireSchoolRole(['teacher'])`, so a term result could only come
   into existence when a *named class teacher* pressed Recompute. A school that
   had named no class teachers got no promotion status on any report card and no
   way to produce one — the sprint's headline feature, unreachable for the three
   roles the permission was created for.
5. **Two different overall percentages, three inches apart.** The card printed
   total-over-total; the history table printed the arithmetic mean the spec makes
   authoritative. Both render on the parent's results page. Mathematics 40/100
   with Art 18/20 showed **48.3% · C** on the document a family keeps and
   **65.0% · B** below it — and the promotion decision had been taken on the
   second. Fixed by making the mean authoritative everywhere, including the band,
   the GPA and the remark. The marks column still totals honestly; it simply is
   no longer what the percentage is computed from.

Plus: the override form and the override route disagreed about when a reason was
compulsory (the form hid the box, enabled Save, and the server returned 422); a
branch admin could name a class teacher from a campus they do not run; a paper
had no upper date bound when its schedule had no end date; a recompute left half
an override behind; the deletion guard ignored classes that name a descriptor as
their *failing* one; the report card counted "subjects needing attention" against
the current criteria rather than the frozen ones; and a comment typed before a
mark was silently dropped.

### Found by running the rules against the real schema

One defect, and no amount of reading would have caught it.

`exam_schedule_subjects_marks_check` was written as:

```sql
(max_marks IS NULL AND passing_marks IS NULL)
OR (max_marks > 0 AND passing_marks >= 0 AND passing_marks <= max_marks)
```

which reads as "both or neither" and is not. With `max_marks = 100` and
`passing_marks = NULL`, branch one is FALSE, branch two is `TRUE AND NULL AND
NULL` = **NULL**, and `FALSE OR NULL` is NULL — and **Postgres passes a CHECK
unless it evaluates to FALSE.** The constraint permitted precisely the state it
existed to forbid, silently, and the row looks ordinary in the table afterwards.

The failure surfaced much later and somewhere else: `exam_subjects.passing_marks`
is NOT NULL, so `generate` died on a not-null violation naming neither the paper
nor the reason, at the moment an administrator was creating a whole term's exams.

A 34-assertion integration suite against the live schema found it on the first
run — the assertion "a half-configured row is refused" came back **WAS ALLOWED**.
Review would never have caught it, because a CHECK is *read* in two-valued logic
and *evaluated* in three. `0030` rewrites it with `num_nonnulls`, which cannot
return null, and the parser now demands the pair regardless of whether the
schedule has grades assigned yet — which was the route in, since the mechanism
is derived from the assigned grades and a schedule with none has no mechanism.

### Found by rendering a real report card

Two defects, and they existed **only** where papers carry unequal maxima —
Mathematics out of 100 beside Art out of 20. With every paper out of the same
maximum the mean and the ratio agree, so neither the static read nor the
34-assertion suite could reach them. Seeding that one condition and reading the
card it produced surfaced both in a minute.

* **A subject scoring under every band printed an em dash instead of `U`.** The
  overall row already used `resolveGrade`; the subject rows still used
  `resolveBand`. One card read `Mathematics 30% —` on one line and
  `Total 62.5% B` on the next — a blank beside a real number, on the lowest mark
  on the sheet.
* **Position in class ranked on total marks while the card printed the mean.**
  The child with the best overall percentage in the class printed
  **"Total 65% B"** and **"Position in class: 2nd of 3"** on the same sheet,
  because another child had more raw marks from the 100-mark paper. Ranking now
  uses the figure the card displays.

### Found by looking at the running app

The **sidebar** still offered the Sprint 9 exam section. Three of the four new
admin screens — datesheets, promotion criteria and exam settings — existed only
as links on the Exams overview, so nothing in the primary navigation mentioned
that a school could now configure any of this. Invisible in the diff, obvious in
the browser.

### The lesson worth keeping

The green build passed at every point, including while all thirteen were
present. Nine gates, 251 loader assertions, a clean typecheck and a clean lint
say the code compiles and obeys the house rules. They say nothing about whether
a report card prints the number the decision was made on.
