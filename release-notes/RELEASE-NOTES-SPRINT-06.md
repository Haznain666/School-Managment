# Release notes — Sprint 6: Academics, timetable & attendance

**Status:** shipped. Migration `0008_sprint6_academics_timetable.sql`, applied.

> Reconstructed after the fact. See
> [how these were written](README.md#how-these-were-written).

The school's teaching week, and the daily register. This is also the sprint that
gave teachers, students and parents something of their own to open.

---

## What a school gets

**Subjects** (`subjects`), with a code and a colour, per school.

**The timetable** (`timetable_slots`, `timetable_entries`). Periods defined once,
then a grid of which subject, which teacher, which section, in which period.

**The register** (`attendance_records`). Marked per student per day as present,
absent, late, excused or holiday, with a record of who marked it — because a
disputed absence has to be answerable.

**Screens.** Subjects (list, new, edit), the timetable builder, the register,
and attendance reports.

**Portals.** Teachers get their own timetable and the register for their
classes. Students get their timetable. Parents get their child's attendance.

---

## The definition that everything since has had to agree with

**Attendance rate = (present + late) ÷ (present + absent + late + excused).**

`holiday` is excluded from *both* sides. It is not a day anybody failed to
attend, and counting it as absence would drop every school's rate each time a
term break was marked — making the worst-looking months the ones where nothing
happened. Every later screen and chart uses this same definition; the parent
portal's own wording is where it was first written down.

The same principle recurs in Sprint 9 for absent students in exam results and in
Sprint 11 for guardians with no email address: a state that means "not
applicable" must never be counted as a bad outcome.

---

## What later sprints added here

- **Charts** on the attendance reports screen and the parent portal — rate by
  class, and a child's own attendance ring (Sprint 10.5).
- Attendance appears on the **report card** as a term summary (Sprint 9).

---

## Not in this release

- **Subject-wise (per-lecture) attendance.** This register is per day. Secondary
  schools want it per lecture, and that is a later sprint.
- Substitutions, or a timetable clash detector beyond what the builder enforces.
