# Test cases — Sprint 19b: the campus calendar, the paperwork, and Enroll

Traces to [`SPRINT-19-SPEC.md`](../SPRINT-19-SPEC.md) items 14–19, and to
STATE.md §5bi. Items 1–13 are phase 19a — see
[`TEST-CASES-SPRINT-19A.md`](TEST-CASES-SPRINT-19A.md).

Migration `0036` — **APPLIED and verified** before this run. 36 bookkeeping rows
→ **37**. Two new tables and three new nullable columns asserted against
`information_schema` / `pg_constraint`, then every constraint made to **fire**
inside a transaction that was rolled back, each expected refusal in its own
`SAVEPOINT`: **21 of 21 passed, nothing left behind.**

Driven at `697a0f8d724b` against the **real live database**, standalone artifact
on port 3100, SMTP blanked. Two tenants: **Lahore Grammar School** (two
campuses, 12 students, 2 academic years) and **Beacon House** (one campus).

## Status — 2026-08-29

**No defects. Two minor findings, both recorded below and neither fixed.**

| Mark | Meaning |
| --- | --- |
| ✅ | executed and passing |
| ⚠️ | executed, passing, with a caveat |
| ⬜ | not executed, and why |

**Everything written to LGS during this run was removed.** One promotion draft
(discarded), one uploaded document (deleted, list re-read empty). The academic
year run was exercised through its **preview only** — submitting it would have
created real sessions.

---

## ✅ Item 14 — academic years belong to campuses, and are created in runs

**The listing** (`/dashboard/admissions/academic-years`) carries a **CAMPUS**
column. Both of LGS's years read *All campuses*, which is correct and is the
point of the design: `academic_year_branches` is empty at every school, and an
empty join means school-wide. Nothing was backfilled and nothing moved.

The page description now reads *"Every **enrollment**, section and student ID
belongs to a year"* — item 19, visible in place.

**The run form** (`/academic-years/new`) asks exactly what was specified:

| Control | Observed |
| --- | --- |
| Start month | 12 months |
| End month | 12 months, hint *"The year this ends in is worked out for you."* |
| First year starts | number |
| How many years | number, hint *"Up to 10 at a time. Ones that already exist are skipped, not refused."* |
| Campuses | multi-select — *Select all · Defence Branch · Karachi Branch*, with *"Leave every box clear for a session the whole school runs"* |
| Active | *"Make the first of these the active academic year"* |

**The preview computes correctly.** August → July, first year 2026, three years:

```
This will create 3 years
2026-2027 · August 2026 to July 2027
2027-2028 · August 2027 to July 2028
2028-2029 · August 2028 to July 2029
```

The crossover is right — an August start ends in the *following* calendar year,
and the names derive from the pair rather than being typed.

### ⚠️ Finding 1 — the preview overstates what a run will create

LGS already has **2026-2027** and **2027-2028**. The preview still says *"This
will create 3 years"* and lists all three. The run itself is correct — it skips
what exists and reports *"1 created, 2 already existed"* — but the screen
promises three and then delivers one.

It is cosmetic and it is not a lie the *server* tells; the form is a client
component and has never been given the list of years that exist. The page one
click away renders exactly that list, so the fix is to pass it in and mark the
duplicates *"already exists"* in the preview.

Recorded rather than fixed: it is a genuine mismatch between what a screen
promises and what it does, which is the class of thing this repository takes
seriously, but it misleads by **over**-counting and the outcome message corrects
it immediately.

### ⬜ The run was not submitted

Submitting creates real academic sessions at a real school, and a session is
what every enrolment, student ID and fee record is filed under. The planner is
pure and dependency-free precisely so the form previews what the route writes,
and the preview is what was exercised.

### ⬜ "Current by calendar" was not observed

LGS has an explicitly active year, so the calendar fallback never engages —
which is itself the correct behaviour ("a year somebody marked is never
overridden"). The fallback path would need a school with no active year; Beacon
House has no academic years at all, so it cannot show it either.

---

## ✅ Item 15 — Promote students

**15a — the campus selector is present**: *All campuses · Defence Branch ·
Karachi Branch*, and the class, year and destination lists are all narrowed
behind it.

**15b — the reported defect is fixed, and this was the one worth driving.**

Selecting *Nursery*, from **2026-2027** into **2027-2028** — a year with no
sections — the screen now says:

> **2027-2028 has no sections yet. Create them before promoting.**
> Nothing is wrong with this screen — the school has not built next year's
> classes. Copy this year's across, or build them by hand.
> **[ Copy this year's sections into 2027-2028 ]  [ Grades & sections ]**

and the *Goes to* cell reads **"No class to move into"** rather than an empty
`Choose…`.

This is the whole defect. The filter was always correct; the screen was silent,
and a silent correct answer read as a broken control. It now names the year, says
plainly that nothing is wrong, and offers the button that does the job the
operator actually came to do.

The draft run created by this test was **discarded**; the screen returned to the
picker and LGS holds no promotion run.

### ⬜ The cross-campus 422 was not exercised

Both of LGS's campuses would need sections in the receiving year to build a
cross-campus destination, and Karachi Branch has no classes at all. The
destination filter is verified by inspection; the server refusal is not.

### ⬜ "Copy this year's sections" was not pressed

It writes real sections into a real academic year.

---

## ✅ Item 16 — student documents, verified end to end

**The card renders** on the student profile: *"Student documents — Scans the
school keeps on file. Each one opens in a new tab."*, an **Add document**
control, and an empty state that tells a school what belongs there (*"A B-Form,
a birth certificate or a leaving certificate"*).

**The upload path was exercised against real Supabase Storage**, which nothing
before this run had done:

| Case | Result |
| --- | --- |
| A real 1×1 PNG | **201 Created** — stored, row written, `downloadUrl` returned |
| An `MZ` executable renamed `payload.png`, declared `image/png` | **415** — *"That file is not a PNG or JPG image. Photograph or scan the document and upload the picture."* |

So the magic-byte check works **in the real route**, not only in isolation. It
was also exercised directly against ten inputs — PNG, JPEG JFIF (`E0`), JPEG
EXIF (`E1`, which is what every phone camera emits), JPEG Adobe (`EE`), a
Windows `MZ` header, a PDF, a GIF, a PNG with a corrupted CRLF, a three-byte
truncation and an empty buffer — **10 of 10 correct**. The `E1` case matters:
insisting on `FF D8 FF E0` would refuse every photograph taken on a phone,
which is the file this feature exists to accept.

The uploaded document appeared as a chip on the profile, and `DELETE` removed it
(`{"deleted":"QA19B upload probe"}`); the list re-read empty.

### ⚠️ Finding 2 — documents are stored under `_school`, not the campus

The object landed at

```
/21fad594-…/_school/student-documents/7547a69c-…/…
```

`_school` is `SCHOOL_WIDE_SEGMENT`, the documented placeholder for assets that
belong to no campus. The spec sketched `/{locationId}/{branchId}/…`.

**Not a security fault** — nothing authorises on the path, the service-role key
never leaves the server, and every read goes through a row that carries
`location_id`. It is a filing decision: a school group that later wants its
campuses' scans separated in the bucket cannot get that retrospectively without
moving objects. Worth a deliberate answer rather than a default.

### ⬜ The wizard's Documents step was not driven

Reaching it means completing an enrolment, which enrols a real child.

### ⬜ The ten-document and 5 MB ceilings were not reached

Both are enforced in the route and stated on the form; neither was exercised.

---

## ✅ Item 17 — academic history

`/dashboard/admissions/students/[id]/history` renders against a real published
result:

```
YEAR       TERM            EXAM                          CLASS           PERCENTAGE  RESULT      COMMENT
2026-2027  QA14 Mid-Term   QA14 Mid-Term — Infants       Pre-Nursery A   —           Exceeding   Speaks in full sentences…
                           01-Oct-2026 · 2 papers
```

Two things this proves that a list of columns would not:

* **The descriptor path works.** Percentage is `—` and the result is
  *Exceeding*, because this school grades its infants with descriptors rather
  than marks. A history that printed `0%` there would be wrong about a child.
* **The comment is the teacher's own words**, carried through from the result
  sub-category.

The page states its own rule in place: *"Marks a teacher has not finished
entering are not here — they are not a fact about the child yet."* One
`target="_blank"` link is present, so a percentage opens its report card in a
new tab without losing the page.

---

## ⬜ Item 18 — the guardian address

Not executed. The column, the parser and the wizard all carry it, and `0036`'s
verification wrote and rolled back a guardian address successfully — so the
storage half is proven. The **form** was not driven, because reaching the
guardian step means starting a real enrolment.

⚠️ Known gap, recorded by the developer and worth repeating here: **the guardian
panel on an existing profile still does not ask for an address.** It can be
recorded at enrolment and not corrected afterwards, which is the wrong way round
for a field whose whole purpose is that families move.

---

## ✅ Item 19 — "Enrol" is now "Enroll"

Observed in place on the screens driven: the sidebar's **Enroll Student**, the
academic-years description *"Every enrollment, section and student ID belongs to
a year"*, and the student profile, which contains no British spelling at all.

**What was checked in the source, because a rename is where the damage hides:**

| Risk | Result |
| --- | --- |
| A route path renamed | none — no `href`, redirect or pathname changed |
| An icon-registry key, CSS class or type key renamed | none |
| A database column renamed | none — every schema-file change is in a **comment** |
| `0036` containing a `RENAME` or `ALTER COLUMN` | none |
| A wire key changed on one side only | `enrolmentDate` → `enrollmentDate` moved on **both** sides; zero occurrences of the old spelling remain |

That last one is the Sprint 18 failure mode — three of its renames were
identifiers inside strings — and it is why this table exists rather than a note
saying the rename was mechanical.

---

## Gates

Fourteen green on the shipped tree:

```
typecheck  lint  check-loaders (277)  check-branch-scope (1314)  check-forms (60)
check-address-phone (40)  check-cnic (36)  check-currency (7)
check-sprint-periods (107)  check-accounting (121)  check-theme (7 palettes)
check-reports  check-dashboard (47)  check-portals (22)  build
```

`npm run build` is the one that mattered here: three new modules
(`db/schema/student-documents.ts`, `lib/academic-year-runs.ts`,
`lib/image-signature.ts`) are deliberately free of `server-only` and are
value-imported by `'use client'` components. That is the shape §5bg says only a
bundler sees, and it passed.

---

## What still has no fixture

Every ⬜ above resolves to the same sentence, now written for the fourth sprint
running: **a run, a promotion, an enrolment and a section copy all write real
records for real children, and there is nowhere else to write them.**

Sprint 19b adds four more paths to that list. A disposable tenant is no longer a
nice-to-have for QA — it is the only way the admissions module gets tested at
all.
