# Release notes — the O-Levels ladder, and the Askari demo estate

**Date:** 2026-09-08
**Branch:** `claude/askari-demo-data-setup-6c9e2e`
**Migration:** none — `0045` is still the next free migration number

---

## For the school

**O-Level schools no longer have a "Year 9".**

If your campus runs the Cambridge board, the class list now reads

> Pre-Nursery, Nursery, Prep, Year 1 … Year 8, **O1, O2, O3**

That is what it should always have said. Until today the ladder inserted a
*Year 9* that no Cambridge school teaches, and then ran the O-Level course for
two years instead of three — so there was nowhere to put the leaving year.

**Nothing you have entered has moved.** The ladder is the same length as
before, so every class keeps its pupils, its class teacher, its timetable, its
fee structure and its results. Only three names changed:

| Was | Is now |
| --- | --- |
| Year 9 | O1 |
| O Level 1 | O2 |
| O Level 2 | O3 |

If somebody at your school had already renamed those three classes by hand to
O1/O2/O3, that override has been cleared — because the class is now *called*
that, and an override saying the same thing is one more place for the two to
disagree later.

---

## For whoever maintains this

### The defect

`lib/predefined-grades.ts` ended its Cambridge ladder `… Year 8, Year 9,
O Level 1, O Level 2` — the Matric shape with Cambridge names pasted over the
last two rungs.

The branch form has disagreed with it since it was written. `lib/branch-classes.ts`
offers `O1, O2, O3` after Grade 8, and `scripts/check-forms.ts` already asserted
exactly that. So the two halves of the product described the same curriculum
differently: an operator declared a campus running `O1–O3`, and the grade ladder
then seeded that campus a `Year 9` nobody asked for and no `O3`.

**It had already been noticed.** Lahore Grammar's Defence Branch carried
`grades.display_name` overrides reading `O1`, `O2`, `O3` typed over exactly
those three rungs — a head of school correcting the product one grade at a
time, in a column nobody was reading as a defect report.

### The change

- **`lib/predefined-grades.ts`** — the ladder ends `Year 8, O1, O2, O3`. Still
  fourteen rungs, so this is a rename at positions 12–14 and not a reordering:
  `grades` is keyed `(branch_id, sort_order)` and every row keeps its id.
- **`scripts/check-forms.ts`** — twelve new assertions: the two modules name the
  senior years identically, no Cambridge ladder contains a `Year 9`, and every
  ladder is contiguous from 1 with no repeated rung. **74 assertions, in CI.**
  Nothing asserted the agreement before, which is why they were free to drift.
- **`scripts/apply-olevel-ladder-rename.mjs`** — the existing estate. Matched by
  sort order on O_LEVELS/A_LEVELS branches only, never by name, so a Matric
  `Class 9` at position 12 is untouched. Idempotent; prints the reverse
  statement for every row it writes.

### Applied

```
node scripts/apply-olevel-ladder-rename.mjs           # dry run
node scripts/apply-olevel-ladder-rename.mjs --apply
```

**Six grade rows at Lahore Grammar**, both campuses. Second run reports nothing
to do.

### Green build

`typecheck`, `lint` and all ten CI checks pass.

---

## Askari School System — demo estate rebuilt

Askari's tenant data was deleted and rebuilt for a promotional video. **LGS and
Beacon House were not touched.**

Removed: **1,556 rows across 53 tables** and the **10 Supabase auth accounts**
that existed only for this school. Kept: the `schools` row (slug, code `ASST`,
subdomain), branding, module switches, the academic-year ladder and the
Pakistani holiday calendar.

| | |
| --- | --- |
| Campuses | **Askari Junior Campus** — Pre-Nursery to Year 2, one principal over the whole campus. **Askari Main Campus** — the full ladder to O3, four principals by division (Early Years, Primary, Middle School, O Levels) |
| Grades / sections | 19 grades, 29 sections; some rungs one section, some two |
| Children | **473**, 20–30 per rung, each with father and mother guardian rows carrying canonical CNICs |
| Families | 65 have more than one child enrolled, so the sibling card and the family voucher have something to show |
| Accounts | **587** — 59 staff, 55 parents, 473 pupils |
| Money | 946 vouchers over two months, 744 payments, 15 approved expenses, ledger balanced to the paisa |
| Academics | 2 bell schedules, 1,025 timetable entries, 14 subjects, a Cambridge grading scheme, 3 terms, 116 papers, 1,892 marks |
| Registers | 7,568 student and 944 staff attendance records over 16 school days |

Every account uses one password. Staff and parents sign in on
`dispatchglobally1+[role][campus][n]@gmail.com`; pupils on a minted
`asst-2026-NNNN@students.askari-school-system.invalid`, which cannot receive
mail. **No email was sent** — passwords were set directly through the Supabase
admin API with `email_confirm`, and the credential list was delivered as a
shared Drive folder instead.

Verified by a real password grant against GoTrue plus the `school_users` lookup
the app performs on every request, for one account of each of eight roles.
