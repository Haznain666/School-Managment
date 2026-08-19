# Test cases — Sprint 8: Roles & permissions

Traces to [`RELEASE-NOTES-SPRINT-08.md`](../release-notes/RELEASE-NOTES-SPRINT-08.md).
Migration `0010_sprint8_roles_permissions.sql`.

**Test every permission at the route, never at the button.** A hidden button is
not a permission; the note's whole design is that grants are checked where the
data is served. Every case below that says "attempt the action" means *post the
request directly* as well as clicking.

**The override design is why this sprint's cases are still live.** The table
stores a school's *departures* from the default, not every grant — which is what
lets Sprints 9, 10 and 11 add permission keys that work at every existing school
on the day they ship. UC-S08-07 is the regression test for that, and it should
be run **every time a sprint adds a permission key**.

---

## The matrix

#### UC-S08-01 · Every role and every permission appears, grouped by module — P2
**Role** School administrator · **Traces to** "every role down one axis, every permission down the other, grouped by module"
1. Open `/dashboard/settings/permissions`.
- **Expect** all eleven roles and every defined key, grouped.
- **Fail** if a key added by a later sprint (`exams.*`, `students.import`, `comms.*`) is missing — the constraint is generated from the code, so an absent key means the two have drifted.

#### UC-S08-02 · Granting a permission takes effect — P1
**Role** School administrator, then the granted role · **Traces to** "What a school controls is which of its roles hold which of the defined permissions"
1. Grant a coordinator `fees.read`. Sign in as them.
- **Expect** the fee screens open.
2. Revoke it and repeat.
- **Expect** refused, at the route as well as the screen.

#### UC-S08-03 · A school cannot invent a permission — P1
**Role** School administrator · **Traces to** "A school cannot invent a permission — one that no route checks would read on screen as a guarantee and enforce nothing"
1. Attempt to create a permission key not defined in code, through the screen and by posting directly.
- **Expect** refused. The database CHECK constraint should also refuse it.
- **Fail** if an arbitrary key is stored — it would display as a guarantee and gate nothing.

#### UC-S08-04 · A school administrator always keeps `permissions.manage` — P1
**Role** School administrator · **Traces to** "One rule cannot be configured away… an administrator could revoke their own ability to manage permissions and leave the school with no way back short of a support ticket"
1. Try to revoke `permissions.manage` from the school administrator role — on screen, and by posting directly.
- **Expect** refused both ways.
- **Fail** if the API allows what the screen prevents. This is the one lockout with no recovery path inside the product.

#### UC-S08-05 · Students and parents are not configurable — P2
**Role** School administrator · **Traces to** "Nothing they reach is permission-gated — their portals answer by identity, not by permission — so a toggle against them would be a control that does nothing"
1. Look for student and parent columns in the matrix.
- **Expect** absent, or plainly non-configurable.
- **Fail** if a toggle exists — "the worst kind to put in front of an administrator", because switching it changes nothing.

---

## The override design

#### UC-S08-06 · A school's customisation survives a default change — P1
**Role** School administrator · **Traces to** "The table stores a school's *departures* from the default"
1. At school A, customise one role's grants. Leave school B untouched.
2. Confirm the stored rows describe only the departures, not every grant.
- **Expect** A keeps its customisation; B follows the defaults.

#### UC-S08-07 · A newly added permission key works everywhere on day one — P1 · **NEEDS TENANCY**
**Role** School administrator, several schools · **Traces to** "This is why every sprint since has been able to add permission keys… and have them work at every existing school on the day they ship, without a data migration"
1. After any release adding a key, open several schools — including one that has customised its matrix.
2. Confirm the new key is present with its intended default holders at all of them.
- **Expect** the feature is reachable at every school immediately.
- **Fail** if it "arrives granted to nobody" — "the feature ships and no one can see it" is the exact failure the override design exists to prevent, and it is silent.

#### UC-S08-08 · The permission CHECK constraint matches the code — P1 · **AUTOMATED**
**Role** Operator, database · **Traces to** "The database constraint that lists valid permission keys is generated from the code, so a sprint that adds one also alters that constraint"
1. Compare the constraint's accepted values against the keys defined in code.
- **Expect** identical sets. Sprints 11 and 13 both record verifying exactly this after their migrations.
- **Fail** on any key in one and not the other.

---

## The permission split that the modules depend on

#### UC-S08-09 · A teacher enters marks and cannot publish them — P1
**Role** Teacher · **Traces to** Sprint 9: "a teacher holding `results.enter` and not `results.publish` by default, which is the whole marks-entry design"
1. As a teacher, save and submit marks. Attempt to publish.
- **Expect** submit works, publish is refused.
- **Fail** if a teacher can publish by default. Full coverage in the Sprint 9 cases.

#### UC-S08-10 · Writing and sending an announcement are separate — P1
**Role** Coordinator, then principal · **Traces to** Sprint 11: "so a coordinator or the marketing staff can prepare a notice that a head releases"
1. As a coordinator, write and schedule. Attempt to send.
- **Expect** write succeeds, send refused; a principal can send it.

#### UC-S08-11 · The narrow roll-management keys are narrower than "enrol" — P1
**Role** Branch administrator · **Traces to** Sprint 10: "`students.import`, `students.promote`, `students.transfer` — each deliberately narrower than 'enrol a student'"
1. As a role that may enrol one student, attempt import, promote and transfer.
- **Expect** all three refused unless separately granted.
- **Fail** if enrolment implies any of them — "loading a whole school is an operation, and one bad column mapping writes every one of them wrong."

#### UC-S08-12 · Reports are gated by the permission governing their source screen — P1
**Role** Accountant, then coordinator · **Traces to** Sprint 12: "There is **no new permission to configure**… an accountant opens the four financial reports and nothing else"
1. As an accountant, open the reports index. Then as a coordinator.
- **Expect** each sees only their own; the index lists only what they may open.
- **Fail** if the index advertises a report that then refuses — that is a door to try, which Sprint 2 rejected explicitly.

---

## Not in this release

- **Per-record or per-campus permissions.** Campus scoping "is done by the
  queries themselves, not by a grant" — test it as a query property (Sprint 1,
  Sprint 12), not as a permission.
- **Any audit of who changed a permission and when.**
- **A twelfth `school_administrator` role** was proposed and declined on purpose.
