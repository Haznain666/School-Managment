# Release notes — Sprint 1: Foundation & multi-tenancy

**Status:** shipped. Migration `0000_initial_schema.sql`, applied.

> Reconstructed after the fact from the migration and the code. See
> [how these were written](README.md#how-these-were-written).

The first sprint laid the ground every later one stands on: one application
serving many schools, with each school's data separated by a tenant key that
every query carries.

---

## What it established

**One database, many schools.** Every table from this point on carries a
`location_id` — the school's own identifier — and every query filters on it.
That decision is why a school's records cannot appear in another school's
screens, and it is enforced in each query rather than by a database feature, so
it is visible in the code that reads the data.

**Schools reached by their own address.** A school is found by subdomain, with a
`?school=` parameter and a cookie as the fallback path.

**Campuses.** `branches` — a school with more than one campus, each with its own
name, code, city and address. Later sprints scope staff, students, fees and
announcements to a campus through this table.

**The first shape of people and records.** `users`, `user_roles`, `students` and
`staff` were introduced here.

**GoHighLevel token storage** (`ghl_tokens`), for the CRM integration the
product was originally built around.

---

## What later sprints changed about this

Two foundations from this sprint did not survive contact with the rest of the
product, and it matters when reading the code today:

- **`school_subdomains` was dropped** in `0002`, one sprint later. Subdomain
  handling moved onto the school record itself.
- **GoHighLevel stopped being the tenant key.** Sprint 1 assumed every school
  *was* a GHL sub-account. `0013_ghl_becomes_optional.sql` reversed that: a
  school no longer needs GoHighLevel at all, and the integration is opt-in per
  school. This is the single largest reversal in the project's history and it
  reaches into fees, communications and onboarding.
- **Authentication was rebuilt entirely** — Firebase, then Supabase Auth. See
  the note on Sprint 3.

---

## Not in this release

Everything a school actually does. This sprint created no screen a head teacher
would recognise; it made the next ten sprints possible.
