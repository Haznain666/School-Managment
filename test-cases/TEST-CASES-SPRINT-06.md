# Test cases — Sprint 6: Academics, timetable & attendance

Traces to [`RELEASE-NOTES-SPRINT-06.md`](../release-notes/RELEASE-NOTES-SPRINT-06.md).
Migration `0008_sprint6_academics_timetable.sql`.

**This sprint owns one definition that six other places must agree with:**

> **Attendance rate = (present + late) ÷ (present + absent + late + excused)**
> `holiday` is excluded from **both** sides.

Cases 05–08 test it in every place it is displayed. Run them together — the
defect worth catching is not "the formula is wrong" but "two screens computed it
differently", and only comparing them finds that.

---

## Subjects and the timetable

#### UC-S06-01 · Subjects carry a code and a colour, per school — P2 · **NEEDS TENANCY**
**Role** School administrator · **Traces to** "`subjects`, with a code and a colour, per school"
1. Create subjects at two schools with the same code.
- **Expect** both accepted; neither appears in the other's lists.

#### UC-S06-02 · Subject colour stays legible where it is used — P2
**Role** School administrator · **Traces to** Sprint 10.5: "two real bugs surfaced… including a timetable cell printing white text on a pale yellow subject colour"
1. Give a subject a very pale colour, and another a very dark one. Open the timetable and print it.
- **Expect** the text is readable in both, on screen and on paper.
- **Fail** on white-on-pale or dark-on-dark. This is a real defect that shipped once.

#### UC-S06-03 · Periods are defined once, then filled in — P2
**Role** School administrator · **Traces to** "Periods defined once, then a grid of which subject, which teacher, which section, in which period"
1. Define the period structure, then build a section's week.
- **Expect** the grid uses the defined periods; changing a period definition does not silently orphan entries.

#### UC-S06-04 · A teacher is not double-booked beyond what the builder allows — P3
**Role** School administrator · **Traces to** "or a timetable clash detector beyond what the builder enforces" (listed as *not* in the release)
1. Try to place one teacher in two sections in the same period.
- **Expect** whatever the builder enforces, consistently. **Do not raise a full clash detector as a defect** — the note says it is not in this release.

---

## The register, and the definition

#### UC-S06-05 · The five states are recorded, with who marked them — P1
**Role** Teacher · **Traces to** "present, absent, late, excused or holiday, with a record of who marked it — because a disputed absence has to be answerable"
1. Mark one of each. Read the record back.
- **Expect** all five states, each carrying the marker's identity and time.
- **Fail** if the marker is not recorded — a disputed absence then has no answer.

#### UC-S06-06 · Late counts as present — P1
**Role** Teacher, then parent · **Traces to** "(present + late) ÷ …"
1. Mark a child late for 5 of 20 days, present the rest.
- **Expect** 100%. "A child who arrived late was in the class."
- **Fail** if late reduces the rate.

#### UC-S06-07 · Holiday is excluded from **both** sides — P1
**Role** Teacher, then parent · **Traces to** "It is not a day anybody failed to attend, and counting it as absence would drop every school's rate each time a term break was marked"
1. Note a class's rate. Mark a week as holiday. Re-read it.
- **Expect** unchanged.
- **Fail** if the rate moves at all — up **or** down. Counting holidays as present is as wrong as counting them absent, and "making the worst-looking months the ones where nothing happened" is the symptom to watch for on the trend chart.

#### UC-S06-08 · Every surface computes the rate identically — P1 · **NEEDS SEED**
**Role** All · **Traces to** "Every later screen and chart uses this same definition"
1. For one child over one term, read the rate from: the register, attendance reports, the parent portal, the parent's attendance ring, the report card's term summary, the dashboard trend, and Sprint 12's attendance summary report.
- **Expect** the same number everywhere.
- **Fail** on any disagreement. This is the single highest-value case in this file.

#### UC-S06-09 · Excused is in the denominator but not the numerator — P1
**Role** Teacher · **Traces to** the formula as written
1. Mark a child excused for 4 of 20 days, present for 16.
- **Expect** 80%.
- **Fail** at 100% (excused treated as attendance) or if excused is dropped entirely (which would give 100% as well — distinguish these by checking the denominator, not just the percentage).

---

## Portals

#### UC-S06-10 · A teacher sees their own timetable and their own registers — P1
**Role** Teacher · **Traces to** "Teachers get their own timetable and the register for their classes"
1. Sign in as a teacher and open both.
- **Expect** only their classes.
- **Fail** if another teacher's register is reachable, by link or by URL.

#### UC-S06-11 · A student sees their timetable — P2
**Role** Student · **Traces to** "Students get their timetable"

#### UC-S06-12 · A parent sees their child's attendance, and only their child's — P1
**Role** Parent · **Traces to** "Parents get their child's attendance"
1. As a parent of one child at a school with many, open attendance.
- **Expect** their own child only. Try another child's ID in the URL.
- **Fail** if any other child is reachable — parent portals "answer by identity", so there is no permission gate to fall back on.

#### UC-S06-13 · Taking the register on a phone is usable — P2
**Role** Teacher, 375px · **Traces to** Sprint 13: "the P/A/L/E buttons are full-size touch targets on a handset, and the Save bar follows you down a class of forty"
1. Mark a class of forty at 375px.
- **Expect** buttons are comfortably tappable and Save stays reachable without scrolling to the bottom.

---

## Not in this release

- **Subject-wise (per-lecture) attendance.** This register is per day. Sprint 12
  *derives* a subject-wise report from it and says so on its own face — test it
  there, and read UC-S12-04 before reporting it as inaccurate.
- **Substitutions.**
