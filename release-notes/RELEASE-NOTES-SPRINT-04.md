# Release notes — Sprint 4: Admissions & student records

**Status:** shipped. Migration `0006_sprint4_admissions.sql`, applied.

> Reconstructed after the fact. See
> [how these were written](README.md#how-these-were-written).

The sprint that gave the product children to keep records about. Everything in
fees, attendance, exams and communications reaches a student through the tables
introduced here.

---

## What a school gets

**Academic years** (`academic_years`). The year everything else is filed
against, with one marked active. Fees are priced per year, enrolments belong to
a year, and exam terms sit inside one.

**Classes and sections** (`grades`, `sections`). A class with its sections, in
the school's own naming, scoped to a campus.

**Student records** (`student_profiles`). The child's own record — their
school-assigned student ID, date of birth, gender, blood group, photo and
identity document. `school_id_sequences` issues student IDs per school so two
schools cannot mint the same one.

**Enrolment** (`student_enrollments`). Which section a student is in, for which
year, with a status and a roll number. **A new year is a new enrolment row, not
an edit** — which is what lets the system still answer what class a child was in
two years ago.

**Guardians** (`student_guardians`). Parents and guardians linked to a child,
with a relationship, and optionally their own account so they can sign in to the
parent portal. Sprint 10 later used this same link to bill a family once for
three children.

**Admission applications** (`admission_applications`). An enquiry through to a
decision, with a status the applications screen walks in order.

**Screens.** Academic years, classes, students (list and detail), enrolment, and
applications (list and detail).

---

## Things worth knowing

- **A student's history is never overwritten.** Promotion, transfer and
  re-enrolment all add rows. The cost is that "which section is this child in"
  is always a question about a year, and every later query asks it that way.
- **The parent account is optional.** A guardian can exist on a child's record
  with no account at all — the office can still phone them. Later sprints treat
  that state as real rather than as missing data: Sprint 11's delivery log
  reports such a parent as unreachable rather than as a failure.

---

## Not in this release

- Bulk import. A school's first 800 students still had to be entered by hand
  until Sprint 10.
- Promotion to the next year, and transfer between campuses — Sprint 10.
