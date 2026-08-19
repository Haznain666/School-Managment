# Test cases — Sprint 1: Foundation & multi-tenancy

Traces to [`RELEASE-NOTES-SPRINT-01.md`](../release-notes/RELEASE-NOTES-SPRINT-01.md).
Migration `0000_initial_schema.sql`.

**This sprint created no screen a head teacher would recognise**, so its cases
are structural rather than journeys. They are also the **highest-value cases in
the whole suite**: tenancy is the one property whose failure is not a bug report
but an incident. A school seeing another school's children is the end of a
pilot.

**Test these on every release, not on this one.** Tenancy is enforced "in each
query rather than by a database feature", which means it is re-implemented every
time somebody writes a query. There is no single place to check it and no
database constraint catching a miss.

---

## Tenancy

#### UC-S01-01 · No screen shows another school's data — P1 · **NEEDS TENANCY**
**Role** School administrator · **Traces to** "a school's records cannot appear in another school's screens"
1. With two schools each holding students, staff, fees and announcements, sign in to school A as an administrator.
2. Walk every list screen: students, staff, users, challans, exams, announcements, reports.
- **Expect** only school A's records, and counts matching school A alone.
- **Fail** on a single row belonging to B. Check totals and counts too — a leak often shows first in an aggregate that was written without the tenant filter while the list beside it has one.

#### UC-S01-02 · An ID from another school is refused, not rendered — P1 · **NEEDS TENANCY**
**Role** School administrator · **Traces to** the same
1. Note a student ID, challan ID and exam ID belonging to school B.
2. Signed in to school A, request each detail URL directly.
- **Expect** not-found or refused for all three.
- **Fail** if any renders. A list filtered correctly whose detail route is not is the common shape of this defect — the screen looks right and the URL is the hole.

#### UC-S01-03 · Cross-tenant writes are refused — P1 · **NEEDS TENANCY**
**Role** School administrator · **Traces to** the same
1. Signed in to A, POST/PATCH against a B-owned record ID on each write route you can reach.
- **Expect** refused.
- **Fail** if a write lands. Verify in the database, not by the response code.

#### UC-S01-04 · Every table carries `location_id` — P1 · **AUTOMATED-ish**
**Role** Operator, database · **Traces to** "Every table from this point on carries a `location_id`"
1. List tables holding tenant data and confirm each has `location_id`, and that it is indexed.
- **Expect** present and indexed on all of them. Sprint 9's note records doing exactly this check for its own six tables — "`location_id` on all six and indexed".
- **Fail** on any tenant-scoped table without it; that table cannot be filtered and is a leak waiting for its first query.

---

## Reaching a school

#### UC-S01-05 · A school is found by its subdomain — P1
**Role** Anonymous · **Traces to** "A school is found by subdomain"
1. Open `<slug>.<apex>/login` for a real school.
- **Expect** that school's own branded login.

#### UC-S01-06 · The `?school=` fallback works where subdomains do not — P2
**Role** Anonymous · **Traces to** "with a `?school=` parameter and a cookie as the fallback path"
1. On localhost or a bare deployment host, open `/login?school=<slug>`.
- **Expect** the same school resolves. This is the path the panel chooser relies on off the platform domain.

#### UC-S01-07 · An unknown school lands on `/school-not-found` — P2
**Role** Anonymous · **Traces to** the subdomain resolution path
1. Open a subdomain and a `?school=` value that exist nowhere.
- **Expect** `/school-not-found` both times — "a wrong guess lands on `/school-not-found`, exactly as a wrong guess at any URL already does".
- **Fail** if the error distinguishes "no such school" from "school exists but is inactive"; that discloses the customer list.

---

## Campuses

#### UC-S01-08 · A branch carries name, code, city and address — P2
**Role** Super Admin · **Traces to** "`branches` — a school with more than one campus, each with its own name, code, city and address"
1. Create a branch with all four. Reopen it.
- **Expect** all four persisted. See the creation-fixes cases for the ordering and masking rules that came later.

#### UC-S01-09 · Campus scoping reaches staff, students, fees and announcements — P1 · **NEEDS SEED**
**Role** Branch administrator · **Traces to** "Later sprints scope staff, students, fees and announcements to a campus through this table"
1. As a branch administrator at campus 1 of a two-campus school, open students, staff, fees and announcements.
- **Expect** only campus 1 in all four.
- **Fail** if any one of the four is school-wide. This is a per-module property and each module implements it separately.

---

## Do not test these — they were reversed

The note is explicit that two foundations "did not survive contact with the rest
of the product". Writing cases against them wastes a tester's day:

- **`school_subdomains` was dropped** in `0002`, one sprint later. Subdomain
  handling lives on the school record.
- **GoHighLevel is no longer the tenant key.** `0013_ghl_becomes_optional.sql`
  reversed it — "the single largest reversal in the project's history". A school
  needs no GHL sub-account. Any case assuming one is testing a 2025 design.
- **Authentication was rebuilt twice** — Firebase, then Supabase. Test
  `lib/school-auth.ts` behaviour, not this sprint's.
