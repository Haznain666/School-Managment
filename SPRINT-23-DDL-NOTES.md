# SPRINT-23-DDL-NOTES.md — what `0039` does, and what breaks without it

Migration: `db/migrations/0039_sprint23_principal_grades_staff_photo.sql`
Journal entry: `db/migrations/meta/_journal.json`, `idx: 39`, stamped
`1788609600000`.
Status at the time of writing: **written, NOT applied.** Applying it is the
DevOps step; this sprint deliberately did not touch the live database.

`0039` was confirmed free by **listing `db/migrations/`**, not by trusting
prose: the directory ended at `0038`. `npm run check-sprint23` confirms the same
thing from the other end — it reads `information_schema.columns` and reported
both new columns **absent** on 2026-09-03.

---

## What it does

Two `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. Nothing else. No row is read, no
row is written, no constraint is added and nothing is dropped.

| Step | Statement | Why |
| --- | --- | --- |
| 1 | `schools.allow_shared_principal_grades boolean NOT NULL DEFAULT false` | may one grade be held by more than one principal? Off by default |
| 2 | `staff.photo_url text` | the personnel photograph, exactly the shape `student_profiles.photo_url` already has |

drizzle-orm's migrator runs the file inside one transaction, so both commit or
neither does. There is deliberately no explicit `BEGIN`; that would be a nested
transaction the migrator did not ask for.

**No new permission keys**, so the `role_permissions` `permission` CHECK is
untouched — the trap STATE.md §5o records.

### `NOT NULL DEFAULT false` on a live table is safe here

Postgres 11 and later record a non-volatile column default in the catalogue
rather than rewriting the heap, so step 1 is a metadata-only change and takes an
`ACCESS EXCLUSIVE` lock for the time it takes to write one catalogue row.
`schools` holds a handful of rows in any case. Step 2 is nullable with no
default and never rewrites anything.

### Existing overlaps are grandfathered, on purpose

A school may already have two principals holding grade 3.
**This migration does not delete or alter a single `principal_assignments`
row.** `allow_shared_principal_grades = false` applies to *writes from the day
it ships*; what is already there stays, and the assignment card on the branch
page shows it with an *"Also assigned to X"* chip so an administrator resolves
it deliberately.

Silently ending somebody's assignment to satisfy a default nobody at that school
has yet seen is not a migration's business. If you want to find them first:

```sql
-- Grades held by more than one head, under assignments in force today.
SELECT pa.location_id, g AS grade_id, count(DISTINCT pa.school_user_id) AS heads
  FROM principal_assignments pa, unnest(pa.grade_ids) AS g
 WHERE pa.starts_on <= current_date
   AND (pa.ends_on IS NULL OR pa.ends_on >= current_date)
 GROUP BY 1, 2
HAVING count(DISTINCT pa.school_user_id) > 1;
```

---

## ⚠ Deploy order: **migration first, then the code**

This is the opposite of Sprint 21 and the same as Sprint 20. Four surfaces read
a column that does not exist yet, and each of them is a 500 until `0039` lands.

| Surface | Without `0039` |
| --- | --- |
| **HR → Staff directory** (`GET /api/school/hr/staff`) | 500. `listStaff` selects `staff.photo_url` |
| **One staff member's profile** (`GET /api/school/hr/staff/[id]`) | 500. `getStaff` selects the same column |
| **Settings** (`/dashboard/settings`) | 500. The page reads `schools.allow_shared_principal_grades` to draw the toggle |
| **Principals card** (`GET/POST/PATCH /api/school/principals`) | 500. `getPrincipalSettings` reads the flag before deciding a clash |
| **Uploading a staff photo** (`POST …/hr/staff/[id]/photo`) | 500 on the `UPDATE` |

Everything else in Sprint 23 works on an unmigrated database: the discount
repricing, the whole of the principal visibility filter, the class-teacher
picker, the designation default, the date-field width and the joining-date
ceiling all touch existing columns only.

### What was done to keep that list to five

Two things, and both would look like tidy-up candidates to somebody reading the
code later. They are not.

**`getPrincipalModel` reads one column and must keep reading one column.** It
sits inside `resolvePrincipalScope`, which is on **every request a principal
makes**. Folding the new flag into it — which is the obvious simplification,
since `getPrincipalSettings` right beside it reads the same row — would mean
every screen a head opens is a 500 for the whole deploy window, instead of the
two screens that actually manage assignments. The docblock in
`lib/principal-resolver.ts` says so at the point of temptation.

**`GET /api/school/settings` does not select the new column, and neither does
`PATCH`'s response.** That route's GET is called by *every portal layout* to
fill the navbar, so selecting a column that does not exist yet would blank every
portal at the school — parents and students included — for a value only the
Settings page needs. The Settings page reads it server-side from `schools`
directly. So the write is on the route and neither read is.

`npm run check-sprint23` asserts the first of those directly: it runs
`getPrincipalModel` against an unmigrated database and requires it to
**succeed**, beside the four statements it requires to fail with `42703`.

---

## How to apply it

`npm run db:migrate` is the documented route and **has not worked since Sprint
18**: `DATABASE_URL` in `.env.local` holds unescaped literal `@` characters in
the password, and `npx drizzle-kit migrate` hangs on it and applies nothing
(§5bg). `0034` through `0038` all went in through drizzle-orm's own
`postgres-js` migrator instead — same statements, same
`drizzle.__drizzle_migrations` bookkeeping — against the **pooler host on port
5432** (session mode; 6543 is transaction mode and will not do DDL, and the
direct `db.<ref>.supabase.co` host is IPv6-only, §5c).

`scripts/apply-0038.mjs` is the working shape; copy it, point it at
`0039_sprint23_principal_grades_staff_photo.sql`, and expect the bookkeeping
table to gain the entry stamped `1788609600000`.

Both statements carry `IF NOT EXISTS`, so a re-run is a no-op rather than a
`42701`.

---

## Verifying it — against the catalogue, not the exit code

An exit code says the migrator did not throw. It does not say the columns are
there, are the right type, or defaulted the way the code assumes. Read them:

```sql
-- 1. both columns exist, with the right type, nullability and default
SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (   (table_name = 'schools' AND column_name = 'allow_shared_principal_grades')
        OR (table_name = 'staff'   AND column_name = 'photo_url'));
-- schools | allow_shared_principal_grades | boolean | NO  | false
-- staff   | photo_url                     | text    | YES | (null)

-- 2. every existing school got the safe default, and none got null
SELECT count(*) FILTER (WHERE allow_shared_principal_grades IS NULL)  AS nulls,       -- 0
       count(*) FILTER (WHERE allow_shared_principal_grades)          AS sharing,     -- 0
       count(*)                                                       AS schools
  FROM schools;

-- 3. every existing staff row survived with a null photograph
SELECT count(*) AS staff, count(photo_url) AS with_photo FROM staff;   -- with_photo = 0

-- 4. nothing was unassigned. Compare this against the same count taken before.
SELECT count(*) FROM principal_assignments;
```

### And the refusal itself, inside a `SAVEPOINT`

The new flag is enforced in the API rather than by a constraint, so there is no
`23505` to provoke. What there *is* to check is that the default did not somehow
arrive as `true` — because `true` would silently switch the whole rule off at
every school and no screen would say so:

```sql
BEGIN;
  SAVEPOINT a;
    -- must fail: 23502, null value in column violates not-null
    UPDATE schools SET allow_shared_principal_grades = NULL
     WHERE location_id = '<any school>';
  ROLLBACK TO a;
ROLLBACK;
```

The `SAVEPOINT` is not optional. A refusal aborts the whole transaction
otherwise, and everything after it reports the *test's* failure rather than the
schema's — §5bh records that trap costing a re-run.

### Then run the gate

```
npm run check-sprint23
```

Before `0039` it prints `0039 is NOT applied` and passes with four predicted
`42703`s. After it, the same command prints `0039 is APPLIED`, expects all
thirty-one statements to execute, and additionally asserts the two columns'
type, nullability and default out of the catalogue. **The expectation flips
itself** — the script reads the catalogue rather than being told — so one
command is the check on both sides of the deploy.

A half-applied database (one column present, one absent) is reported as its own
failure rather than being read as "not applied". `0039` adds both inside one
transaction, so that state means somebody ran the statements by hand, and
predicting a `42703` for a statement that is going to succeed would leave the
run green over a database nothing in this repository produces.

### Then click two things

1. **HR → Staff.** The directory draws an avatar per person — initials for
   everybody, because nothing has a photograph yet. Open one, upload a JPEG
   under 2 MB, and it must appear on both the profile and the list. A 3 MB file
   must be refused with *"The photo must be 2 MB or smaller."* and a PDF with
   *"The photo must be a PNG, JPG or WebP image."*
2. **Settings → Principals.** The toggle reads *"Allow a class to have more than
   one principal"* and is **off**. Turn it on, open a campus, and the grade chips
   that were greyed with another head's name become selectable. Turn it off
   again and an existing overlap is still there, chipped *"Also assigned to X"* —
   nothing was deleted.

---

## Rollback

Both steps are reversible and neither loses anything the code cannot rebuild:

```sql
ALTER TABLE "schools" DROP COLUMN IF EXISTS "allow_shared_principal_grades";
ALTER TABLE "staff"   DROP COLUMN IF EXISTS "photo_url";

DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788609600000;
```

**Roll the code back first, or in the same window.** Dropping these columns
under a Sprint 23 build puts the five surfaces in the table above back into a
500 — it is the deploy-order hazard again, in the other direction.

Dropping `staff.photo_url` orphans whatever has been uploaded into Storage under
`<location_id>/staff/<staff_id>/photo.<ext>`. Nothing reads those objects once
the column is gone and nothing charges much for them, but if the rollback is
meant to be clean they are the thing to sweep. The student photographs under
`<location_id>/students/…` are untouched by any of this.

Rolling back `allow_shared_principal_grades` loses only the schools that had
turned it **on**; every assignment they made while it was on stays exactly where
it is, because the flag governs writes and never the rows.
