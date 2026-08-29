# SPRINT-19A-DDL-NOTES.md — what `0035` does, and what breaks without it

Migration: `db/migrations/0035_sprint19a_branch_boundary.sql`
Journal entry: `db/migrations/meta/_journal.json`, `idx: 35`
Status at the time of writing: **written, NOT applied.** Applying it is the
DevOps step.

---

## ⚠ The migration goes first. Not "should", **must**.

`lib/branch-scope.ts` selects from `school_user_branches` on **every request
that resolves a campus scope**. That is not a corner of the product — it is:

| Surface | What it does on a database without `0035` |
| --- | --- |
| `/dashboard` | 500. The scope is resolved before any tile is read. |
| `/dashboard/admissions` | 500. |
| `/dashboard/branches/[id]` and `/edit` | 500 on the PATCH/DELETE guard. |
| `/dashboard/reports/[key]`, its print page and its CSV | 500. |
| `/dashboard/search` and `GET /api/school/search` | 500 for admin roles. |
| `GET /api/school/users` | 500. |
| The eight catalogue routes (subjects, fee types, grading schemes, exam terms, concession schemes, leave types, salary components, result subcategories) | 500 on GET and POST. |

The failure is `relation "school_user_branches" does not exist`, which reaches
the browser as a digest and names nothing. This is §5aw one module over — the
day `getAccountingOverview` counted a `ledger_transactions` that migration
`0027` had not yet created, and one missing table inside a `Promise.all` took
the students count, the staff count, three charts and every quick action with
it. `0029`'s banner says the same thing about a layout reading a table the
schema does not have.

**Apply `0035`, verify it, then deploy the code.** The migration is expand-only
and touches nothing the current build reads, so it is safe to apply while the
*old* build is still serving — which is the order it should actually be applied
in.

---

## What it does

Three blocks. Every one expand-only: one CHECK widened, one new table, nine new
nullable columns. No existing column is altered and no row is rewritten.

### Block 1 — `role_permissions_permission_check`

Widened to admit `branches.manage`, the one new permission key. Regenerated
from `PERMISSIONS` in `lib/permissions.ts`, which is also what
`db/schema/role-permissions.ts` derives its own CHECK from.

`npm run check-branch-scope` asserts the two lists are the same set, in both
directions, so they cannot drift.

**Nothing breaks before it runs.** `DEFAULT_ROLE_PERMISSIONS` is code and
`school_admin` holds `[...PERMISSIONS]`, so the school administrator already
has the key with no row written anywhere. What needs this block is the *first
school that toggles it on the permissions screen*: without it Postgres refuses
the INSERT with a constraint name and no explanation.

### Block 2 — `school_user_branches`

```
id              uuid pk
location_id     text  -> schools.location_id  on delete cascade
school_user_id  uuid  -> school_users.id      on delete cascade
branch_id       uuid  -> branches.id          on delete cascade
granted_by_uid  text
created_at      timestamptz not null default now()

unique (school_user_id, branch_id)
index  (location_id, school_user_id)
index  (branch_id)
```

Decision D2: cross-branch access is granted per person, not per role. An empty
table is the state of every school on the day this deploys, and an empty table
resolves to exactly today's behaviour — a branch-bound member reaches one
campus. **Nothing to seed, nothing to backfill.**

The unique index is load-bearing rather than hygienic. The branch form's *the
school owner* path writes this row every time the campus is saved, so without
it re-saving a campus banks a second identical grant and revoking then takes
two deletes.

### Block 3 — nine nullable `branch_id` columns

`subjects`, `fee_types`, `grading_schemes`, `exam_terms`,
`concession_schemes`, `leave_types`, `salary_components`,
`result_subcategories`, `late_fee_rules`.

Each gains:

```sql
ALTER TABLE <t> ADD COLUMN IF NOT EXISTS "branch_id" uuid;
ALTER TABLE <t> ADD CONSTRAINT "<t>_branch_id_branches_id_fk"
  FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id")
  ON DELETE set null;
CREATE INDEX IF NOT EXISTS "<t>_location_branch_idx" ON <t> ("location_id", "branch_id");
```

Decision D1: **NULL means shared by every branch**, and NULL is what every
existing row is. So nothing changes for any school on the day this deploys.

`ON DELETE SET NULL` on all nine, never CASCADE. Closing a campus must not
delete the school's grading scheme, its fee heads or its exam terms — every
published report card and every issued voucher points at those rows. A
branch-owned row whose branch is gone becomes shared, which is the safe
direction. `check-branch-scope` asserts this per table.

---

## The one wart, stated rather than hidden

**`late_fee_rules.branch_id` is inert on arrival.** `late_fee_rules.location_id`
carries a UNIQUE constraint — one policy per school — so no second row can exist
to hold a campus, and every row is and stays NULL.

The column ships anyway because it is expand-only and costs nothing, and
relaxing that unique index is a *separate* decision: the moment two rows can
exist, every reader of the table has to choose between them, and there is no
code today that would. Doing both in one migration would ship a state the
application cannot reason about.

If a later sprint wants per-campus due dates, that is a migration that drops
`late_fee_rules_location_id_key`, adds `unique (location_id, branch_id)`
— note that Postgres treats NULLs as distinct, so the school-wide row and a
campus row coexist — and, most importantly, decides *in code* which of the two
a voucher run reads.

---

## Rollback

Every statement is `IF NOT EXISTS` / `EXCEPTION WHEN duplicate_object`, so
re-running the migration is a no-op and applying it to a database that has had
one column added by hand is safe.

Undoing it is not offered and should not be attempted while the 19a build is
serving. If it must be undone, the code has to come down first, in the reverse
of the order above:

```sql
-- 1. take the 19a build down / roll back to the 18 build
DROP TABLE IF EXISTS "school_user_branches";
ALTER TABLE "subjects"             DROP COLUMN IF EXISTS "branch_id";
ALTER TABLE "fee_types"            DROP COLUMN IF EXISTS "branch_id";
ALTER TABLE "grading_schemes"      DROP COLUMN IF EXISTS "branch_id";
ALTER TABLE "exam_terms"           DROP COLUMN IF EXISTS "branch_id";
ALTER TABLE "concession_schemes"   DROP COLUMN IF EXISTS "branch_id";
ALTER TABLE "leave_types"          DROP COLUMN IF EXISTS "branch_id";
ALTER TABLE "salary_components"    DROP COLUMN IF EXISTS "branch_id";
ALTER TABLE "result_subcategories" DROP COLUMN IF EXISTS "branch_id";
ALTER TABLE "late_fee_rules"       DROP COLUMN IF EXISTS "branch_id";
-- and re-run 0034's Block 1 to narrow the permission CHECK again
```

Dropping a column is destructive: any campus assignment a school made in the
meantime is gone and cannot be recovered from anywhere. Prefer rolling the
code back and leaving the schema wide.

---

## How to apply it

`npm run db:migrate` is the documented route and **did not work in Sprint 18**:
`DATABASE_URL` in `.env.local` holds unescaped literal `@` characters in the
password, and `npx drizzle-kit migrate` hung on it for five minutes and applied
nothing (§5bg). `0034` was applied through drizzle-orm's own `postgres-js`
migrator instead — same statements, same `drizzle.__drizzle_migrations`
bookkeeping. Percent-encoding the password would likely restore the documented
route.

Expect the bookkeeping table to go from **35 rows to 36**.

## Verifying it

```sql
-- 1. the table
SELECT count(*) FROM information_schema.tables
 WHERE table_name = 'school_user_branches';                    -- 1

-- 2. all nine columns
SELECT table_name FROM information_schema.columns
 WHERE column_name = 'branch_id'
   AND table_name IN ('subjects','fee_types','grading_schemes','exam_terms',
                      'concession_schemes','leave_types','salary_components',
                      'result_subcategories','late_fee_rules')
 ORDER BY table_name;                                          -- 9 rows

-- 3. every one of them SET NULL, none of them cascade
SELECT c.conrelid::regclass AS tbl, c.confdeltype
  FROM pg_constraint c
 WHERE c.conname LIKE '%_branch_id_branches_id_fk'
   AND c.conrelid::regclass::text IN ('subjects','fee_types','grading_schemes',
       'exam_terms','concession_schemes','leave_types','salary_components',
       'result_subcategories','late_fee_rules');               -- all 'n' (SET NULL)

-- 4. every existing catalogue row is still shared
SELECT count(*) FROM subjects WHERE branch_id IS NOT NULL;     -- 0

-- 5. the permission key is accepted
INSERT INTO role_permissions (location_id, role, permission, granted)
VALUES ('<a real location id>', 'principal', 'branches.manage', true);
ROLLBACK;                                                      -- inside a transaction
```

Assertion 5 is the one worth running inside a `SAVEPOINT` per §5be, so a
refusal does not abort the rest of the check.
