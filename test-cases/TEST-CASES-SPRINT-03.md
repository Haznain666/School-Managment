# Test cases — Sprint 3: School users, invitations & sign-in

Traces to [`RELEASE-NOTES-SPRINT-03.md`](../release-notes/RELEASE-NOTES-SPRINT-03.md).
Migrations `0003`–`0005`.

**Half of this sprint has been rebuilt twice.** Firebase → Supabase Auth, and
WhatsApp OTP removed as a channel. Test the product's *current* answer to "who is
this and what school are they in" — `lib/school-auth.ts` — not this sprint's.
The cases below are written against what survived.

**One person, many schools, is the property that keeps breaking.** It is why
`auth_user_id` is deliberately not globally unique, why a deleted member's
Supabase account is only released once no other school holds the address, and
why a school deletion does not lock a parent out of their second school. Cases
04, 05 and 06 are all the same underlying rule seen from three directions.

---

## Membership

#### UC-S03-01 · One record per person per school — P1 · **NEEDS TENANCY**
**Role** School administrator at two schools · **Traces to** "The same person can belong to more than one school; the account is theirs, the membership is per school"
1. Invite the same email address as a teacher at school A and a parent at school B.
2. Accept both. Sign in to each.
- **Expect** both memberships exist, each with its own role, and each portal shows only its own school.
- **Fail** if the second invitation is refused as a duplicate, or if accepting the second overwrites the first's role.

#### UC-S03-02 · A member carries name, email, phone, role, campus, avatar, active — P2
**Role** School administrator · **Traces to** the `school_users` field list
1. Create a member with every field; reopen the record.
- **Expect** all persisted. Phone must obey the current mask — see the address-and-phone cases.

#### UC-S03-03 · Deactivating a member ends access without deleting them — P2
**Role** School administrator · **Traces to** "an active flag"
1. Deactivate a member. Try to sign in as them.
- **Expect** refused; the record survives and can be reactivated.

---

## Invitations

#### UC-S03-04 · Nobody's password is ever chosen for them — P1
**Role** School administrator, then invitee · **Traces to** "they set their own password… Nobody's password is ever chosen for them by an administrator"
1. Walk the whole invite flow and look for any screen offering to set or reveal a password.
- **Expect** none exists; the invitee sets their own.
- **Fail** if an administrator can set or read one.

#### UC-S03-05 · The address is registered with Supabase at creation — P1
**Role** School administrator · **Traces to** the creation-fixes note: "The address is now registered with Supabase the moment an administrator is created"
1. Create an administrator with a fresh address. Check Supabase.
2. Create another with an address already in use, and one with a typo'd domain.
- **Expect** the address appears immediately; the duplicate is refused **while the operator is still on the form**.
- **Fail** if the account only appears at password setup — that was the defect: an operator checking Supabase found only synthetic `pa_…` addresses and none they had typed.

#### UC-S03-06 · Registered is not the same as established — P1
**Role** School administrator · **Traces to** "the person is still not marked as having an account until they set a password"
1. Create a member; do not accept the invitation.
2. Read the members list, and check which email they receive.
- **Expect** "Invite pending"; they receive a **setup link**, not a "here is where to sign in" reminder; an emergency link can still be issued.
- **Fail** if they show as established — that flag drives all three of those and would make each say something untrue.

#### UC-S03-07 · Deleting a member releases their account — but only if no other school holds it — P1 · **NEEDS TENANCY**
**Role** School administrator · **Traces to** "Someone removed for cause could sign in again the moment they were re-added" and "the account is only deleted once no other school still lists that address"
1. Delete a member who belongs to **only** this school. Re-invite the same address.
2. Separately, delete a member who is also a member at another school. Sign in at that other school.
- **Expect** (1) the re-invited person must set a **new** password — they do not come back onto the old account. (2) The other school's access is untouched.
- **Fail** on either: inheriting the old password is the security defect; locking the second school out is the over-correction. Both are documented and both are easy to reintroduce.

#### UC-S03-08 · Creating an administrator actually sends the email — P1 · **NEEDS PANEL**
**Role** School administrator · **Traces to** the dashboard note: "`POST .../users` wrote the row and stopped… nothing was ever queued, and no screen said so"
1. Create an administrator. Check `email_outbox` and the screen's wording.
- **Expect** a message is queued and the screen says whether it was.
- **Fail** if creation is silent. Note a queue failure must **not** fail the request — "the member exists and is useful."

---

## Screens and access

#### UC-S03-09 · A branch administrator sees only their campus, and is told so — P1
**Role** Branch administrator · **Traces to** "with a branch administrator seeing only their own campus's people, which the screen says explicitly rather than leaving them to infer it from a short list"
1. Open Users and Staff as a branch administrator at a two-campus school.
- **Expect** only their campus, **and a visible statement that the list is scoped**.
- **Fail** if the scoping is silent — a short list with no explanation reads as missing data, and the note calls that out specifically.

#### UC-S03-10 · Emergency access recovers a locked-out school — P1
**Role** Super Admin · **Traces to** "`emergency_login_tokens` — a recovery path for a school locked out of its own administrator account"
1. Issue an emergency link for a school whose administrator cannot sign in. Redeem it.
2. Redeem the same link a second time, and redeem an expired one.
- **Expect** first redemption works; reuse and expiry are refused.
- **Fail** if the link is reusable — it is a bypass of the entire authentication surface.

#### UC-S03-11 · Every role reaches its own home — P2
**Role** All eleven · **Traces to** the panel-chooser note: "`ROLE_HOME_ROUTES` sends a teacher to `/teacher` and a parent to `/parent` the moment the session is minted"
1. Sign in as each role at the same `/login`.
- **Expect** each lands on its own portal, from one shared login screen.
- **Fail** if any role lands somewhere it cannot use, or if a separate login page exists per role — "there are not eleven sign-in panels."

#### UC-S03-12 · Sign-in is throttled — P1
**Role** Any · **Traces to** "Rate limiting and lockout did not exist in this sprint and were added in Sprint 0"
- Run the Sprint 0 cases. Recorded here so that anyone testing sign-in from this note does not conclude there is no throttle to test.

---

## Not in this release

- **Any permission system.** Role abilities were hard-coded until Sprint 8 — test
  the matrix there, not here.
- **WhatsApp OTP sign-in.** Removed as a channel and gated behind a paid
  per-school add-on (`0012`). Do not write cases assuming a code reaches a
  handset.
