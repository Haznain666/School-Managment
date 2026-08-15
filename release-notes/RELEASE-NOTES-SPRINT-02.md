# Release notes — Sprint 2: The Super Admin panel

**Status:** shipped. Migrations `0001_sprint2_super_admin_tables.sql`,
`0002_sprint2_drop_school_subdomains.sql`, both applied.

> Reconstructed after the fact from the migrations and the screens. See
> [how these were written](README.md#how-these-were-written).

This is the panel the platform operator uses — not a school. It is where a
school is created, configured, branded, and switched on.

---

## What the operator gets

A separate `/super-admin` area with its own sign-in, deliberately unlike a
school portal so an operator always knows which they are looking at.

**Schools.** Create a school, edit it, and list every school on the platform.
A school carries its name, slug, city and active flag; deactivating one closes
it without deleting anything.

**Campuses.** Add and edit branches for any school.

**Modules** (`school_modules`). Every feature area is a switch per school —
admissions, fees, academics, HR and payroll, LMS, events, and the WhatsApp
channel. A school that has not bought a module does not see it: the navigation
entry is absent rather than hidden, so there is no door to try.

**Branding** (`school_branding`). A school's logo and colour palette, stored per
school and applied across its portals. Sprint 10.5 later took this much further
— see that note.

**Integrations.** Per-school GoHighLevel connection settings.

**Sign in as a school.** An operator can enter a school's own portal to see what
its staff see, which is how a support question gets answered without asking
somebody to read their screen out loud.

**Users.** The school's people, from the operator's side.

---

## Things worth knowing

- **The Super Admin panel is not a school role.** It is the platform operator,
  authenticated separately, and it is intentionally styled unlike a tenant
  portal — an operator returning from inside a school should know it before
  changing a setting for forty schools.
- **`school_subdomains` was dropped here**, one sprint after it was created;
  subdomain handling moved onto the school record.

---

## What later sprints added to this area

- **Bulk module management** across many schools at once, with a three-state
  On / Off / Leave control so applying a change cannot clobber untouched flags
  (2026-08-08).
- **Automatic subdomain provisioning** through the host's API (`0021`).
- **A module-adoption chart** on the panel's own dashboard (Sprint 10.5).
