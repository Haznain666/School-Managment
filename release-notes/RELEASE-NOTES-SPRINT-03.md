# Release notes — Sprint 3: School users, invitations & sign-in

**Status:** shipped, and its authentication substrate was later rebuilt. See
*What replaced part of this*, below. Migrations `0003`–`0005`, applied.

> Reconstructed after the fact. See
> [how these were written](README.md#how-these-were-written).

Schools got people. This sprint introduced the account every member of a school
signs in with, and the invitation that creates it.

---

## What a school gets

**`school_users` — one record per person per school.** Name, email, phone, role,
campus, avatar and an active flag. The same person can belong to more than one
school; the account is theirs, the membership is per school.

**Roles.** The role set that later sprints build permissions on: school
administrator, branch administrator, principal, vice principal, coordinator,
teacher, accountant, HR manager, marketing, student and parent.

**Invitations** (`school_invitations`). Invite somebody by email; they set their
own password and the account becomes usable. Nobody's password is ever chosen
for them by an administrator.

**Users & Staff screens.** List the school's people, open one, and invite a new
one — with a branch administrator seeing only their own campus's people, which
the screen says explicitly rather than leaving them to infer it from a short
list.

**Emergency access** (`emergency_login_tokens`) — a recovery path for a school
locked out of its own administrator account.

---

## What replaced part of this

The sign-in half of this sprint has been rebuilt twice since:

- **Firebase Auth → Supabase Auth** (`0011_stage4_supabase_auth.sql`). The
  account substrate changed underneath; `school_users` survived, gaining an
  `auth_user_id` that is no longer globally unique, because one person
  legitimately holds the same identity at every school they belong to.
- **WhatsApp OTP sign-in was removed** as a channel and became a paid per-school
  add-on gated behind a module flag (`0012`).
- **Password setup tokens** were reworked (`0014`).
- **Rate limiting and lockout did not exist in this sprint** and were added in
  Sprint 0 — see that note. Until then the auth surface had no throttle at all.

If you are reading the code, `lib/school-auth.ts` is the current answer to "who
is this and what school are they in", and it post-dates this sprint.

---

## Not in this release

- Any permission system. A role's abilities were hard-coded until Sprint 8.
- Rate limiting, lockout, or an audit trail of sign-in attempts — Sprint 0.
