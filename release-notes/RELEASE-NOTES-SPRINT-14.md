# Sprint 14 — exam terms, datesheets, descriptors and promotion

**Built 2026-08-22 to `SPRINT-14-SPEC.md`.** Migration
`0029_sprint14_exam_terms_promotion.sql` is **written and not applied.**

> ⚠️ **Not live.** Nothing in this sprint works against the live database until
> `0029` is applied. That is `sprint-devops`' step, and the four seeded result
> sub-categories for existing schools arrive with it.

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
