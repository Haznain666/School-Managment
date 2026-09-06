# Release notes — Sprint 31

**The sample sheet the importer was never able to show.**

One requirement from the product owner: *add an option to download a sample
sheet under Import Students, so new users can understand what fields the system
requires.*

---

## What was wrong

**Import students** asked a school for a file before anything told them what to
put in it.

The importer has always explained itself well — the mapping screen names every
field, marks the three that are required and describes what each one holds. The
problem was where that screen sits. It is step two. The only way to reach it is
to upload a file, so the answer to *"what do you want in it?"* was behind the
thing it was the answer to.

A school opening that page for the first time had two options: guess at a
spreadsheet and upload it to find out, or ask somebody. Neither is a product.

---

## What ships

### A sample sheet, on the first screen

The choose-a-file step now carries a **Download the sample sheet** button and,
under it, a table naming every column the importer reads: what it is called,
whether it is needed, and what goes in it. That table is read off the generated
file, so the screen cannot describe a column the file does not have.

The downloaded file is a real CSV — header row plus three example rows — and it
opens correctly in Excel on Windows, with the byte-order mark and the formula
guard every other download in this product carries.

### The headings are the ones the importer already recognises

The sample's column headings are drawn from the importer's own alias lists. A
school that fills the sample in and uploads it gets the mapping screen back with
**every one of the ten columns already matched** — they confirm a mapping
instead of assembling one.

Their own headings still work exactly as before. The sample is a shortcut, not a
requirement.

### Three rows, each making a different point

Not three copies of the tidiest row, which would teach that the tidiest row is
the only one that works. Between them the three examples show:

| Shown | So that |
| --- | --- |
| `2015-03-09`, `14/07/2016`, `2-11-2017` | a school does not reformat four hundred dates that would have been read as they stood |
| `female`, then `M` and `F` | an export that uses initials needs no editing |
| `03001234567`, `0321 987 6543`, `+92 333 4567890` | spaces, a leading zero and a country code are all accepted |
| a blank admission number on the third row | the school can see it will issue one |
| optional columns filled on one row and empty on the next | nothing implies that everything is needed |

### Two small repairs the sample forced into the open

- **Gender** and **B-Form / CNIC** now carry a description on the mapping
  screen. They had none, so the screen named the field and said nothing about
  it — and *B-Form / CNIC* is precisely the field a clerk is least sure about.
- `b-form / cnic` joins that field's list of recognised headings, so a column
  headed exactly that — including the sample's own — is matched outright.

---

## What stops it going stale

`npm run check-import-sample` — 25 assertions, running in CI on every push.

It reads the sample's own bytes back through the three functions a real upload
goes through (`parseCsv`, `suggestColumnMap`, `validateRow`) and requires that
every field is matched to its own column and every example row is valid. It also
requires that the screen links to the download.

This matters because every way a sample sheet can rot is **silent**. A heading
that stops matching does not throw: the file still downloads, still uploads, and
the columns simply arrive unmatched — which reads as poor guessing rather than a
stale sample. The person who finds it has already built four hundred rows
against it.

The rule is written up in `CLAUDE.md`, and the green-build list is now thirteen
checks rather than twelve.

---

## Verified

Against the standalone build running on the live database, signed in as the
Lahore Grammar School administrator:

- The screen renders on the school's own palette, on a desktop width and at
  390px, with no console errors.
- The download returns `200 text/csv`, `attachment; filename="student-import-sample.csv"`,
  and the byte-order mark is on the wire (`EF BB BF`).
- **The whole round trip**: the downloaded file, uploaded back into the
  importer, auto-matched all ten columns and the server's own dry run reported
  **3 valid, 0 invalid**.
- A **teacher** requesting the same download gets `403 forbidden`; the file is
  gated on `students.import`, the same permission the importer needs.
- Nothing was committed. No students were created, and the QA import batch was
  removed afterwards, leaving the school's data as it was.

---

## Migration

**None.** `0045` is still the next free migration number. Nothing needs to be run
against the database for this to work.
