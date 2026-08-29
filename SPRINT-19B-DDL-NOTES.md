# SPRINT-19B-DDL-NOTES.md — what `0036` does, and what breaks without it

Migration: `db/migrations/0036_sprint19b_admissions.sql`
Journal entry: `db/migrations/meta/_journal.json`, `idx: 36`
Status at the time of writing: **written, NOT applied.** Applying it is the
DevOps step.

`0035` (Sprint 19a) is applied and verified. `0036` builds on the tree that
shipped with it and touches none of the same objects.

---

## ⚠ The migration goes first. Not "should", **must**.

Two of the three blocks are read on screens that already exist and are already
reached by the sidebar. The failure is `relation "…" does not exist`, which
reaches the browser as a digest and names nothing.

| Surface | What it does on a database without `0036` |
| --- | --- |
| `/dashboard/admissions/academic-years` | 500. `listAcademicYears` reads `academic_year_branches` in a second statement on every render. |
| `/dashboard/admissions/promote` | 500. Same call, for the year pickers. |
| `/dashboard/admissions/students/[id]` | 500. The profile reads `student_documents` inside its `Promise.all`. |
| `GET /api/school/academic-years` | 500. |
| `POST /api/school/academic-years` | 500 — and this one is a *write*, so it fails after validating rather than before. |
| `POST /api/school/students/[id]/documents` | 500 **after the object has been uploaded**, leaving an orphan in the bucket. |
| `DELETE /api/school/students/[id]/documents/[docId]` | 500. |
| Enrolment (`POST /api/school/students`) with a guardian address | 500 — `student_guardians.address` does not exist, and the insert is inside the enrolment transaction, so **the whole enrolment rolls back**. |

That last row is the one to read twice. Blocks 1 and 2 break *reads*, which is
loud and harmless. Block 3 breaks a **write** that already worked: the enrolment
wizard now sends `address`, `latitude` and `longitude` on every guardian, and
without the columns Drizzle's insert names a column the table does not have.
Enrolling a child stops working entirely at every school, and the message the
clerk gets is "Could not complete the enrolment. Please check the details and
try again."

This is §5aw one module over, and §5bh's own banner for `0035` says the same
thing. **Apply `0036`, verify it, then deploy the code.** The migration is
expand-only and touches nothing the current build reads, so it is safe to apply
while the *old* build is still serving — which is the order it should actually
be applied in.

---

## What it does

Three blocks. Every one expand-only: two new tables and three new nullable
columns. No existing column is altered, no row is rewritten, and **no
permission key is added**, so the `role_permissions` CHECK is untouched.

### Block 1 — `academic_year_branches`

```
id               uuid pk
location_id      text -> schools.location_id  on delete cascade
academic_year_id uuid -> academic_years.id    on delete cascade
branch_id        uuid -> branches.id          on delete cascade
created_at       timestamptz not null default now()

unique (academic_year_id, branch_id)
index  (location_id, academic_year_id)
index  (location_id, branch_id)
```

**A year with no rows here is school-wide**, which is every academic year at
every school on the day this deploys. Absence means "all of them", so there is
**nothing to seed and nothing to backfill**, and no existing year changes
meaning.

It is decision D1's "null means shared" expressed as a join table rather than
as a nullable column, because a year can run at two campuses out of three and
one column cannot say that. A group with a separate O-Levels campus has that
case on day one.

`ON DELETE CASCADE` on both parents, and that is deliberately **not** the
`SET NULL` rule `0035` used for the nine catalogue tables. A catalogue row whose
campus is deleted is still the school's grading scheme, so it becomes shared. A
row here says only "this year runs at this campus"; with the campus gone the
statement is not school-wide, it is meaningless — and `SET NULL` is not even
available, because the column is NOT NULL by design: a row naming no campus is
the absence this table encodes by having no row at all.

The unique index is load-bearing rather than hygienic. A run interrupted half
way and re-run must not bank a second row for a campus it has already attached.

### Block 2 — `student_documents`

```
id                 uuid pk
location_id        text    -> schools.location_id       on delete cascade
student_profile_id uuid    -> student_profiles.id       on delete cascade
title              text    not null
storage_path       text    not null
download_url       text    not null
content_type       text    not null
size_bytes         integer not null
uploaded_by_uid    text
created_at         timestamptz not null default now()

index (location_id, student_profile_id)
check content_type IN ('image/png','image/jpeg')
check char_length(btrim(title)) BETWEEN 1 AND 120
check size_bytes > 0 AND size_bytes <= 5242880
```

Ten documents per student and 5 MB each, both enforced in the route and both
stated on the form. The two CHECKs on size and title are belt-and-braces over
that, and they earn their DDL because the row and the object are two records of
one fact stored in two systems: a `size_bytes` that cannot be true means they
have stopped describing each other, and the row is the one nobody can check by
looking at it.

`content_type` admits the two canonical types and never `image/jpg`, which is
not a media type — it is what some Windows browsers send. The route stores what
the **bytes** say (`sniffImageType` in `lib/image-signature.ts`), not what the
upload claimed, so a file whose header said `image/jpg` lands here as
`image/jpeg`.

`ON DELETE CASCADE` from the student. Deleting a student already takes their
enrolments, guardians and concessions; leaving these rows behind would leave the
*objects* orphaned with nothing pointing at them — a school's children's birth
certificates, in a bucket, unreferenced and unfindable.

### Block 3 — `student_guardians.address`, `.latitude`, `.longitude`

```sql
ALTER TABLE student_guardians ADD COLUMN IF NOT EXISTS address   text;
ALTER TABLE student_guardians ADD COLUMN IF NOT EXISTS latitude  double precision;
ALTER TABLE student_guardians ADD COLUMN IF NOT EXISTS longitude double precision;
```

The shape is copied from `branches`, so one component serves both: filled by
`AddressAutocomplete`, with both coordinates null whenever the operator typed
the address rather than choosing a suggestion. That is the common case in
Pakistan and it is not a degraded one — Mapbox's data there is cities and
localities, so most real addresses produce no suggestion at all.

**Never required, and no NOT NULL is ever coming.** CLAUDE.md's "blank is always
allowed" rule is written about the CNIC and the reasoning transfers whole: an
admissions desk with a queue in front of it will invent an answer to get past a
required field, and an invented address on a fee notice is worse than an absent
one.

---

## The one thing to know that is not in the SQL

**The upload route writes to Supabase Storage before it writes the row.** On a
database without Block 2 the insert fails *after* the object has landed, so
every attempted upload leaves an orphan at
`{locationId}/{branchId}/student-documents/{studentProfileId}/{uuid}.{ext}`.

Nothing references those objects and nothing will ever clean them up, because
the only thing that knows their paths is the row that failed to be written. If
the code does reach production ahead of this migration, the objects under that
prefix with no matching `student_documents` row are safe to delete by hand once
`0036` is applied — and there is no way to tell which they are afterwards
except by listing the prefix and diffing it against the table.

The order (Storage first, row second) is still the right one: the alternative
leaves a row whose chip on the profile opens a 404, which an operator cannot
tell from a document somebody deleted.

---

## Rollback

Every statement is `IF NOT EXISTS` / `EXCEPTION WHEN duplicate_object`, so
re-running the migration is a no-op and applying it to a database that has had
one column added by hand is safe.

Undoing it is not offered and should not be attempted while the 19b build is
serving. If it must be undone, the code comes down first:

```sql
-- 1. roll the build back to 19a
DROP TABLE IF EXISTS "student_documents";
DROP TABLE IF EXISTS "academic_year_branches";
ALTER TABLE "student_guardians" DROP COLUMN IF EXISTS "address";
ALTER TABLE "student_guardians" DROP COLUMN IF EXISTS "latitude";
ALTER TABLE "student_guardians" DROP COLUMN IF EXISTS "longitude";
```

Dropping `student_documents` **does not delete the objects in Storage**. They
stay in the bucket, unreferenced, and the paths are gone with the rows. Export
`storage_path`, `title` and `student_profile_id` before dropping it if there is
any chance the feature comes back.

Dropping `academic_year_branches` silently widens every campus-specific year to
the whole school, which is the safe direction but is not reversible: nothing
records which years were campus-specific before the drop.

---

## How to apply it

`npm run db:migrate` is the documented route and **has not worked since Sprint
18**: `DATABASE_URL` in `.env.local` holds unescaped literal `@` characters in
the password, and `npx drizzle-kit migrate` hung on it for five minutes and
applied nothing (§5bg). `0034` and `0035` both went in through drizzle-orm's own
`postgres-js` migrator instead — same statements, same
`drizzle.__drizzle_migrations` bookkeeping — against the **pooler host on port
5432** (session mode; 6543 is transaction mode and will not do DDL, and the
direct `db.<ref>.supabase.co` host is IPv6-only, §5c). Percent-encoding the
password would likely restore the documented route and nobody has done it yet.

Expect the bookkeeping table to go from **36 rows to 37**, with entry `id=37`
stamped `1788091200000` to match the journal.

## Verifying it

```sql
-- 1. both tables
SELECT table_name FROM information_schema.tables
 WHERE table_name IN ('academic_year_branches','student_documents')
 ORDER BY table_name;                                          -- 2 rows

-- 2. the three guardian columns, all nullable
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'student_guardians'
   AND column_name IN ('address','latitude','longitude')
 ORDER BY column_name;   -- text/double precision/double precision, all YES

-- 3. the join table cascades on BOTH parents (not SET NULL, unlike 0035)
SELECT c.conname, c.confdeltype
  FROM pg_constraint c
 WHERE c.conrelid = 'academic_year_branches'::regclass
   AND c.contype = 'f';                                        -- all 'c'

-- 4. the unique index the run writer leans on
SELECT indexname FROM pg_indexes
 WHERE tablename = 'academic_year_branches'
 ORDER BY indexname;    -- …_year_branch_idx (unique) + the two location ones

-- 5. every existing academic year is still school-wide
SELECT count(*) FROM academic_year_branches;                   -- 0

-- 6. the CHECKs actually refuse — each inside its own SAVEPOINT, per §5be
BEGIN;
  SAVEPOINT a;
    INSERT INTO student_documents
      (location_id, student_profile_id, title, storage_path, download_url,
       content_type, size_bytes)
    VALUES ('<a real location id>', '<a real student_profiles.id>', 'X',
            'p', 'u', 'application/pdf', 10);        -- 23514 content_type_check
  ROLLBACK TO a;
  SAVEPOINT b;
    INSERT INTO student_documents (…) VALUES (…, 'image/png', 5242881);
                                              -- 23514 student_documents_size_check
  ROLLBACK TO b;
  SAVEPOINT c;
    INSERT INTO student_documents (…, title, …) VALUES (…, '   ', …);
                                              -- 23514 student_documents_title_check
  ROLLBACK TO c;
ROLLBACK;
```

Assertion 6 must run inside `SAVEPOINT`s: a refusal aborts the whole
transaction otherwise and the remaining assertions report a failure that is the
*test's* fault, not the schema's. §5bh records that trap costing a re-run.

Also worth doing once, and only after applying: open
`/dashboard/admissions/academic-years`, the promotion screen, and one student
profile. All three 500 without this migration and all three are one click from
the sidebar, so a successful apply is visible in ten seconds without a query.
