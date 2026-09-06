# Sprint 31 test cases — the sample sheet the importer was never able to show

**Status: DRIVEN 2026-09-06**, twice: first against the **standalone production
artefact** on `localhost:3000` (`npm run build`, then
`node .next/standalone/server.js`), and again against the **live deployment**
`https://lgs.schoolhub.codexmill.com` on build `e3473f74a290` after the merge.
Both runs used **Lahore Grammar School** on the **live database**, entered
through a platform emergency-login link (`scripts/qa-emergency-link.mjs`) rather
than by typing a password.

**Results are recorded per case below.** Nothing here is marked PASS on the
strength of a gate or of reading the source: `check-import-sample` proves the
sample round-trips through three pure functions and proves nothing whatever
about whether a school can click the button.

⚠ **The seat trap** (unchanged from Sprint 29). *Login as Admin* signs you in as
the platform operator, who has **no `school_users` row** at any school. Use
`node scripts/qa-emergency-link.mjs lgs <address>`.

⚠ **The hidden-pane trap, in a new shape.** In the in-app Browser pane,
`document.body.innerText` and `get_page_text` returned **64 characters** for a
fully rendered screen — the pane does no layout, and `innerText` is defined in
terms of rendered text. Use `innerHTML` / `querySelectorAll` / `fetch` through
`javascript_tool`, and take screenshots with Playwright.

⚠ **This sprint's cases create an import batch at a real school.** Cases 5 and 6
stop at the dry run and **never press Import**. Both runs' batches were deleted
afterwards; `student_import_batches` was left at 0 rows and no student was
created. Any future run must do the same.

Set-up, and the live rows the cases are written against:

| | |
| --- | --- |
| School | Lahore Grammar School (`lgs`), academic year 2026-2027 |
| Operator | Sumera Hasnain — `school_admin`, holds `students.import` |
| Negative seat | LGS Teacher 1 — `teacher`, does **not** hold `students.import` |
| Section used for the dry run | Pre-Nursery — A |
| Before each run | `student_import_batches` = 0 rows |

---

## Item 1 — the screen answers the question before the file is chosen

### Case 1 — the sample sheet is offered on the first screen

**Who** Sumera Hasnain (`school_admin`).
**Do** Open **Admissions → Import Students**. Do not choose a file.

**Expect** Below *Choose a file*, a card headed *"Not sure what the file should
look like?"* carrying a **Download the sample sheet** button and a table of ten
columns.

**RESULT — PASS**, both runs. Card present, button present, table renders ten
rows. Screenshot taken at 1440px and at 390px.

---

### Case 2 — the table names every column, its need and its meaning

**Do** Read the table.

**Expect** Three columns — *Column*, *Needed?*, *What goes in it* — and ten rows
matching the importer's own fields, with exactly three marked **Required**
(Student name, Guardian name, Guardian phone).

**RESULT — PASS.** Ten rows, three Required, seven Optional. Every description
is the field's own `hint` from `IMPORT_FIELDS`, so the screen and the mapping
step cannot disagree.

**Defect found and fixed during the run.** The required marks were
`Badge variant="warning"` — ten amber badges on a screen describing a *blank*
file, before anybody has done anything, read as ten problems. Changed to
`brand`. Re-verified live.

---

### Case 3 — the download is a real, correct CSV

**Do** Click **Download the sample sheet**. Then, for the header assertions,
`fetch('/api/school/student-imports/sample')` from the page.

**Expect** The browser saves a file named `student-import-sample.csv`;
`200 text/csv; charset=utf-8`; `content-disposition: attachment;
filename="student-import-sample.csv"`; the body is a header row plus three data
rows.

**RESULT — PASS**, both runs. Playwright reported *"Downloading file
student-import-sample.csv"* and the page did not navigate.

---

### Case 4 — the file opens correctly in Excel on Windows

**Do** Read the response as an `ArrayBuffer` and inspect the first three bytes.

**Expect** `EF BB BF` — the UTF-8 byte-order mark.

**RESULT — PASS.** `[239, 187, 191]`.

⚠ **Do not assert this through `.text()`.** `fetch` strips the BOM when decoding,
so `t.charCodeAt(0) === 0xFEFF` reports **false** on a file that has one. That
check was written first and it lied. Use `arrayBuffer()`.

---

## Item 2 — the whole promise: a file built on the sample imports

### Case 5 — the sample uploads and maps itself, with no manual mapping

**Do** Download the sample, feed the identical bytes back into the page's file
input (a real `File` on `input.files` plus a `change` event), and read the ten
mapping selects.

**Expect** The screen advances to *Match your columns* and **all ten selects
carry a value** — none left on *Choose a column…* or *Not in my file*.

**RESULT — PASS**, both runs. Zero unmapped columns. Each field matched its own
column: `Student name`, `Admission number`, `Date of birth`, `Gender`,
`Roll number`, `B-Form / CNIC`, `Guardian name`, `Guardian phone`,
`Guardian email`, `Relationship`.

This is the case the sprint exists for. It is also the one that would fail
silently if a heading stopped matching an alias — the file would still upload
and the columns would simply arrive blank.

---

### Case 6 — the server agrees, and accepts all three example rows

**Do** From *Match your columns*, pick a class (Pre-Nursery — A), press
**Check the file**. **Do not press Import.**

**Expect** The report reads **3 Will be imported**, with no *Needs fixing*
badge.

**RESULT — PASS** (localhost run). The stored batch row is the evidence:
`total_rows 3, valid_rows 3, invalid_rows 0, created_rows 0, committed_at null`.

**Cleanup performed.** The batch and its three rows were deleted; `students`
gained nothing (`created in last 30 minutes: 0`).

---

### Case 7 — the preview raises no complaint about the sample

**Do** On *Match your columns*, read the five-row preview panel.

**Expect** No *"Problems in these first N rows"* banner.

**RESULT — PASS.** No banner. The client-side `validateRow` accepts all three
rows against the auto-generated mapping, so the operator's first sight of their
own file is not a list of objections about ours.

---

### Case 8 — the three rows demonstrate what they were written to demonstrate

**Do** Read the preview table.

**Expect** Between the three rows: three date spellings (`2015-03-09`,
`14/07/2016`, `2-11-2017`); `female`, `M`, `F`; three phone formats including a
spaced one and a `+92` one; a blank admission number on row 3; optional columns
both filled and empty.

**RESULT — PASS.** All present. The `+92` number displays as
`'+92 333 4567890` — the leading apostrophe is `lib/csv-export.ts`'s formula
guard, and `normaliseImportPhone` reads straight through it (asserted in
`check-import-sample`, and the parsed candidate is `+923334567890`).

---

## Item 3 — the boundary

### Case 9 — a teacher cannot download it

**Who** LGS Teacher 1 (`teacher`), signed in by emergency link.
**Do** `fetch('/api/school/student-imports/sample')`.

**Expect** `403`, `{"ok":false,"error":{"code":"forbidden", …}}`.

**RESULT — PASS.** Exactly that. The route is gated on `students.import`, the
same permission the importer screen requires, so the file cannot be reached from
a seat that could not use it.

---

### Case 10 — no session, no file

**Do** `fetch('/api/school/student-imports/sample', { credentials: 'omit' })`.

**Expect** No CSV.

**RESULT — PASS.** Middleware answers with the sign-in page (HTML `200`), not
the file. Worth stating exactly: this is **not** a `401 forbidden` JSON body —
it is the platform's existing redirect-to-login behaviour for `/api/school/*`,
and the assertion that matters is that no `text/csv` body is served.

---

### Case 11 — the console is clean

**Do** Open the screen, download, upload, check the file. Read the console.

**RESULT — PASS.** The only error logged across the whole run was the `403`
deliberately provoked by case 9.

---

## Item 4 — the check itself, proved by attempt

A check that cannot fail is not a check. Both failure modes were **induced and
observed**, then reverted; the working tree was confirmed clean afterwards.

### Case 12 — a heading that is no longer an alias fails the build

**Do** Change the `guardianPhone` sample heading from `Guardian phone` to
`Contact No.`. Run `npm run check-import-sample`.

**RESULT — PASS (fails as designed).**
`FAIL — 2 of 25 assertions failed`, naming the alias rule and the formula-guard
row. Reverted; back to `PASS — 25`.

### Case 13 — a new import field with no sample column fails the build

**Do** Add a `bloodGroup` field to `IMPORT_FIELDS` and nothing to
`SAMPLE_COLUMNS`. Run the check.

**RESULT — PASS (fails as designed).** `sampleSheetColumns()` throws at module
load with *"The import field 'bloodGroup' has no column in the sample sheet. Add
one to lib/student-import-sample.ts."* — non-zero exit. Reverted; back to
`PASS — 25`.

---

## Automated coverage

`npm run check-import-sample` — **25 assertions, in `.github/workflows/ci.yml`**.

It reads the sample's own bytes back through `parseCsv`, `suggestColumnMap` and
`validateRow` and requires a bijection, plus the BOM, the delimiter, the row
count, the three rows' parsed dates / genders / phones, the absence of duplicate
admission numbers, and that the screen links to the route with a `download`
attribute.

It replaces cases 5, 7, 8 and 12–13 for every future run. It **does not**
replace cases 1–4, 6 and 9–11, which need a browser and a session — and case 5
is worth driving by hand anyway on any sprint that touches `IMPORT_FIELDS`,
because the check exercises the functions and only a browser exercises the
screen.

---

## Green build at the time of the run

All thirteen: `typecheck`, `lint`, `check-loaders`, **`check-import-sample`**,
`check-forms`, `check-address-phone`, `check-cnic`, `check-currency`,
`check-theme`, `check-sprint-periods`, `check-accounting`,
`check-branch-scope`, `build`.

**No migration.** `0045` is still the next free number.
