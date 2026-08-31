# SPRINT-21-DDL-NOTES.md — what `0038` does, and what it cannot fix

Migration: `db/migrations/0038_sprint21_one_email_one_person.sql`
Journal entry: `db/migrations/meta/_journal.json`, `idx: 38`, stamped
`1788264000000` — one day after `0037`.
Status at the time of writing: **written, NOT applied.** Applying it is the
DevOps step.

`0038` was confirmed free by **listing `db/migrations/`**, not by trusting
prose: the directory ended at `0037`.

`0037` **is applied.** Read from `drizzle.__drizzle_migrations` on 2026-08-31
rather than from STATE.md: the table holds 38 rows, the newest stamped
`1788177600000`, which is `0037`'s own `when`. An earlier draft of this file
said it was still unapplied; that was wrong, and it is corrected here rather
than quietly deleted because the number of bookkeeping rows is how every
migration in this repository is verified and a wrong count would mislead the
next person who checks. `0038` becomes row 39.

---

## ⚠ This one is not expand-only, and the difference matters

`0037` added columns nothing was reading yet. `0038` **rewrites rows** and then
adds a constraint that can refuse to build. The three steps are ordered and the
order is load-bearing:

| Step | What it does |
| --- | --- |
| 1 | re-points every `student_guardians.school_user_id` that points at a `role = 'student'` row, to the `parent` row at the same school with the same `lower(email)` — and to `NULL` where there is none |
| 2 | gives every wrongly-contacted `student` directory row its `student:<admission number>` sentinel back, and clears its `email` and **`auth_user_id`** |
| 3 | creates the partial unique index on `(location_id, lower(email))` for active rows with a non-blank address |

**Step 1 must run before step 2.** Step 1 finds the father's parent row *by the
address sitting on the child's row*, and step 2 is what removes that address.
Reversed, step 1 matches nothing — silently — and every affected family stays
broken while the migration reports success.

drizzle-orm's migrator runs each migration file inside one transaction, so the
three commit together or not at all. There is deliberately no explicit `BEGIN`
in the file; that would be a nested transaction the migrator did not ask for.

### Unlike `0037`, no screen is down without it

Every code change in Sprint 21 works on an unmigrated database, and the code
should go **first**:

| Surface | Without `0038` |
| --- | --- |
| `/student/results`, `/parent/results` | **fixed by the code alone.** The 42P10 was a `SELECT DISTINCT` ordered by an unselected column, and `lib/portal-results.ts` no longer writes one |
| the parent dashboard's child cards | same — the attendance and results panels fill in as soon as the build ships |
| parent-portal provisioning | refuses in words where it used to write to a child's row. No migration needed |
| enrolment | never links a guardian to a student directory row. No migration needed |
| `otp/verify` | binds exactly one row or none. On an unmigrated database "more than one" is still *possible*, which is exactly why this guard exists |
| **Father 1 at LGS** | still lands in the student portal. This is the one thing only `0038` fixes |

So the deploy order is the opposite of Sprint 20's: **ship the code, then apply
`0038`.** The code makes the migration's job smaller and nothing in it depends
on the index existing.

---

## What it repairs, measured rather than assumed

Every figure below was read from the live database on 2026-08-31, before
anything was applied:

```
active (location_id, lower(email)) duplicates          1
guardian rows linked to a role='student' school_users  1
student rows still carrying a guardian contact detail  1
duplicates that survive steps 1 and 2                  0
```

They are all the same family. At LGS (`21fad594-…`):

| row | role | phone | email | auth_user_id |
| --- | --- | --- | --- | --- |
| `9ebacf91…` "Student 1" | `student` | `+923213124545` | `…+father1@gmail.com` | `c07f75d0…` |
| `2c329df7…` "Father 1" | `parent` | `+923001234156` | `…+father1@gmail.com` | null |

Father 1 has five children enrolled and five `student_guardians` rows. Four
point at `2c329df7…`, his own parent row. The fifth — `0328891e…`, on Student 1
— points at `9ebacf91…`, **his daughter's directory row**, and his Supabase
account is bound there. After `0038` all five point at `2c329df7…` and his
account is bound to nothing.

`npm run check-sprint21` re-derives all four numbers on whichever side of the
migration it is run, so they can be checked rather than believed.

### How it happened

A student's directory row used to borrow the primary guardian's mobile.
`school_users` is unique on `(location_id, phone)`, so parent-portal
provisioning — which upserts on exactly that pair — landed on the child's row,
wrote the father's address onto it, and pointed the guardian link there. He
accepted his invite and GoTrue bound his uid to a row whose role is `student`.
`school_users_location_id_auth_user_id_idx` is unique per school, so from that
moment his uid could never also sit on his own `parent` row.

`lib/enrollment.ts` stopped creating rows that way when the
`student:<admission number>` sentinel became unconditional. **It repaired
nothing**, and nothing stopped the upsert landing on the rows already there —
which is why the migration and the two new code guards both exist.

---

## The design decisions, so they are not re-litigated

### A wrong link is worse than no link

Step 1 sets `school_user_id` to `NULL` where no parent row carries the address,
rather than leaving it where it is. `student_guardians.school_user_id` is what
the parent portal follows to decide which children a signed-in person may see. A
link left pointing at a child is one family reading another child's attendance,
results and fee ledger, rendered as a completely ordinary parent portal with the
wrong child in it. No link shows an empty portal and an administrator one click
from fixing it — a bad day rather than a breach.

### The match is on the address, never on the phone

The phone is precisely the column that was wrong; it is how the two rows got
confused in the first place. Matching on it would re-point the guardian link
straight back at the same mistake.

### Step 2 is narrow on purpose

Only a `student` row whose phone is not the sentinel **and** whose phone or
address matches a guardian's contact detail at the same school. A student row
carrying a phone number no guardian shares is left exactly as it is. This
migration is not a tidy-up of other people's data, and a school that
deliberately recorded a sixth-former's own mobile has done nothing wrong.

### Clearing `auth_user_id` is the point, not the tidying

Everything else in step 2 is bookkeeping. Unbinding is what frees the father's
Supabase account to bind to his own parent row the next time he signs in. It
costs the child nothing, because the account was never the child's.

**It does mean the affected person must sign in with an emailed code once**,
not a saved password: `getSchoolUserByUid` answers null for an unbound uid, and
`otp/verify` is the only path that binds one. See "After applying it" below.

### The index is partial, and scoped to the active

```
UNIQUE (location_id, lower(email))
WHERE email IS NOT NULL AND email <> '' AND is_active
```

* `lower(email)` because one inbox is one inbox. A constraint admitting
  `Father@Example.com` beside `father@example.com` would only ever catch the
  careful, and every sign-in read is case-insensitive from this sprint on;
* `email IS NOT NULL AND email <> ''` because the column is nullable and a
  school with forty staff who have no address on file is normal, not a school
  with thirty-nine duplicates;
* `is_active` because a teacher who left in June and is re-hired in September
  must not be blocked by her own archived membership. A leaver is history, and
  history does not get to hold an address.

### No new permission keys

The `role_permissions` `permission` CHECK is untouched — the trap STATE.md §5o
records. Nothing here is a new *kind* of thing a school would grant separately.

---

## Not fixed by this sprint, and deliberately

`student_guardians` for Student 1 carries CNIC
`31111111111111111111111111111111` — 32 digits, a value `normalizeCnic` cannot
produce. Under CLAUDE.md's sibling rule that is a family split in two on the
sibling lookup and on the family voucher. Repairing it means **inventing a
national ID number**, which is the school's to correct and nobody else's. It is
recorded here so the next person finds it rather than rediscovering it.

---

## How to apply it

`npm run db:migrate` is the documented route and **has not worked since Sprint
18**: `DATABASE_URL` in `.env.local` holds unescaped literal `@` characters in
the password, and `npx drizzle-kit migrate` hung on it for five minutes and
applied nothing (§5bg). `0034` through `0036` all went in through drizzle-orm's
own `postgres-js` migrator instead — same statements, same
`drizzle.__drizzle_migrations` bookkeeping — against the **pooler host on port
5432** (session mode; 6543 is transaction mode and will not do DDL, and the
direct `db.<ref>.supabase.co` host is IPv6-only, §5c).

Expect the bookkeeping table to gain the entry stamped `1788264000000`. If
`0037` has not been applied yet, it goes in first by number; the two do not
interact.

### If step 3 refuses to build

`CREATE UNIQUE INDEX` failing with `23505` means steps 1 and 2 missed a
duplicate — two members of staff genuinely sharing an inbox, say, which this
migration knows nothing about and must not guess at. The whole file rolls back,
so nothing is half-repaired. **Do not weaken the index to get past it.** Find
them, decide with the school which is which, and re-run:

```sql
SELECT location_id, lower(email), count(*), array_agg(id ORDER BY created_at)
  FROM school_users
 WHERE email IS NOT NULL AND email <> '' AND is_active
 GROUP BY 1, 2 HAVING count(*) > 1;
```

`npm run check-sprint21` predicts this before the migration is applied: it
simulates step 2's predicate and asserts that nothing survives it. Run it first
and step 3 will not surprise anybody.

## Verifying it

```sql
-- 1. the index exists, by name and with its WHERE clause
SELECT indexname, indexdef FROM pg_indexes
 WHERE tablename = 'school_users'
   AND indexname = 'school_users_location_email_active_idx';
-- CREATE UNIQUE INDEX … ON public.school_users USING btree (location_id, lower(email))
--   WHERE ((email IS NOT NULL) AND (email <> ''::text) AND is_active)

-- 2. nothing it repairs is left
SELECT count(*) FROM (
  SELECT 1 FROM school_users
   WHERE email IS NOT NULL AND email <> '' AND is_active
   GROUP BY location_id, lower(email) HAVING count(*) > 1) d;         -- 0

SELECT count(*) FROM student_guardians sg
  JOIN school_users su ON su.id = sg.school_user_id
 WHERE su.role = 'student';                                            -- 0

-- 3. Father 1's five guardian rows all point at his parent row
SELECT sg.school_user_id, count(*) FROM student_guardians sg
 WHERE sg.location_id = '21fad594-7996-4ad6-8117-3386972eb454'
   AND lower(sg.email) = 'dispatchglobally1+father1@gmail.com'
 GROUP BY 1;                                    -- one row: 2c329df7… | 5

-- 4. and the child's row is a child's row again
SELECT role, phone, email, auth_user_id FROM school_users
 WHERE id = '9ebacf91-76da-4216-bb35-aec7a229ef95';
-- student | student:LGS-2026-0001 | null | null

-- 5. the index actually refuses — inside a SAVEPOINT, per §5be
BEGIN;
  SAVEPOINT a;
    UPDATE school_users SET email = 'dispatchglobally1+father1@gmail.com'
     WHERE id = '<any other active row at LGS>';   -- 23505, …_location_email_active_idx
  ROLLBACK TO a;
ROLLBACK;
```

Assertion 5 must run inside a `SAVEPOINT`: a refusal aborts the whole
transaction otherwise and everything after it reports the *test's* failure
rather than the schema's. §5bh records that trap costing a re-run.

Then, and this is the acceptance test the sprint was opened for:

**Sign in at `lgs.schoolhub.codexmill.com` as `…+father1@gmail.com` using the
emailed code — not a saved password.** It must land in the **parent** portal
with five child cards, each showing its attendance and results panel. A password
sign-in will fail until the code has bound the account once, because step 2
cleared `auth_user_id` and only `otp/verify` writes it back.

## Rollback

```sql
DROP INDEX IF EXISTS "school_users_location_email_active_idx";
```

That is the only reversible part, and dropping it is safe with the Sprint 21
build serving — the code never reads the index, it only avoids provoking it.

**Steps 1 and 2 cannot be undone.** The guardian links and the addresses they
replaced are not recorded anywhere, and the auth binding they cleared cannot be
guessed. If they must be recoverable, take a copy first:

```sql
CREATE TABLE sprint21_backup_school_users AS
  SELECT id, phone, email, auth_user_id FROM school_users WHERE role = 'student';
CREATE TABLE sprint21_backup_guardians AS
  SELECT id, school_user_id FROM student_guardians;
```

Which is worth doing, and worth dropping again a fortnight later. Undoing the
repair would put a father back inside his daughter's account.
