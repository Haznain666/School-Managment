# STATE.md — development state

**Purpose:** the handover file. Any new Claude session reads this first and can
resume without re-deriving context. Updated at the end of every development
step, before the session ends.

**Last updated:** 2026-08-08 (third session)
**Branch:** `claude/stage-4-state-md-100f15` (worktree) — fast-forwarded from
`claude/school-management-system-access-92a218`, so it carries Stages 1 and 3.
**Main branch:** `main` — last commit `81d0cfc` (send apikey header, accept `sb_secret_` keys)

> **Stage 4 (§5b) is code-complete and its migrations are applied.** The one
> thing still blocking a real sign-in is Supabase Auth configuration, which is
> the user's to do — see §5d. Read §5d before touching `lib/school-auth.ts`;
> the claims design differs from what §5b describes.

---

## 1. What this project is

Multi-tenant SaaS school management system for Pakistani schools.
Each school is a **GoHighLevel (GHL) sub-account**; its **GHL Location ID is the
tenant key**, threaded through subdomain resolution → JWT claims → every database
row → outbound GHL calls.

Built through Sprint 8. Working: super-admin panel, school portals, branches,
students, admissions, fees/challans, academics, attendance, HR & payroll, roles
and per-school permissions, invitations (WhatsApp + email fallback), OTP login,
emergency/platform impersonation login.

---

## 2. Target architecture (decided 2026-08-07)

| Concern | Was | Now |
| --- | --- | --- |
| Auth | Firebase Authentication + custom claims | **Supabase Auth** |
| Database | Neon serverless Postgres | **Supabase Postgres** |
| File storage | Supabase Storage | Supabase Storage *(already migrated, PR #17/#18)* |
| ORM | Drizzle | Drizzle *(unchanged)* |
| Realtime | Firebase RTDB *(rules only, never wired up)* | Drop, or Supabase Realtime if ever needed |
| Background jobs | Firebase Functions *(empty scaffold)* | Drop, or cron on the host |
| Deploy target | Vercel | **Hostinger** |

Storage already moved to Supabase in the last two merged PRs, so the Supabase
project, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` already exist and work.
Auth and DB join them.

---

## 3. Current state of the migration

**Status: Stage 1 (database) COMPLETE. Stage 3 (Hostinger) documented.
Stage 4 (auth) — substrate COMPLETE and green, login UI still to build (§5d).**

Verification run 2026-08-07 — all three green:
`npm run typecheck` · `npm run lint` · `npm run build` (middleware 39.4 kB,
`.next/standalone/server.js` emitted).

### Decisions taken 2026-08-07

- **Host:** Hostinger Node.js hosting. ✅ Confirmed by the user 2026-08-07:
  Node.js is supported, and HTTPS is issued automatically for subdomains
  created in hPanel. Deployment is unblocked; see `DEPLOYMENT.md`.
  - Caveat recorded, not blocking: that is **per-subdomain** issuance, not a
    wildcard cert. Creating a school in the Super Admin panel does not by
    itself make `<slug>.<domain>` reachable — someone must add the subdomain in
    hPanel too. Fine at tens of schools; revisit with Cloudflare (wildcard DNS
    + Universal SSL at the edge) if self-service onboarding is ever wanted. No
    application code change either way.
- **Data:** development only. No Neon export, no Firebase user export. Rebuild
  the schema on Supabase from `db/migrations` and recreate test accounts.
- **Tenancy:** wildcard subdomain (`slug.domain.com`), with the existing
  `?school=` + `school_slug` cookie fallback left intact.

### Stage 1 — database, Neon → Supabase Postgres

Done:
- `package.json` — dropped `@neondatabase/serverless`, added `postgres` ^3.4.5.
- **`lib/neon.ts` deleted → `lib/postgres.ts`** (postgres-js over the Supavisor
  transaction pooler; `prepare: false` is mandatory there, see the file).
- `lib/drizzle.ts` — `drizzle-orm/neon-http` → `drizzle-orm/postgres-js`.
  Also gained a `batch()` helper, see below.
- **`lib/school-lookup-edge.ts` (new)** — middleware's tenant lookup, over
  Supabase REST. See hazard §4.1: this is the file that exists because Edge has
  no TCP.
- `middleware.ts` — no longer imports Drizzle; calls `fetchSchoolBySlug`.
- `drizzle.config.ts`, `app/api/super-admin/diagnostics/database/route.ts` —
  updated wording + import.

**`db.batch()` → `batch()` conversion — done, all 15 sites.**
`db.batch()` is a neon-http API; postgres-js has none. `lib/drizzle.ts` now
exports `batch(db, (tx) => [...])`, which runs the statements in one real
transaction. **Statements must be built on `tx`, not `db`** — a builder made
from `db` runs on a pooled connection outside the transaction even when awaited
inside one. That is the whole reason the helper takes a callback, and the rule
to remember if you add a new call site.

Sites where the statement list is assembled across a loop keep an array of
`(tx) => …` thunks and finish with
`await batch(db, (tx) => statements.map((s) => s(tx)))`.

**~~Known loose end~~ — RESOLVED:** the stale *comments* referring to Neon and
`db.batch()` have been rewritten across 14 files. Anywhere a comment justified
atomicity it now says the statements run in one transaction opened by `batch()`,
rather than crediting the Neon HTTP driver. Two mentions of Neon remain on
purpose, both in `batch()`'s own docblock in `lib/drizzle.ts`: they are
past-tense history explaining what the helper replaced and why.

Three comments were not merely stale but actively wrong, and were corrected
rather than reworded:
- `lib/schools.ts` claimed the module was Edge-safe. It goes through Drizzle over
  postgres-js and is now Node-only; the note points at `lib/school-lookup-edge.ts`.
- `lib/enrollment.ts` explained `randomUUID()` keys by "the HTTP driver has no
  interactive transactions". The real constraint now is that `batch()` builds
  every statement in one expression, so none can consume another's `RETURNING`.
- `lib/fee-challans.ts`'s `BULK_CONCURRENCY` was bounded "so Neon is not
  flooded"; it is now bounded by the postgres-js pool, since each student's
  challan holds a connection for its transaction.

Comments only — no behaviour changed. `npm run typecheck`, `npm run lint` and
`npm run build` all pass.

Also fixed while here:
- `next.config.mjs` — `images.remotePatterns` still allowed only
  `firebasestorage.googleapis.com`, which was already wrong after the storage
  move in PR #17/#18: `next/image` would have refused every school logo. Now
  derived from `SUPABASE_URL`.
- `next.config.mjs` — added `output: 'standalone'` for Hostinger.
- `.env.example` — `DATABASE_URL` now documents the Supabase pooler (app, 6543)
  vs direct (migrations, 5432) split.

### Scope measured

683 Firebase/Neon references across 79 files. Breakdown of what actually has to
change (as opposed to incidental mentions):

### ⚠️ DIRECTION CHANGED 2026-08-07 (later) — read this before §Stage 2 below

The user changed the product, and it invalidates the Stage 2 design that
follows. **Do not build the magic-link plan below it.** Kept only as a record of
what was rejected and why.

**New decisions:**

1. **Login is email + password.** WhatsApp is no longer a login mechanism.
2. **Signup: email OTP → user sets their own password.**
3. **WhatsApp is REPLACED by an internal chat system — REVISED AGAIN
   2026-08-07.** This supersedes the paid-add-on decision below. Chat is built
   into the CRM on Supabase Realtime (no third-party chat server, no Twilio, no
   WhatsApp API). Phone numbers stay required as contact records but are not a
   delivery channel. Full design, permission model and data model in
   `ROADMAP.md` §5. **The critical dependency is Web Push via PWA** — without it
   this replaces a channel parents read with one they do not open.

   *Previous decision, now superseded:*
   This replaces the earlier "switch all WhatsApp off" decision. Email is the
   primary channel for everything, with no WhatsApp in any critical path. The
   Super Admin panel gets a "Connect WhatsApp" option against each school, so
   schools that pay for it get it. **Gate the existing send paths behind a flag
   in `school_modules` — do not comment them out or delete them.** Build the
   routes now, keep them dormant. See `ROADMAP.md` §4.
4. ~~Comment the old code out.~~ Superseded by #3 — there is no longer WhatsApp
   code to remove, only code to gate.
5. **One merge, not three.** Hold Stages 1+3 on this branch until the auth
   rework is done, then merge once.

**Why this simplifies everything.** The blocker in the old Stage 2 design was
that this app verified credentials itself and only wanted Supabase to *mint* a
session — which Supabase cannot do (confirmed: an open feature request, not an
API this project missed). Email + password removes the problem entirely, because
`signInWithPassword` means Supabase does the verifying. No synthetic emails, no
custom-token substitute, no second identity table to keep in sync.

**So: use Supabase Auth (GoTrue) properly.** This reverses the "hand-roll the
session cookie with jose" recommendation that was made before the product
changed. That recommendation was correct only for the WhatsApp-OTP world.

**New design:**
- Signup / invite acceptance: `auth.signInWithOtp({ email })` →
  `verifyOtp` → `updateUser({ password })`.
- Login: `signInWithPassword({ email, password })`.
- Session: Supabase session in httpOnly cookies via `@supabase/ssr`.
- **Authorization data stays in `school_users`, not in the token.** Role,
  branchId and isActive are read from the row per request and memoised — the
  `isAccountActive` lookup added in §4.2 already does this, so extra columns are
  free. Keeps role changes instant and avoids stale-claim bugs.
- `firebase_uid` → `auth_user_id` (the Supabase `auth.users.id`), + migration.

**⚠️ PRODUCT RISK TO RAISE AGAIN BEFORE BUILDING.** Two things follow from
"email for everything" that the user may not have priced in:
- **Students and parents may not have email addresses.** In this market that is
  common. Today they sign in by phone. After this change, a parent with no email
  cannot log in *and* cannot receive fee challans or payment confirmations.
  `student_guardians.email` is nullable, which suggests it is often empty —
  **check real data before building.**
- Deliverability: fee notices moving from WhatsApp to SMTP means bounces and
  spam folders become a fee-collection problem.

There is a prior branch on origin, `claude/school-email-auth-7f5vuh`, which may
already contain email-auth work. **Check it before starting.**

---

### Stage 2 (SUPERSEDED — see the direction change above)

The `is_active` half is done (§4.2). The provider swap is not. Read this before
starting — the central problem is not obvious and costs an hour to rediscover.

**The problem.** This app never asks Firebase to *verify* a credential. It
verifies everything itself — the WhatsApp OTP, the invite token, the emergency
token, the platform hand-off token — and only then asks Firebase to mint a
token for an already-authenticated person (`createCustomToken`). Supabase has
no `createCustomToken`. Its admin API cannot mint a session directly.

**Decision: give every school user a Supabase identity keyed by email, and mint
sessions with `auth.admin.generateLink({ type: 'magiclink' })` →
`verifyOtp({ token_hash, type: 'magiclink' })`, entirely server-side.**

- Users with a real email use it. Phone-only users (OTP sign-in, students,
  parents) get a deterministic synthetic address that mirrors today's
  `deriveSchoolUid`: `su_<sha256(locationId:phone)[0:24]>@<PLATFORM_BASE_DOMAIN>`.
  **Determinism is load-bearing** — a resent invite or a retried request must
  land on the same account, or one person silently becomes two.
- Claims (`locationId`, `role`, `branchId`, `schoolSlug`) move from Firebase
  custom claims to Supabase `app_metadata`, which GoTrue embeds in the access
  token. Writable only with the service-role key. `parseSchoolClaims` reads
  them from the same place either way.
- Because it is all server-side, **the browser round-trip disappears**: today
  the client signs in with a custom token, gets an ID token, then POSTs it to
  `/api/school/auth/session`. With Supabase the OTP route can mint the session
  and set the cookie in one response. `/api/school/auth/session` and the whole
  Firebase *client* SDK can go. That is a net simplification, and it is why the
  file count below is smaller than it looks.

**Rejected alternatives**, so they are not re-litigated:
- *Set a random password then `signInWithPassword`* — works, but writes a
  credential that briefly exists and must be kept secret from its own owner.
- *Self-sign a JWT with the project's JWT secret* — bypasses GoTrue, so there
  is no refresh token and no server-side sign-out. That would put us back where
  §4.2 started.

**Order of work:** `lib/supabase-auth.ts` (admin client + session mint/verify)
→ `lib/school-auth.ts` (swap the provider, keep `isAccountActive` untouched)
→ auth routes → layouts → delete the four `lib/firebase*.ts` files → schema
rename `firebase_uid` → `auth_user_id` (+ migration) → drop the `firebase` and
`firebase-admin` deps and the `serverExternalPackages` entry in
`next.config.mjs`.

**Files involved:**
- `lib/firebase.ts`, `lib/firebase-client.ts`, `lib/firebase-admin.ts` — SDK init.
- `lib/school-auth.ts` — session cookie lifecycle. **The hard one.** Firebase
  `createSessionCookie` / `verifySessionCookie(cookie, true)` has no direct
  Supabase equivalent. See §4.
- `lib/firebase-custom-token.ts` — phone/OTP users sign in via a Firebase custom
  token; uid is derived deterministically as `su_<sha256(locationId:phone)[0:24]>`.
  Needs a Supabase equivalent (`auth.admin.generateLink` or a service-role
  session mint). The determinism must be preserved or repeat sign-ins will
  create duplicate accounts.
- `types/school-auth.ts` — `parseSchoolClaims`. Claims move from Firebase custom
  claims to Supabase `app_metadata` (which Supabase embeds in the access-token JWT).
- Auth routes: `app/api/school/auth/session`, `.../otp/verify`,
  `.../platform-session/[token]`, `app/api/school/emergency-login/[token]`,
  `app/api/auth/[...nextauth]`.
- Layouts that verify sessions: `(school-admin)`, `(teacher)`, `(student)`,
  `(parent)`, `(super-admin)`.
- `db/schema/users.ts` and `db/schema/school-users.ts` carry `firebase_uid`
  columns → rename to `auth_user_id` (migration required).

**Database — mostly mechanical.**
- `lib/neon.ts` + `lib/drizzle.ts` — swap `drizzle-orm/neon-http` for
  `drizzle-orm/postgres-js` against Supabase's Supavisor pooler.
- `drizzle.config.ts`, `DATABASE_URL` value.
- Existing migrations `0000`–`0010` are plain Postgres and port as-is.
- **Catch:** see §4, middleware.

**Not affected:** GHL client and token encryption, fees, payroll, admissions,
academics, permissions, super-admin bcrypt/JWT auth, OTP generation, SMTP.

**Dead weight to remove:** `database.rules.json`, `firebase.json`, the empty
`functions/` scaffold, `firebase` + `firebase-admin` + `@neondatabase/serverless`
deps.

---

## 4. Known hazards — read before touching anything

1. **Middleware runs on the Edge runtime and queries the database.**
   `middleware.ts` resolves `slug → location_id` with a live DB query, using
   Neon's *HTTP* driver, which works on the Edge. Supabase's Postgres connection
   is **TCP** — `postgres-js` / `pg` will not run there. This must be re-routed
   through Supabase's REST API (`@supabase/supabase-js`, fetch-based, Edge-safe)
   or the lookup moved out of middleware. **This will silently be the thing that
   breaks the build.**

2. ~~**Instant revocation is lost.**~~ **RESOLVED 2026-08-07.**
   `isAccountActive()` in `lib/school-auth.ts` now checks `school_users.is_active`
   inside `verifySchoolSession()` — the one point both `withSchoolAuth` (API
   routes) and `readSchoolSession` (layouts) already pass through. Memoised
   per-request with React `cache()`, so it costs one indexed lookup per request.
   A missing row counts as active on purpose: deactivation is a soft delete, so
   "no row" means a platform-admin impersonation session, not a disabled user.
   **This is now independent of the identity provider, so the Supabase swap
   cannot regress it.**

3. **Claims live in the JWT.** Supabase `app_metadata` is user-writable only via
   the service role, and lands in the access token — good. But changing a user's
   role does not refresh their existing token. Same staleness problem Firebase
   had; same fix (force re-auth / refresh).

4. **Tenancy rules are enforced, not aspirational.** `location_id` never comes
   from user input; every API route calls `withSchoolAuth()`; every query filters
   on `location_id`. The migration must not weaken any of these. Supabase RLS is
   *additional* defence, not a replacement for the existing filters.

5. **`.env.local` must stay gitignored.** Next.js loads it at server start and it
   overwrites platform-injected variables — a committed one blanks every secret
   in production.

---

## 5. Hostinger deployment — Stage 3

**Documented in `DEPLOYMENT.md`.** Code side is done: `output: 'standalone'`
is set and the build emits `.next/standalone/server.js`.

Remaining, and all of it is the user's to do rather than code:
- Set every `.env.example` variable in the Hostinger panel. **Never upload
  `.env.local`** — Next loads it at server start and it overwrites
  platform-injected variables, blanking every secret.
- Run migrations from a workstation against the **direct** connection (5432),
  not the pooler.
- Build on Linux/Node 20+, not Windows: `sharp` ships platform-specific
  binaries. Build in WSL/Docker or let Hostinger build from git.
- Create each school's subdomain in hPanel (see the caveat in §3).

---

## 5b. Stage 4 — email/password auth + WhatsApp removal (NEXT, not started)

Ordered so each step leaves the build green. Do not start in a session that is
already low on context; this is the most security-sensitive code in the repo.

1. **Check `claude/school-email-auth-7f5vuh` on origin first** — may already do
   some of this.
2. **Confirm the product risk above with the user** (do parents/students
   actually have email addresses?) before writing code.
3. Add `@supabase/supabase-js` + `@supabase/ssr`. New `lib/supabase-auth.ts`:
   admin client, signup-OTP, password sign-in, session read/write.
4. Rewrite `lib/school-auth.ts` onto Supabase sessions. **Keep
   `isAccountActive()` exactly as it is** — it is provider-independent and is
   what guarantees instant deactivation.
5. Routes: replace `/api/school/auth/otp/*` with email-OTP signup + password
   login. Delete `/api/school/auth/session` (no more ID-token exchange — the
   login route sets the cookie itself).
6. Layouts (5) + `lib/api-auth.ts` + `lib/school-guard.ts`.
7. Schema: `firebase_uid` → `auth_user_id`, plus migration.
8. **Gate WhatsApp behind a per-school flag** (not remove it). Add a
   `whatsapp_enabled` flag to `school_modules`, a "Connect WhatsApp" control in
   the Super Admin school page, and make every send path check it with an email
   fallback. Senders are `lib/ghl-fees.ts`, `lib/invite-sender.ts`,
   `lib/otp-sender.ts`, `lib/ghl-admissions.ts`; the rest of the 46 files are
   call sites and UI copy.
9. Delete `lib/firebase*.ts` (4 files), `firebase.json`,
   `database.rules.json`, `functions/`; drop the `firebase` and
   `firebase-admin` deps and the `serverExternalPackages` entry in
   `next.config.mjs`.
10. `npm run typecheck && npm run lint && npm run build`, then merge everything
    to main as one piece.

---

## 5c. AGREED WORK ORDER (set 2026-08-07) — start here

1. **Stage 4 — email/password auth** (§5b). The big one. Start it in a fresh
   session; check `claude/school-email-auth-7f5vuh` on origin first.
2. **"Print selected" on the challan list.** Small. The bulk print route
   (`dashboard/fees/challans/print?ids=…`) works but nothing links to it — it
   needs checkboxes on the list and a button that builds the URL.
3. **Start the app and create a test school.** Sign in to Super Admin with
   `SUPER_ADMIN_EMAIL` / the password behind `SUPER_ADMIN_PASSWORD_HASH`, create
   a school, and confirm a page renders against the live database. This is the
   first time any of the Supabase work is exercised for real.

### Database status — DONE 2026-08-07, do not redo

The Supabase database is **built, empty and correctly tracked**: 43 tables,
11 migrations recorded, PostgreSQL 17.6. It was rebuilt from scratch because
the original schema had been created with `db:push` and had no migration
bookkeeping, which would have made the next schema change fail.

`.env.local` exists at `D:\School-Management-System\.env.local` and is
gitignored. It was briefly named `ATT90132.env`, which matched no ignore rule —
if that name reappears, it is unprotected secrets sitting in the repo.

**Connection strings — this cost an hour, do not rediscover it.** The direct
connection (`db.<ref>.supabase.co`) is IPv6-only without a paid add-on and fails
with `getaddrinfo ENOTFOUND` on an ordinary network. Use the pooler for both:
port **6543** (transaction) for the app, port **5432** (session) for
`db:migrate`.

---

## 5d. Stage 4 — IN PROGRESS (started 2026-08-07)

### Step 1 of §5b is done: `claude/school-email-auth-7f5vuh` was checked

It is **not** a stub. 8 commits, ~14,300 insertions across 61 files, and it
already implements the whole Stage 4 *product* surface: email invitation flow,
email OTP, set-password, password login, forgot/reset password, all five
layouts, plus a GHL OAuth install flow that never existed on main.

**But it does not use Supabase Auth.** It verifies passwords itself against its
own `email_credentials` / `user_passwords` tables and keeps Firebase purely as
the cookie substrate (`lib/email-session.ts` there mints a custom token,
exchanges it for an ID token over the Identity Toolkit REST API, and sets the
Firebase session cookie). It is also cut from old `main`, so it still carries
Neon and Firebase and has none of Stage 1.

Test-merging it onto this branch produces **only 2 conflicts** — `lib/neon.ts`
(deleted by Stage 1) and `app/api/super-admin/diagnostics/database/route.ts`.
So it remains cheap to adopt later if the decision below is ever revisited.

### The objection that branch raises, and the answer

That branch's docblock makes a point §5b never considered:

> One address may belong to a teacher at one school and a parent at another —
> two accounts, two passwords, two claim sets. Supabase's globally-unique
> `email` column cannot express that.

This is real and must be handled, not forgotten. Under Supabase Auth the answer
is a **deterministic per-school address** for the second and subsequent schools
a given address is used at, mirroring `deriveEmailUid(locationId, email)` on
that branch. Determinism is load-bearing for the same reason it was before: a
resent invite or a retried request must land on the same account.

### Decision (user, 2026-08-07): rebuild on Supabase Auth per §5b

The user was shown three options — merge that branch and swap Firebase for a
self-signed `jose` JWT; rebuild on Supabase Auth; or merge as-is and keep
Firebase — and chose **Supabase Auth**. Rationale: one vendor for auth + DB +
storage, and GoTrue owns refresh tokens and password hashing so this repo owns
less security-critical code.

**So: do not merge `claude/school-email-auth-7f5vuh`.** Its UI components
(`EmailLoginForm`, `OtpCodeInput`, `PasswordField`, the forgot-password screens)
are still worth lifting individually, since they are provider-agnostic.

### Progress

| Step (from §5b) | Status |
| --- | --- |
| 1. Check the email-auth branch | ✅ done — see above |
| 2. Confirm the parent-email risk | ✅ moot (§6.2 — internal chat decision) |
| 3. Deps + `lib/supabase-auth.ts` | ✅ done |
| 4. Rewrite `lib/school-auth.ts` | ✅ done |
| 5. Auth routes | ✅ done, routes and UI |
| 6. Layouts (5) + `api-auth` + `school-guard` | ✅ done |
| 7. `firebase_uid` → `auth_user_id` + migration | ✅ done — `0011_stage4_supabase_auth.sql` |
| 8. Gate WhatsApp behind `school_modules` | ✅ done |
| 9. Delete Firebase | ✅ done — no Firebase left in the repo |
| 10. typecheck + lint + build | ✅ all three green |

**Verified 2026-08-08:** `npm run typecheck` · `npm run lint` · `npm run build`
all green, re-run after the login UI landed. Firebase is gone: the four
`lib/firebase*.ts`, `firebase.json`, `database.rules.json`, `functions/`, both
npm dependencies and the `serverExternalPackages` entry.

### The design that came out of it, and how it differs from §5b

§5b assumed claims would move to Supabase `app_metadata`. They did not, and
this is the one thing to understand before touching any of it.

**One Supabase account per person. Authorization lives in `school_users`, read
per request.** The tenant comes from the subdomain (middleware header), the
credential says only *who*, and the pair (`locationId`, `auth_user_id`) selects
the one membership row that says what they may do here.

Three things follow, all improvements:

- The same address can be a teacher at one school and a parent at another —
  the objection the email-auth branch raised — with no synthetic addresses.
  A synthetic address could not have received the signup code GoTrue sends,
  which is the whole reason to use GoTrue.
- **Hazard §4.3 (stale role claims) is retired**, not carried forward. There
  are no role claims in the token to go stale; a role change takes effect on
  the very next request. `/api/school/users/[userId]` no longer mirrors
  anything into the provider.
- `isAccountActive` grew into `membershipFor` and returns the whole row.
  It is the same one indexed, request-memoised lookup it always was, and it
  still carries the instant-deactivation guarantee. **Do not remove it.**

`app_metadata` is used for exactly one thing: marking the per-school platform
operator accounts behind "Login as Admin", which have no membership row by
design. Because that case is now explicit, a *missing* row correctly means
"not a member here" and is refused — the old "absent row counts as active"
rule is gone, and `lib/school-auth.ts` explains why it could not have been
fail-closed before.

The browser round trip is gone with it. `/api/school/auth/session` and
`establishSession()` are deleted: routes that mint a session write the cookie
onto their own response.

### The login UI — done 2026-08-08

`components/school/LoginOTPForm.tsx` is gone, replaced by
`components/school/EmailLoginForm.tsx`. One component, four steps, because
"first time here" and "forgot my password" are the same three requests and
both end where signing in ends:

    password ──▶ (home)
       │
       └─▶ request-code ──▶ code ──▶ set-password ──▶ (home)
            otp/request     otp/verify   password

`PasswordField` and `lib/password-strength.ts` were lifted from
`claude/school-email-auth-7f5vuh` — they were provider-agnostic, as expected.
Two changes were made to them: `PASSWORD_MIN_LENGTH` is 10 rather than 8, and
`/api/school/auth/password` imports `validatePasswordStrength` from that same
module, so the strength meter and the check that accepts a password cannot
drift apart.

**A hole was found and closed while doing this.** `school_invitations.email`
was optional — it had been the fallback channel when WhatsApp could not
deliver. Under Supabase Auth the address *is* the identity, and the accept
route now requires it, so an invitation created without one could be sent and
never accepted. Both `app/api/school/invitations/route.ts` and
`components/school/InviteForm.tsx` now require a valid address. **Existing
invitation rows with a null email cannot be accepted** — there are none in
development, but re-issue any that appear.

### WhatsApp gating (step 8) — done 2026-08-08

**The switch.** One flag, `whatsapp`, stored in `school_modules` — same table,
same upsert route, same audit breadcrumb as the product modules — but declared
in `PLATFORM_CHANNELS` rather than `PLATFORM_MODULES`, so it renders in its own
"Channels" section on the Super Admin school page instead of as a toggle beside
Hostel Management. A channel is not a module. `db/migrations/0012` widens the
CHECK constraint; no rows are inserted, so **every school starts with WhatsApp
off** and email carrying everything.

Read it with `isWhatsAppEnabled(locationId)` from `lib/channels.ts` —
request-memoised, fails closed. A "send all reminders" loop over 300 challans
asks once.

**The plan said four sender files. It was six places, and one was already dead:**

| Where | Now |
| --- | --- |
| `lib/ghl-fees.ts` | Both channels when available; see below |
| `lib/invite-sender.ts` | Email must work, WhatsApp is an extra — the reverse of before |
| `.../invitations/[inviteRef]/accept/initiate` | **Moved to email entirely** |
| `app/api/admissions/apply` | Gated; email alongside |
| `.../applications/[applicationId]` | Gated; email alongside |
| `lib/ghl-admissions.ts` | **Deliberately not gated** — see below |
| `lib/otp-sender.ts` | **Deleted** — orphaned once login left WhatsApp |

**`lib/ghl-admissions.ts` is the one exception and it is deliberate.**
`triggerAdmissionWelcomeWorkflow` does not send anything; it hands a contact to
an automation the school built inside GoHighLevel, and what that automation
does — WhatsApp, email, a tag, a task — is invisible from here. Gating it would
switch off email and tagging for schools that never bought WhatsApp. The
consequence: a school whose GHL workflow sends WhatsApp can still do so with
the add-on off. Documented in the file; not worth closing until a school
actually has such a workflow.

**The unreachable-guardian count.** With WhatsApp off, a guardian with no email
receives nothing. `/api/school/fees/reminders` now returns `unreachable`
alongside `queued`, counted with `canReachGuardian()` — the same predicate the
sender uses, so the report and the sending cannot disagree. The payments route
deliberately does *not* report it: the payment succeeded either way and the
person is standing at the counter holding a receipt.

**Two duplicated SMTP helpers became one.** `lib/email-sender.ts` — the
transport was character-for-character identical in `invite-sender` and
`otp-sender`.

**The invite passcode is now emailed.** It went to the invited handset; since
the address is the identity, proving the handset proved the wrong thing. The
last WhatsApp dependency in the auth path is gone. `lib/otp.ts` and
`otp_sessions` are still used by it — GoTrue's own OTP would sign the person in
as a side effect, which is the accept route's job and must happen after the
membership row is written.

### ⚠️ What is NOT done — read before calling Stage 4 finished Unchanged from §5b: add
`whatsapp_enabled` to `school_modules`, a "Connect WhatsApp" control on the
Super Admin school page, and make `lib/ghl-fees.ts`, `lib/invite-sender.ts`,
`lib/otp-sender.ts` and `lib/ghl-admissions.ts` check it with an email
fallback. **Gate, do not delete.**

**1. ~~Migrations 0011 and 0012~~ — APPLIED 2026-08-08.** 13 recorded, and
every effect verified against the live database: `auth_user_id` on all three
tables, no `firebase`-named constraints left, the per-tenant unique index
`school_users_location_id_auth_user_id_idx` present, the old global unique on
`school_users` dropped, `emergency_login_tokens.auth_user_id` nullable, and the
`school_modules` CHECK accepting `whatsapp`.

**This database and this branch are now committed to each other.** `main` still
reads `firebase_uid` and will not work against it.

**How to run migrations, because `npm run db:migrate` does not work alone.**
It is bare `drizzle-kit migrate`: it does not load `.env.local`, `.env.local`
lives in the main repo rather than the worktree, and the URL in it ends in
`:6543` (transaction pooling) where migrations need `:5432` (session). One
command that handles all three without you touching the password:

```
cd "D:/School-Management-System/.claude/worktrees/stage-4-state-md-100f15" && DATABASE_URL="$(grep '^DATABASE_URL=' /d/School-Management-System/.env.local   | cut -d= -f2- | tr -d "\"'" | sed 's/:6543\//:5432\//')" npx drizzle-kit migrate
```

`drizzle.config.ts` used to recommend the direct connection
(`db.<ref>.supabase.co:5432`) for this. It is IPv6-only without a paid add-on
and fails with `getaddrinfo ENOTFOUND`; the docblock is corrected.

**2. Supabase dashboard configuration is required and is the user's to do** —
without it nothing signs in. Authentication → Providers → Email enabled with
"Confirm email" on; Authentication → Emails → SMTP configured, or codes will
not be delivered past Supabase's very low built-in limit; Authentication →
Sessions for the refresh-token lifetime, which the application no longer owns.
`NEXT_PUBLIC_SUPABASE_ANON_KEY` is new in `.env.example` and is read at **build**
time.

---

## 6. Open items for the user

1. ~~Install GitHub CLI~~ — done. `gh` 2.97.0, authenticated as `Haznain666`,
   and git has a stored credential. Push and PR creation both work.
2. ~~Do students and parents have email addresses?~~ — moot. The internal chat
   decision (§3.3) removes the dependency on either email or phone reach.
3. ~~Create the Supabase database~~ — done, see §5c.
4. **The domain name** — it fills `PLATFORM_BASE_DOMAIN`,
   `NEXT_PUBLIC_APP_DOMAIN`, `INVITE_LINK_BASE_URL`, `GHL_REDIRECT_URI`.
5. **Which school is the pilot?** Still unanswered, and still the highest-value
   thing outstanding — everything in `ROADMAP.md` is guesswork until one real
   school uses it.
6. **Start JazzCash / Easypaisa merchant onboarding.** Weeks of paperwork on
   their timeline; it will become the critical path for payments.
7. **Open product questions** blocking POS, the wallet and chat — `ROADMAP.md`
   §7. Uniform size/colour variants is the one that cannot be retrofitted.

---

## 7. Session log

| Date | Session did | Next |
| --- | --- | --- |
| 2026-08-07 | Surveyed codebase, established STATE.md, scoped both migrations, identified the Edge-middleware DB hazard. | — |
| 2026-08-07 | **Stage 1 complete.** Neon → Supabase Postgres: postgres-js driver, Edge-safe REST tenant lookup, all 15 `db.batch()` sites converted to real transactions, `next/image` Supabase host fix, `output: 'standalone'`. typecheck + lint + build all green. | — |
| 2026-08-07 | **Stage 3 documented.** User confirmed Hostinger supports Node.js and auto-issues HTTPS per subdomain. Wrote `DEPLOYMENT.md`; de-Vercel'd the operator-facing strings in the storage diagnostics route. | — |
| 2026-08-07 | **Stage 2 started.** `is_active` enforcement landed in `verifySchoolSession()` — the revocation guarantee is now provider-independent. Wrote up the provider-swap design. 4 commits made; **could not push — no git credential and no `gh` on this machine.** | — |
| 2026-08-07 | **Direction changed by the user.** Login becomes email + password; signup uses an email OTP to set a password; everything merges to main as one piece. This makes Supabase Auth the right answer and supersedes the earlier design — see the ⚠️ block in §3. | — |
| 2026-08-08 | **Migrations 0011 + 0012 applied** — the first time any Stage 4 work touched the live database. 13 recorded; every effect verified, including the per-tenant unique index that lets one person hold accounts at two schools. Corrected `drizzle.config.ts`, which pointed at the IPv6-only direct connection. | **Configure Supabase Auth (email provider + SMTP), then sign in for real.** |
| 2026-08-08 | **WhatsApp gated (step 8) — Stage 4 code-complete.** New `whatsapp` channel flag in `school_modules`, declared separately from the product modules and rendered in its own Channels section. All five live send paths gated; the invite passcode moved to email, killing the last WhatsApp dependency in auth; the orphaned `lib/otp-sender.ts` deleted and its duplicated SMTP transport extracted to `lib/email-sender.ts`. Fee reminders now report how many guardians nobody could reach. Migration 0012. typecheck + lint + build green. | **Run 0011 + 0012, configure Supabase Auth, then sign in for real.** Nothing here has touched the live database. |
| 2026-08-08 | **Login UI rebuilt.** `EmailLoginForm` replaces `LoginOTPForm`: password sign-in plus a code path for first-time and forgotten passwords. `PasswordField` + `lib/password-strength.ts` lifted from the email-auth branch and made the single source the password route also reads. Closed a hole this created: invitations now require an email address, because the address is the identity. typecheck + lint + build green. | **WhatsApp gating (step 8)**, then run migration 0011 and try signing in for real. |
| 2026-08-08 | **Stage 4 auth substrate.** Firebase Authentication → Supabase Auth. New `lib/supabase-auth.ts`; `lib/school-auth.ts` now resolves claims from `school_users` per request instead of from the token, which retires the stale-claims hazard. Login/OTP/password/logout/platform-session/emergency-login/invite-accept all reworked; `/api/school/auth/session` and the browser round trip deleted. `firebase_uid` → `auth_user_id` + migration `0011`. Firebase removed entirely. typecheck + lint + build green. | **The login UI (§5d item 1) — it is broken until then.** Then WhatsApp gating (step 8). |
| 2026-08-07 | **Print framework built** — `components/print/PrintSheet.tsx`, generic `@media print` rules, school logo wired in, and bulk challan printing at `dashboard/fees/challans/print?ids=…`. Also **revised the WhatsApp decision to a paid per-school add-on** (see §3.3 and `ROADMAP.md` §4), and folded the user's video-derived module directory into `ROADMAP.md` §2b — which surfaced student promotion, Excel import, POS and e-learning as previously unknown gaps. | **Stage 4 (§5b), in a fresh session.** Check `claude/school-email-auth-7f5vuh` first. The parent-email risk is now *resolved* by the WhatsApp add-on decision, so it no longer blocks. |

### Note for whoever runs the next session

Do **not** rewrite source files with PowerShell `Get-Content`/`Set-Content`.
PS 5.1 reads as ANSI and writes UTF-8-with-BOM, which double-encodes the
box-drawing characters used throughout this codebase's comments and produces
files the Next.js compiler rejects as invalid UTF-8. Two files were corrupted
this way and had to be restored with `git checkout`. Use the editing tools.

---

## 8. Working agreement

- **Update this file at the end of every development step.** It is the contract
  that makes running out of context safe.
- Keep §3 (state), §6 (blockers) and §7 (log) truthful — a stale STATE.md is
  worse than none.
- `README.md` is out of date (still describes Sprint 1, Firebase Storage, Neon,
  Vercel). Refresh it once the migration lands rather than editing it twice.
