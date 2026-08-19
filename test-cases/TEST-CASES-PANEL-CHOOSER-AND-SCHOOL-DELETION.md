# Test cases — Panel chooser, school deletion, address autocomplete

Traces to [`RELEASE-NOTES-PANEL-CHOOSER-AND-SCHOOL-DELETION.md`](../release-notes/RELEASE-NOTES-PANEL-CHOOSER-AND-SCHOOL-DELETION.md).
No migration.

**School deletion is the most destructive action in this product.** One statement
cascades 61 foreign keys and takes the branches, students, staff, enrolments,
challans, payments, exams, results, payroll and announcements with it.

> **Use a throwaway school for every deletion case, and never an existing
> tenant.** That is how the release itself was verified — a `QA Delete Probe`
> created for the purpose. Six real schools were deleted on the estate on
> 2026-08-19 and are not coming back.

---

## Deleting a school

#### UC-PCD-01 · Deactivate remains the default, unmarked path — P1
**Role** Super Admin · **Traces to** "**Deactivate remains the default and the unmarked path.** It is what an operator wants almost every time… and it is reversible with one press"
1. Open the Schools table.
- **Expect** Deactivate is visually the ordinary action and Delete is visually the exceptional one.
- **Fail** if they read as equivalent, or if Delete sits where a tired operator's muscle memory lands.

#### UC-PCD-02 · The confirmation is the school's own typed name — P1
**Role** Super Admin · **Traces to** "typing the name cannot be done absent-mindedly, and — the part that matters — cannot be done at all against the wrong row"
1. On a throwaway school, open the dialog and confirm the button is **disabled** until the typed name matches exactly.
2. Submit with a wrong name.
- **Expect** `400 confirmation_required`, school untouched.
3. Submit with the correct name.
- **Expect** `200`, deleted.
- **Fail** if the server accepts a wrong name — the check must hold "on the server as well as in the dialog".

#### UC-PCD-03 · The dialog names what is about to go — P2
**Role** Super Admin · **Traces to** "in specifics rather than 'this cannot be undone', which is a sentence people have learned to click past"
1. Read the dialog.
- **Expect** specifics — branches, students, staff, fees, results.

#### UC-PCD-04 · The cascade leaves no orphans — P1
**Role** Super Admin, database · **Traces to** "All 61 foreign keys… are `ON DELETE CASCADE` — verified against the schema, not assumed"
1. Delete a throwaway school that has branches, users and modules.
2. Count orphans in each, and count the other schools before and after.
- **Expect** 0, 0, 0 orphans; every other school intact.

#### UC-PCD-05 · Supabase accounts are released — but only for members of no other school — P1 · **NEEDS TENANCY**
**Role** Super Admin · **Traces to** "a parent with children at two schools must not be locked out of the second because the first was deleted. This had to be done *before* the delete, because afterwards there is no row left saying which addresses belonged to the tenant"
1. Give a throwaway school a member who is **also** a member elsewhere, and one who is not.
2. Delete the school. Sign in as the dual member at the other school.
- **Expect** the sole member's account is released; the dual member signs in unaffected.
- **Fail** either way. Both failure modes are silent.

#### UC-PCD-06 · Deletion requires the permanent flag — P1
**Role** Super Admin · **Traces to** "The route now takes `?permanent=true`"
1. Call DELETE without the flag.
- **Expect** deactivation, not deletion — the previous behaviour is preserved as the default.

---

## The panel chooser

#### UC-PCD-07 · The apex offers the two things that can be done there — P2
**Role** Anonymous · **Traces to** "Anyone arriving at the apex — which is what people type — reached a dead end"
1. Open the apex domain.
- **Expect** a school route and a Super Admin sign-in.

#### UC-PCD-08 · "Go to my school" reaches the school's own branded login — P1
**Role** Anonymous · **Traces to** the verification: "'Go to my school' → `abc-demo` → the school's own branded ABC Demo login"
1. Type a valid slug.
- **Expect** on the platform domain the browser travels to `<slug>.<apex>/login`; elsewhere (localhost, a bare host) it uses `/login?school=<slug>`.

#### UC-PCD-09 · A bogus slug lands on `/school-not-found` — P1
**Role** Anonymous · **Traces to** "a wrong guess lands on `/school-not-found`, exactly as a wrong guess at any URL already does"
1. Type a slug that does not exist.
- **Expect** `/school-not-found`, disclosing nothing about which schools exist.

#### UC-PCD-10 · The school is typed, never picked from a list — P1
**Role** Anonymous · **Traces to** "A dropdown of every school would serve the customer list to anyone who loads the front page"
1. Look for any list, dropdown or autocomplete of schools.
- **Expect** none. **Fail** if any endpoint behind this page enumerates schools.

#### UC-PCD-11 · Roles are listed, not offered as sign-in buttons — P2
**Role** Anonymous · **Traces to** "**It does not offer eleven role buttons.** There are not eleven sign-in panels… a menu of roles would be a menu of decisions that do not exist"
1. Read the page.
- **Expect** roles named so a visitor recognises their own panel, with **one** school sign-in route.
- **Fail** if picking a role changes where sign-in goes.

#### UC-PCD-12 · A school user cannot sign in on the apex — P1
**Role** School user · **Traces to** "credentials are per-tenant, resolved from the hostname by middleware, so a school user cannot sign in on the apex at all"
1. Try school credentials at the apex.
- **Expect** refused. Super Admin is the documented exception.

---

## Address autocomplete

> **Superseded.** This release replaced the map picker with Google Place
> Autocomplete; the address field is now **Mapbox**. Test via
> [the address-and-phone cases](TEST-CASES-ADDRESS-AND-PHONE-FIELDS.md).
> Three principles from this note survived the change and are still worth
> asserting:

#### UC-PCD-13 · The address is free text that autocomplete merely fills — P1
**Traces to** "Plenty of Pakistani school addresses — a block and a sector, a landmark, a lane with no name — are not what Places returns, and an operator must always be able to overrule it"
- Covered by UC-APF-11 and UC-APF-14.

#### UC-PCD-14 · Predictions are restricted to Pakistan — P2
**Traces to** "Unrestricted, 'Model Town, Lahore' competes with identically named places in three other countries, ordered by global traffic"
- Covered by UC-APF-13.

#### UC-PCD-15 · It degrades rather than breaking — P1
**Traces to** "With no key the field is the plain text input it has always been, plus one line saying why there is no search"
- Covered by UC-APF-15 and UC-APF-16. Note the old `gmpx-requesterror` mechanism
  is gone; the Mapbox equivalent is a surfaced fetch failure.

---

## One lesson worth keeping in the process

The note records a QA false alarm worth repeating to anyone running this suite:

> During QA the accessibility-tree reader showed no Delete button on any row, and
> the first conclusion was that it had not rendered. Querying the DOM directly
> found all nine. The tree view was eliding them; the application was correct.

**A UI absence reported by one tool is worth confirming with a second before it
is raised as a defect.** Applies to every `read_page`-style check in this suite.
