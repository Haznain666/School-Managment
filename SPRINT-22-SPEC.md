# Sprint 22 — one person, one record

**The gap.** A member of staff can exist twice in this product and the two
halves never meet.

| Screen | Writes | Answers |
| --- | --- | --- |
| Users & Staff → Invite Staff | `school_users` | who may sign in, as what role |
| HR → Staff → Add staff member | `staff` | who works here, and what payroll pays them |

`staff.school_user_id` is the column that joins them. It exists, it is indexed
(`staff_school_user_id_idx`), the POST and PATCH routes accept it — and **no
screen in the product ever sets it**. `listUnlinkedSchoolUsers()` in
`lib/hr-queries.ts:222` was written "for the link picker" and is called by
nothing.

**Why it matters, concretely.** A teacher needs *both* rows:

- `timetable_entries.teacher_id` → `school_users` — no login, no periods.
- `sections.class_teacher_id` → `staff` — no employment record, cannot be a
  class teacher.

So a school that invites a teacher from Users & Staff gets someone who can be
timetabled and can never be a home-room teacher, and a school that adds one
from HR gets the reverse. Nothing on either screen says so.

**No migration.** Everything below is built on the existing column. There is no
`0039`, nothing to apply to the live database, and the deploy has no ordering
hazard.

---

## 1. HR → Staff → Add staff member gains portal access

`components/hr/StaffManager.tsx`. A **Portal access** fieldset at the foot of
the create form, three mutually exclusive choices, default the first:

| Choice | Fields it reveals |
| --- | --- |
| **No login needed** (default) | none |
| **Create a login** | Role (`INVITABLE_ROLES`), Branch (when `BRANCH_REQUIRED_ROLES`) |
| **Link an existing account** | a picker fed by `listUnlinkedSchoolUsers` |

"No login needed" is the default and stays the default. A driver is on the
payroll and never signs in; the form must not imply otherwise.

**Create a login** reuses the staff form's own Email and Phone fields — do not
add a second pair. Both become required in that mode, with the reason stated
on screen: the address is the identity Supabase keys the account by, and
`school_users.phone` is `NOT NULL` and unique per school.

The login is created through **exactly the same path** as
`POST /api/school/invitations`: a `school_users` row plus `queueAccessEmail`.
Do not write `school_invitations`; nothing has written to it since Sprint 17.

**Report the mail, never assume it.** Carry `queueAccessEmail`'s own
`{ queued: true | false, reason }` back to the form and render it, the way
`InviteForm` already does. "Staff member added" over a message nobody queued is
the failure that shape exists to prevent.

### Ordering, and what must not be left behind

The employment record is the point of this screen. So:

1. Insert the `staff` row.
2. Then create or link the account and `UPDATE staff SET school_user_id`.

If step 2 fails, **the staff row stays** and the response says the employment
record was saved but the login was not, with the reason and a pointer to the
link picker. A person recorded is a fact; a login that did not go out is one
click from the profile. This is the same stance `enrollStudent` takes over the
sibling auto-grant (STATE.md §5bj).

## 2. Users & Staff → Invite Staff gains an employment record

`components/school/InviteForm.tsx`. A checkbox — **"Also add an employment
record"**, default **on** for every `INVITABLE_ROLES` role, since all nine are
staff — revealing Employee code, Designation, Department, Joining date.

**Employee code** is `NOT NULL` and unique per school with no generator. Add
`GET /api/school/hr/staff/next-code`, which reads the highest existing
`EMP-<n>` for the tenant and answers the next one. Pre-fill the field with it
and let it be edited. A collision is a `23505` on
`staff_location_id_employee_code_idx`: catch it and say *that code is taken*,
naming the field. Do not swallow it.

Same ordering rule, other way round: the account is this screen's point, so the
account is created first and the employment record second. A failed employment
insert leaves the account and says so.

**Permissions.** This is one screen crossing two permission keys. Creating a
login from HR requires `users.write` *in addition to* `hr.write`; creating an
employment record from Invite requires `hr.write` in addition to
`users.write`. A user holding only one of the two sees the other section
absent, not disabled-and-mysterious. Enforce it on the server, not only in the
component.

## 3. Linking records that are already split

`components/hr/StaffDetailPanel.tsx` grows a **Portal access** row:

- linked → the account's name, role and branch, and a link to
  `/dashboard/users/<id>`, plus **Unlink**.
- not linked → **Link an existing account** (the picker) and **Create a login**.

`components/school/UserDetailPanel.tsx` grows the mirror: the employment record
and a link to `/dashboard/hr/staff/<id>`, or **Add an employment record**.

## 4. Saying so when a half is missing (warn, never block)

Neither screen may refuse to save. Both must say what is missing.

- **HR staff list and detail** — a badge on any `active` staff row with
  `school_user_id IS NULL`: *No login*. On a row whose `is_class_teacher` is
  set, the detail panel adds the consequence: *cannot be assigned periods
  without a portal login.*
- **Users & Staff list and detail** — a badge on any active member whose role
  is in `INVITABLE_ROLES` and who backs no `staff` row: *No employment
  record*. For `teacher`, the detail panel adds: *cannot be made a class
  teacher without an employment record.*

Badges are advisory. Nothing about them changes what any existing screen
permits.

## 5. Finding the ones already split

An **Unlinked** filter on the HR staff list (`?linked=none`) and on
`UserTable` (`?employment=none`), each defaulting to off. This is what a school
uses to reconcile the records it already has, and it is the only part of this
sprint that helps schools live today.

## 6. One live defect on the screen this sprint touches — fix it here

`POST /api/school/invitations` never received Sprint 21's fix. It still calls
`.onConflictDoNothing()` **untargeted**, so `0038`'s partial unique index on
`lower(email)` is swallowed alongside the phone index and reported as
*"Someone with that phone number already exists at this school"* — about a
number nobody holds, with nothing on the form to correct.

`POST /api/school/users` has the correct shape at lines 188–236: `emailHolderAt`
pre-check for the sentence, `onConflictDoNothing({ target: [locationId, phone] })`
so only the phone collision is swallowed, and `isEmailIndexConflict` in the
catch so the race still gets a sentence. Give `/api/school/invitations` the
same three, and the same for the new login-creating path in §1.

---

## Acceptance

1. HR → Add staff member with **No login needed** behaves exactly as it does
   today. No new required field, no new request.
2. HR → Add staff member with **Create a login** produces one `staff` row and
   one `school_users` row, joined by `school_user_id`, and the form states
   whether the set-password mail was queued.
3. Invite Staff with the checkbox on produces both rows, joined.
4. Invite Staff with the checkbox off behaves exactly as today.
5. A staff record with no account offers **Link an existing account**; picking
   one sets `school_user_id` and the badge disappears from both screens.
6. **Unlink** clears the column and the badges return.
7. The two **Unlinked** filters return exactly the split records.
8. Inviting a member on a colleague's email address is refused with a sentence
   naming the *address*, and the phone message never appears for it.
9. No `staff` row is ever created twice for one `school_users` row through any
   path added here.
10. Every gate in CLAUDE.md's green build passes, plus `check-portals`.
