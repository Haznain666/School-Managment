# Sprint 23 — the principal's grades, the class teacher, and the discount that would not come off

**A principal at a school running several heads could see the whole school.**
Their students list was narrowed. Nothing else was: the voucher register, the
timetable, the exams, the attendance registers, the reports and every grade
dropdown in the product showed a head of the O-Levels the Montessori section as
well. This release narrows all four groups.

Three other things this release fixes, all of them reported from a school desk:

- **removing a discount left the voucher alone.** The discount came off the
  child's record and stayed on the bill;
- **the class-teacher dropdown was empty** at any school whose teachers were
  invited through Users & Staff;
- **the date fields lost their month** on a 15.6" laptop, reading `dd------yyyy`.

**There is a database migration — `0039`.** It adds two columns and changes no
existing row. See `SPRINT-23-DDL-NOTES.md`; it must be applied **before** this
build goes live.

---

## Removing a discount now reprices the bills that have not been paid

Take a sibling discount off a child and every voucher of theirs **with no
payment against it** is repriced on the spot: the total goes back up by the
discount and the discount line disappears. The panel tells you what moved.

It also tells you what did not, and that half is the point:

> *"Sibling Discount" removed. 2 unpaid vouchers repriced. 1 voucher was left
> unchanged because a payment has been recorded against it: LGS-V-000412.*

**A voucher with any money against it is left exactly as it is.** Part paid or
paid in full, it does not move. That money is in the school's drawer and the
parent is holding a receipt for a figure this would otherwise change underneath
them — so the voucher stays, and you are told, by number, which one it was. A
discount removed from the wrong child cannot look like it worked.

Family vouchers are unchanged and are reported the same way: they are priced as
a whole and are what the parent is holding.

**Nothing else about discounts has changed.** Granting one still reprices unpaid
*and* part-paid vouchers exactly as it did. A discount that simply *expires* —
its end date passes on its own — still leaves issued vouchers alone, because
those bills were raised for a period the child genuinely held the grant in.
Removal is a correction, and only removal behaves differently.

---

## One class, one principal — unless you say otherwise

**Settings → Principals** has a new switch: **"Allow a class to have more than
one principal"**. It is **off**.

With it off, assigning a class that another head already holds is refused, and
the message names them:

> *Class 3 is already assigned to Ayesha Khan. Turn on "Allow a class to have
> more than one principal" in Settings, or remove it from their assignment
> first.*

The picker greys those classes out and labels them with the head who holds them,
so you see it before you save rather than after.

Three things that are deliberately *not* clashes:

- **an assignment that has ended.** A former head of Class 1 does not block
  their successor — otherwise a handover would be impossible;
- **the same person.** Editing Ayesha's own assignment to keep Class 3 is fine;
- **an assignment with no classes named.** That is the "runs everything" row, and
  it does not claim every class.

**Overlaps you already have are kept.** The migration unassigns nobody. Where
two heads share a class the assignment card shows a chip — *"Also assigned to
Ayesha Khan"* — so you can resolve it deliberately or turn the switch on.

Classes are already per campus, so two campuses' "Class 3" are two different
classes and never clash with each other.

---

## A principal sees their own classes, everywhere

Signed in as a principal at a school running **separate principals**, every one
of these now shows only the classes on their assignment:

| | |
| --- | --- |
| **Students, staff, fees** | the students list and every student profile; the staff directory and the invite form's campus picker; the voucher register, voucher generation, the outstanding and aged-debt reports and the chase list |
| **Timetable, sections** | the grade and section pickers on the timetable builder, and the class-teacher control beside them |
| **Exams, results** | the exams overview and its outcome chart, the term datesheets, report cards and the promotions sheet |
| **Attendance, reports, dashboards** | marking a register and the attendance reports; the class dropdown and the figures on the attendance, subject-attendance, fee-collection, outstanding-aging and academic-results reports — on screen, on the printed sheet and in the CSV alike |

Each of those screens now carries the sentence saying what you are looking at —
*"You are seeing O-Levels."* — because a narrowed list and a broken list look
identical, and a head with **no** assignment yet is told who to ask instead of
being shown an empty school.

### What this is, stated plainly

**This is a visibility filter, not an authorization boundary.** A principal's
screens show only their classes and every dropdown offers only their classes.
**A crafted API request outside their scope still succeeds.** That is a
deliberate product decision, not an oversight, and it is written here so that
nobody later reads it as a bug and "fixes" it.

**Nothing changes for a school running one principal**, which is every school
until it says otherwise, and nothing changes for any other role. A school
administrator sees the whole school exactly as before.

---

## Any active member of staff can be a class teacher

The class-teacher dropdown offered only people whose HR record had **"Class
Teacher (Home Room)"** ticked. Sprint 22 made it ordinary to create a teacher
from the invite screen, which does not set that tick — so at a school whose
teachers all arrived that way the dropdown was **empty**, and the feature looked
removed rather than unpopulated.

It now offers **every active member of staff**. The HR tick is still there and is
still a useful label on a personnel record; it is simply no longer a gate.

**The control is now on the timetable screen too.** Choose a year, a class and a
section on **Academics → Timetable** and the class teacher is set right there,
above the week you are building. The old control on **Academics → Classes** is
unchanged and both write the same thing — two doors to one room.

- **One class teacher per section**, always. Choosing a second replaces the
  first; a section can never have two.
- **One teacher may hold several sections.** That is allowed, and the dropdown
  says so beside their name — *"also class teacher of 4-B"* — so it is a choice
  rather than something discovered in February.

---

## Staff photographs

**HR → Staff** shows a photograph beside every name, and one staff member's
profile has **Add photo**. PNG, JPG or WebP, up to 2 MB, uploaded through the
server — exactly as student photographs already work.

Somebody with no photograph keeps the initials they have now. There is no grey
silhouette: initials are the person's own and a silhouette is nobody's.

A staff photograph is **not** the account's sign-in avatar. Different fact,
different field, and an HR clerk filing a personnel photograph does not change
anybody's login.

---

## Three smaller things

**Designation follows the role.** On the invite form, choosing **Teacher** fills
Designation with "Teacher". Change the role and it follows — unless you have
typed something of your own, which is never overwritten. It is a starting point,
not a rule: the field is still free text, and "Senior Physics Teacher" is what a
contract says.

**Date fields keep their month.** On a 15.6" laptop a date box read
`dd------yyyy` — the month segment was missing, because the box was narrower
than the three segments the browser wanted to draw and it clipped the middle one
rather than shrinking. All 43 date fields in the product now have a minimum
width, fixed once in the shared layer rather than screen by screen.

**A joining date can be at most a year ahead.** Typing 2036 for 2026 put a
member of staff at the bottom of every list and on no payroll run, and nothing
said so. Both the invite form and the HR forms now refuse it, and both say the
same thing. **A past date is still unlimited** — schools file people who joined
in 1998, and this is about a typo in the year, not about backdating.

---

## What is not in this release

- **The narrowing does not reach announcements** (Communications). A head still
  sees the whole school's notice board and can address any class. Announcements
  were outside the four groups this sprint covered.
- **A student's transfer screen still offers every class in the school**, on
  purpose: a transfer's whole point is to cross campuses, and `students.transfer`
  is a school-administrator permission by default.
- **The staff directory narrows by campus, not by class.** A staff record carries
  a campus and no class — there is no column saying which classes a bursar
  belongs to — so a head assigned a *division* but no campus still sees every
  member of staff. That is what they saw before, and narrowing it further needs
  a column the schema does not have.
