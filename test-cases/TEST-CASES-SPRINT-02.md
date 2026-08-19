# Test cases — Sprint 2: The Super Admin panel

Traces to [`RELEASE-NOTES-SPRINT-02.md`](../release-notes/RELEASE-NOTES-SPRINT-02.md).
Migrations `0001`, `0002`.

**This panel changes settings for every school on the platform.** The note's
sharpest line is about that: "an operator returning from inside a school should
know it before changing a setting for forty schools." Cases 01 and 02 defend
that, and they are not cosmetic.

---

## The panel itself

#### UC-S02-01 · Super Admin signs in separately from every school — P1
**Role** Super Admin · **Traces to** "a separate `/super-admin` area with its own sign-in"
1. Sign in at `/super-admin/login`.
2. Try to reach `/super-admin` with only a *school* session.
- **Expect** the school session cannot reach the panel, and vice versa.
- **Fail** if a school administrator's session opens any Super Admin route.

#### UC-S02-02 · The panel does not look like a school portal — P2
**Role** Super Admin · **Traces to** "deliberately unlike a school portal so an operator always knows which they are looking at"
1. Open the panel, then a school portal via *Login as*, and compare at a glance.
- **Expect** visibly different chrome — not the same shell in a different colour.
- **Fail** if a screenshot of one could be mistaken for the other. This is the control that stops a setting for forty schools being changed by mistake.

---

## Schools

#### UC-S02-03 · Create, edit and list a school — P2
**Role** Super Admin · **Traces to** "Create a school, edit it, and list every school on the platform"
1. Create a school with name, slug, city and active flag. Edit it. Confirm it appears in the list.
- **Expect** all four fields persist and the list shows it. See the creation-fixes cases for the field-level rules added later.

#### UC-S02-04 · Deactivating closes a school without deleting it — P1
**Role** Super Admin · **Traces to** "deactivating one closes it without deleting anything"
1. Deactivate a school with data. Try to reach its portal.
2. Reactivate it.
- **Expect** the portal is closed while inactive; **every record survives**; reactivating restores access with the data intact.
- **Fail** if any row is removed. Deactivate is the reversible path — permanent deletion is a separate, later feature with its own typed confirmation.

#### UC-S02-05 · Sign in as a school lands in that school's portal — P1
**Role** Super Admin · **Traces to** "An operator can enter a school's own portal to see what its staff see"
1. Use *Login as* on a school.
- **Expect** the school's own portal, in its branding, showing that school's data only.
- **Fail** if any other school's data is reachable from the handed-off session.

#### UC-S02-06 · The hand-off account is synthetic and expected — P3
**Role** Super Admin, database · **Traces to** the creation-fixes note: "those synthetic addresses are real and are supposed to exist — they are the accounts behind the Super Admin's 'Login as Admin' hand-off, one per school"
1. After a hand-off, look for a `pa_…@…` account.
- **Expect** one per school, and **do not raise it**. An operator finding these and reporting them as junk is a documented false alarm.

---

## Modules

#### UC-S02-07 · A module that is off has no door to try — P1
**Role** School administrator · **Traces to** "the navigation entry is absent rather than hidden, so there is no door to try"
1. Switch a module off for a school. Sign in there.
2. Look for the navigation entry, then request the module's URL directly.
- **Expect** the entry is **absent**, and the direct URL is refused too.
- **Fail** if the link is merely hidden by CSS, or if the URL still serves. Either turns a commercial boundary into a suggestion.

#### UC-S02-08 · Every listed module area is switchable — P2
**Role** Super Admin · **Traces to** "admissions, fees, academics, HR and payroll, LMS, events, and the WhatsApp channel"
1. Toggle each in turn and confirm the school's navigation follows.
- **Expect** all of them behave as UC-S02-07.

#### UC-S02-09 · Bulk module changes do not clobber untouched flags — P1
**Role** Super Admin · **Traces to** "a three-state On / Off / Leave control so applying a change cannot clobber untouched flags"
1. Across several schools with differing module states, bulk-apply a change with one module set to **Leave**.
- **Expect** the Leave module is unchanged at every school, including those where it differs from the others.
- **Fail** if Leave writes a value. This is the entire reason the control has three states rather than a checkbox.

---

## Branding and integrations

#### UC-S02-10 · Branding applies across the school's portals — P2
**Role** Super Admin, then any school role · **Traces to** "A school's logo and colour palette, stored per school and applied across its portals"
1. Set a logo and palette. Open the admin, teacher, parent and student portals.
- **Expect** all four carry them. Sprint 10.5 took this much further — see those cases for the derived-token and contrast work.

#### UC-S02-11 · GHL settings are per school and optional — P2
**Role** Super Admin · **Traces to** "Per-school GoHighLevel connection settings", and `0013_ghl_becomes_optional.sql`
1. Open a school with no GHL connection and use the product normally.
- **Expect** everything works. A school "no longer needs GoHighLevel at all".
- **Fail** if any screen requires a connection or errors without one.

#### UC-S02-12 · Automatic subdomain provisioning reports its real state — P1 · **NEEDS PANEL**
**Role** Super Admin · **Traces to** "Automatic subdomain provisioning through the host's API (`0021`)"
1. Provision a subdomain for a new school and read the reported status.
- **Expect** the status matches reality in the hosting panel.
- **Fail** if it reports success for a name the panel calls "Not connected" — that exact defect is the subject of the SMTP-and-wildcard note, and its `wildcard-only` state is what a correct answer now looks like. Run those cases alongside this one.
