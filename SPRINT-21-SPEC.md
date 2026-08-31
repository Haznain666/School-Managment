# Sprint 21 — one email is one person, and the results page that never rendered

**Reported by the user, 2026-08-31.** Two symptoms, one screenshot:

1. *"Logged in as a parent, I could only see the information for my first child.
   This parent has 4 children enrolled at LGS Defence and their information is
   missing."*
2. *"There is an error on the My Results section"* — the screenshot shows
   `lgs.schoolhub.codexmill.com/student/results` rendering **Could not load this
   page**, inside the **Student Portal**, badged **Student 1**.

The screenshot is the diagnosis of symptom 1. **The parent was never in the
parent portal.** He signed in with his own address and the platform put him in
the *student* portal, as somebody else's child.

---

## What was actually found, against the live database

Everything below was established by executing the real queries against the live
schema, not by reading code.

### Finding A — `listPublishedTermsForStudent` cannot execute. Anywhere.

`lib/portal-results.ts:87` is a `SELECT DISTINCT` ordered by a column that is
not in its select list:

```ts
.selectDistinct({ termId, termName, academicYearId, academicYearName,
                  startDate, endDate, sequenceOrder })
// ...
.orderBy(desc(academicYears.startYear), desc(examTerms.sequenceOrder));
```

`academic_years.start_year` is ordered by and never selected. Postgres refuses
the statement outright:

```
42P10  for SELECT DISTINCT, ORDER BY expressions must appear in select list
```

Executed against LGS for **six of six** students: six failures, no exceptions.
This is not a data condition. The statement has never run at any school.

It has three callers, and it takes all three down:

| Caller | Effect |
| --- | --- |
| `app/(student)/student/results/page.tsx` | the 500 in the screenshot |
| `app/(parent)/parent/results/page.tsx` | the same 500, parent side |
| `getChildSnapshot` (`lib/portal-dashboard.ts:415`) | every child card on the parent dashboard loses its attendance and results panel |

The third is why a parent who *does* reach the parent portal finds their
children's "information missing": `settle()` catches the throw per child, so the
page renders with each card's snapshot half blank and nothing says why.

**Why nine green gates could not see it.** `npm run check-portals` *does* call
`listPublishedTermsForStudent`, at line 298, with the `NOBODY` tenant — and the
function returns `[]` at its own `enrolments.length === 0` guard **before** it
reaches the DISTINCT statement. The check has been reporting a pass on a
statement it has never once handed to Postgres. This is precisely the trap
CLAUDE.md names in *"And if your sprint adds or widens a query, execute it"*:

> a read that short-circuits before it reaches the new column must be reported
> as *not exercised* rather than passed, or a broken statement hides behind an
> early return.

It is now the second defect that trap has shipped.

### Finding B — one email, two membership rows, and the parent locked out

`school_users` at LGS:

| name | role | phone | email | auth_user_id |
| --- | --- | --- | --- | --- |
| Student 1 | `student` | `+923213124545` | `…+father1@gmail.com` | `c07f75d0…` |
| Father 1 | `parent` | `+923001234156` | `…+father1@gmail.com` | **null** |

And `student_guardians` for Student 1 carries `school_user_id = 9ebacf91…` —
**Student 1's own directory row**. The guardian is linked to the child.

The sequence, reconstructed from the timestamps:

1. Student 1 was enrolled on 2026-08-19, when `studentDirectoryPhone` still
   borrowed the primary guardian's mobile. The child's `school_users.phone`
   became `+923213124545` — the father's.
2. Parent-portal provisioning upserts on `(location_id, phone)`. On 2026-08-20
   it therefore landed on **the child's row**, wrote the father's email onto it,
   and pointed the guardian link at it.
3. The father accepted his invite. GoTrue bound auth uid `c07f75d0…` to that
   row, role `student`.
4. `school_users_location_id_auth_user_id_idx` is unique per school, so his uid
   can never also sit on his own `parent` row. **He is permanently in the
   student portal.**

The forward fix for step 1 shipped — `studentDirectoryPhone` is now the
unconditional `student:<admission number>` sentinel, and `lib/enrollment.ts:569`
describes this exact failure in the past tense. **The rows it had already
created were never repaired, and nothing stops step 2 recurring on them.**

The blast radius at LGS: Father 1 has **five** children — Student 1, 2, 3, 5 and
11 — all five guardian rows correct, four of them linked to the right parent row
and reachable only by a login he cannot get to.

### Finding C — nothing forbids the ambiguity

There is no unique index on `(location_id, email)`. Two active memberships of
one school may share an address, and every sign-in path then resolves the
person's row arbitrarily:

* `app/api/school/auth/otp/verify/route.ts:60` updates **every** matching row
  and takes whichever the unique auth index happens to allow;
* `getSchoolUserByUid` (`lib/school-queries.ts:496`) is `.limit(1)` with **no
  `orderBy`** — an unordered limit on a set that is only ever ambiguous when
  something is already wrong.

### Reported, not fixed by this sprint

Student 1's guardian row holds CNIC `31111111111111111111111111111111` — 32
digits, a value `normalizeCnic` cannot produce. Under the sibling rule in
CLAUDE.md that is a family split in two on the sibling lookup. Repairing it
means inventing a national ID number, which is the school's to correct. It is
written up here so the next person finds it.

---

## The work

### Item 1 — make the statement executable  *(blocking, every school)*

`lib/portal-results.ts`. Put `academicYears.startYear` in the select list so the
`ORDER BY` is legal, and keep the ordering exactly as it is — the docblock's
reason for ordering by year and sequence rather than by start date still holds.
The extra column must not leak into `StudentTermRow`'s public shape if that
would change a caller; drop it in the `map` if so.

Then re-run it against LGS for a student who has a published term **and** one
who has none, and prove it returns rows rather than throwing.

### Item 2 — a guardian is never linked to a child's directory row

Two guards, both in code:

* `lib/parent-portal-access.ts` — the `onConflictDoUpdate` on
  `(location_id, phone)` must not be allowed to land on a `role = 'student'`
  row. Resolve the conflicting row first; if it is a student's, refuse in words
  (`ProvisionResult.reason`) rather than writing. Never throw: every caller has
  already committed an admission or a payment.
* `lib/enrollment.ts` — `userIdByPhone` links a new guardian to any existing
  `school_users` row on that phone. Exclude `role = 'student'` from that lookup.
  A child is not their own guardian.

### Item 3 — repair the rows that already exist  *(migration `0038`)*

Written generally, not for LGS. In one transaction:

1. Every `student_guardians.school_user_id` pointing at a `role = 'student'`
   row → re-point to the `role = 'parent'` row at the same school with the same
   `lower(email)`, and `NULL` where there is no such row. **A wrong link is
   worse than no link**: it is a family reading somebody else's fees.
2. Every `role = 'student'` `school_users` row whose `phone` is not the
   `student:` sentinel **and** whose phone or email matches a
   `student_guardians` contact detail → phone becomes
   `'student:' || student_profiles.student_id`, `email` becomes `NULL`,
   `auth_user_id` becomes `NULL`.

   Unbinding the uid is the point. It is what lets the father's next sign-in
   bind to his own parent row.
3. Only then, the constraint: a partial unique index on
   `(location_id, lower(email))` `WHERE email IS NOT NULL AND email <> '' AND
   is_active`. Partial and active-scoped so a deactivated leaver cannot block a
   returning one.

Step 3 will refuse to build if steps 1–2 missed a duplicate, which is the
migration telling you the truth rather than the constraint arriving broken.
`SPRINT-21-DDL-NOTES.md` beside it, in the shape of `SPRINT-20-DDL-NOTES.md`.

### Item 4 — sign-in stops resolving ambiguity silently

* `otp/verify` — bind exactly one row. Where more than one active row at the
  school carries the address, bind none and sign the session out, exactly as the
  existing `bound.length === 0` path does. After Item 3 this is unreachable; it
  is here so that if it ever becomes reachable again nobody is quietly seated in
  the wrong portal.
* `getSchoolUserByUid` — give the `.limit(1)` a deterministic `orderBy`.
* `provisionGuardianPortalAccess` — detect an existing active row on the same
  `(location, lower(email))` that is not the one being upserted, and report it
  in words. The school must never meet a `23505`.

### Item 5 — `npm run check-sprint21`, and it must prove the statement was reached

Copy `scripts/check-sprint20.ts`. Every statement this sprint touches, executed
against the real schema. Two things it must do that `check-portals` did not:

* run the portal reads against a tenant and a student that **exist**, so no
  early return can stand in for a pass — a run that does not reach the statement
  must report **not exercised**, and that is a failure;
* assert the new unique index by name from `pg_indexes`, and assert that
  `SELECT` finds no `(location_id, lower(email))` duplicate among active rows.

Read whether `0038` is applied rather than being told, so one command works on
both sides of it. The SQLSTATE is on the error's `cause`, not on the error.

### Item 6 — `check-portals` stops lying

The pass at line 298 was false for as long as it has existed. Every entry in
that script that can short-circuit before its statement must say **not
exercised** rather than **ok**. That is a change to what a caught early return
reports, and it is the only reason this sprint exists.

---

## Acceptance

* `/student/results` and `/parent/results` render at LGS for a student with a
  published term and for one without.
* The parent dashboard shows five child cards for Father 1, each with its
  attendance and results panel populated rather than blank.
* After `0038`, signing in with `…+father1@gmail.com` at LGS reaches the
  **parent** portal.
* No `(location_id, lower(email))` duplicate survives among active rows at
  either school, and the index refuses a new one.
* Sixteen gates green plus `npm run check-sprint21`, including `npm run build`.
