# STATE.md — development state

**Purpose:** the handover file. Any new Claude session reads this first and can
resume without re-deriving context. Updated at the end of every development
step, before the session ends.

**Last updated:** 2026-08-08 (fifth session — Sprint 0)
**Branch:** everything up to §5i is **merged to `main`**. Sprint 0 (§5m) is on
`feature/sprint-0-auth-hardening` and is **not merged**. The Stage-4 worktree
branches (`stage-4-state-md-100f15`, `school-management-system-access-92a218`)
are merged and stale — prune them.
**Main branch:** `main` — last commit `7dc2123`, in sync with `origin/main`.
Migrations `0000`–`0014` applied. **`0015` is written but NOT applied** — it is
Sprint 0's, and applying it is a DevOps step. Next free number after it:
**`0016`**.

**The delivery plan now lives in `SPRINTS.md`** — 17 sprints across three
releases, reconciling `remaining work.docx` with this file and `ROADMAP.md`.

> **Stage 4 (§5b) is code-complete and its migrations are applied.** The one
> thing still blocking a real sign-in is Supabase Auth configuration, which is
> the user's to do — see §5d. Read §5d before touching `lib/school-auth.ts`;
> the claims design differs from what §5b describes.

---

## 1. What this project is

Multi-tenant SaaS school management system for Pakistani schools.

**The tenant key is the school's own id** — `schools.location_id`, set to
`schools.id` at creation — threaded through subdomain resolution → the
`school_users` lookup → every database row.

⚠️ **This reversed on 2026-08-08.** The platform was built on the premise that
each school *is* a GoHighLevel sub-account and its GHL Location ID is the
tenant key. GoHighLevel is now an **opt-in per-school integration**: a school
is created without one, and `schools.ghl_location_id` holds the sub-account if
and when it connects. Any older note calling the GHL Location ID "the tenant
key" is historical — including most of `README.md`.

The column is still physically named `location_id` on 43 tables. Renaming it
was considered and deferred: ~1,241 references, an unreviewable diff, and every
miss a runtime failure rather than a compile error. Read it as "tenant key".

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

## 5b. Stage 4 — email/password auth + WhatsApp removal ✅ COMPLETE

*(This section is the original plan, kept because its reasoning is still the
best record of why each step exists. All ten steps are done — see the progress
table in §5d. Read §5d for how the delivered design differs from this plan.)*

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
2. ~~**"Print selected" on the challan list.**~~ ✅ **Done 2026-08-08** — §5e.
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

### ⚠️ Outstanding after the GHL decoupling

**1. ~~There is no Integrations tab yet.~~ — DONE 2026-08-08.** See §5f.

**2. ~~"Print selected" on the challan list~~ — DONE 2026-08-08.** See §5e.

**3. One unexplained error.** The user hit a generic "Something went wrong" on
school creation before this change. The stack was lost to a server restart. The
GHL requirement was *not* the cause — the submitted value passed validation,
and the inserts succeed in isolation. If it recurs, the trace is in the dev
server log.

### ⚠️ What is NOT done — read before calling Stage 4 finished

*(The WhatsApp-gating paragraph that stood here is deleted: it was done on
2026-08-08 and is written up below under "WhatsApp gating (step 8)".
`lib/otp-sender.ts` no longer exists.)*

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

```bash
cd "D:/School-Management-System/.claude/worktrees/stage-4-state-md-100f15" && DATABASE_URL="$(grep '^DATABASE_URL=' /d/School-Management-System/.env.local | cut -d= -f2- | tr -d "\"'" | sed 's/:6543\//:5432\//')" npx drizzle-kit migrate
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

## 5e. "Print selected" on the challan list — done 2026-08-08

Item 2 of the §5c work order. The bulk print route had worked since 2026-08-07
with nothing linking to it; `ChallanTable` now selects rows and builds the URL.

- `lib/challan-print.ts` (new) — `MAX_PRINTABLE_CHALLANS` and
  `challanPrintHref()`. It exists because the cap is enforced on both sides of
  the client/server line: the list is a client component, the print page a
  server component, so neither can import the other and a drifting number would
  either offer a selection the print page refuses or refuse one it would take.
  The print page's local `MAX_CHALLANS` is gone; it imports this. Keep the
  module dependency-free — it is reachable from the browser bundle.
- `components/fees/ChallanTable.tsx` — checkbox column, a header box for the
  current page (with the indeterminate state set imperatively, since React has
  no attribute for it), and a bar that appears once something is selected.

**Two decisions worth not re-litigating.**

*Selection survives paging but is cleared by any filter change.* The cap is 200
and a page is 20, so a batch worth printing spans pages by definition. But after
a filter change the rows chosen from are gone, and carrying an invisible
selection into a new result set is how someone prints four hundred vouchers they
did not mean to. The header checkbox acts on the current page only, never the
whole filtered set, for the same reason.

*Over the cap, the button is disabled rather than the selection being capped* —
silently dropping 40 of 240 challans would be discovered at the counter. The
print page still re-checks, because the client is not a gate; reaching it over
the cap now takes a hand-edited URL.

Print opens in a new tab so the list, its filters and the selection survive.

**Not verified in a browser, and cannot be yet** — the challan list is behind a
school-admin session, and nothing can sign in until Supabase Auth is configured
(§5d item 2). `npm run typecheck` · `npm run lint` · `npm run build` all green.
This is the first thing to click once sign-in works.

**Known limit, not worth acting on yet:** the ids travel on the query string, so
200 uuids is ~7 KB of URL sitting alongside the session cookie inside Node's
16 KB header budget. Raising the cap materially means moving the selection off
the URL — a POST, or re-running the list's filters server-side — not just
changing the number. Documented in `lib/challan-print.ts`.

**Cancelled and waived challans are printable if selected.** Deliberate: the
list can filter by status, and the user is ticking specific rows. Revisit if a
school actually reprints a cancelled voucher by accident.

---

## 5f. Integrations tab + bulk module management — done 2026-08-08

Closes §5d outstanding item 1. GoHighLevel could be *read* but never *set*, so
every school was permanently unconnected and `ghlLocationFor()`'s error told
operators to use an Integrations tab that did not exist. Both halves now exist,
plus the cross-school tool the user asked for.

**Per-school** — `/super-admin/schools/[schoolId]/integrations`, new tab
between Modules and Branding. `IntegrationsPanel` + PATCH
`/api/super-admin/schools/[schoolId]/integrations`. Connecting is a text field
for the GHL Location ID, not a button: there is no OAuth install flow in this
repo (one exists on `claude/school-email-auth-7f5vuh`, unmerged). Disconnecting
is confirmed, because the id is stored nowhere else.

**Cross-school** — `/super-admin/modules`, new top-level sidebar entry.
`BulkModuleManager` + `SchoolMultiSelect` + GET/POST
`/api/super-admin/schools/bulk-modules`. All ten modules, the WhatsApp channel
and GoHighLevel on one page; a checkbox dropdown of every school with the
selection shown as named removable chips; one apply.

### Four decisions, in descending order of how much they matter

**1. Every flag is three-state — On / Off / Leave — defaulting to Leave, and
only what moved off Leave is sent.** This is the whole design. A checkbox
cannot distinguish "switch this off" from "I did not touch this", so a bulk
apply built on checkboxes silently switches off every module the selected
schools had on. The route enforces it too: absent key means untouched.

**2. GoHighLevel can be switched off in bulk but never on.** Connecting needs a
different sub-account id per school — the column is `unique`, so it could not
even be fudged — and there is nothing to broadcast. Disconnecting needs no
per-school input. The UI states the asymmetry rather than hiding it, and the
"On" control is disabled with the reason on hover. This is why GHL is
`PLATFORM_INTEGRATIONS` and not a `school_modules` flag: **connected means
`schools.ghl_location_id` is set, and there is deliberately no second flag that
could disagree with it.**

**3. WhatsApp-without-GHL is reported, not refused.** WhatsApp delivers through
the school's own sub-account, so turning it on for an unconnected school makes
a channel that cannot send. Refusing would make the order of two independent
steps matter; the apply result names the affected schools instead, and the send
paths already fall back to email.

**4. `MAX_SCHOOLS_PER_APPLY` = 100**, in `lib/platform-modules.ts` so route and
page cannot disagree. A blast-radius limit, not a database one — this tool can
switch Fee Management off for every school on the platform in one click.

Flag writes go out as a single multi-row upsert over every (school × flag)
pair, so forty schools is one round trip and it is all-or-nothing. The GHL
disconnect is a second statement, ordered last so a failure there cannot leave
flags half-written.

**Not verified in a browser** — the Super Admin panel needs a session, and
`SUPER_ADMIN_PASSWORD_HASH` sign-in has never been exercised against the live
database (§5c item 3). typecheck + lint + build green, and all four new routes
appear in the build output.

### ⚠️ Never run `npm run build` while `next dev` is running

They share `.next`. The production build overwrites the dev server's chunks,
and the dev server then serves HTML with **404s for its CSS** — every page
renders unstyled, which reads as "the site is broken" rather than "the build
stepped on the dev server". It happened on 2026-08-08 and cost a round trip to
diagnose.

Stop the dev server first, or accept that a build ends the dev session. To
recover:

```bash
rm -rf .next    # then restart the dev server
```

### ⚠️ Build hazard discovered while doing this — read before rebuilding

**`next build` inside a worktree creates `.claude/worktrees/node_modules`, and
that directory breaks the *next* build.**

The worktree has no `node_modules` of its own; it resolves upward three levels
to `D:\School-Management-System\node_modules`. But `outputFileTracingRoot` is
`import.meta.dirname` — the worktree — so the real `node_modules` is *outside*
the tracing root, and the standalone output writes a stub of it at the relative
path `../node_modules`, landing in `.claude/worktrees/`. That stub holds only
`next` and `styled-jsx`, about 0.2 MB, with the internals missing. On the next
build Node's upward search finds it first and Next fails to resolve its own
files:

    ../node_modules/next/dist/pages/_document.js
    Module not found: Can't resolve '../lib/is-error'

It looks like a broken install and is not one. **Delete it and rebuild:**

```bash
rm -rf "D:/School-Management-System/.claude/worktrees/node_modules"
```

The first build after deleting always passes; the second always fails. Not
fixed at source: pointing `outputFileTracingRoot` at the real repo root would
cure it, but that config line exists to keep the Hostinger standalone artifact
correct and changing it blind risks the deploy. **Decide it deliberately before
the first Hostinger deploy** — a worktree build is not the artifact that ships.

---

## 5g. Why the first administrator never receives an email — found 2026-08-08

**This is a design gap, not a bug, and it will recur until it is understood.**

`createFirstSchoolAdmin` (`lib/school-bootstrap.ts`, behind "Add administrator"
on the Users tab) writes a `school_users` row and **sends nothing at all**. Its
own comment says so: *"there is no invite to accept"*. That was correct when
login was a WhatsApp passcode against a phone number — the row *was* the
account, and there was nothing to tell anybody.

After Stage 4 the address is the identity and sign-in is email + password, so
that person now sits in the members list having received nothing, with no way
to learn the portal exists. The Users tab compounded it by labelling them
"Invite pending", implying an invitation was on its way. There is no
invitation, and none was coming.

**The person could already sign in** — `/api/school/auth/otp/request` sends a
GoTrue code to any address that is an active member, which is exactly what that
row makes them. Nobody had ever been told to go and do it.

Closed with **"Send sign-in email"** on each member's row
(`.../users/[userId]/send-signin`): the portal URL, which address to use, and
which button to press. Deliberately **not** a six-digit code — GoTrue's codes
are short-lived, so one mailed from an operator screen is usually dead before
it is read, and that failure looks like a broken system. The recipient requests
their own code when they are ready.

Two related corrections in the same pass:
- **Email is now required** when creating an administrator from this screen.
  Without one the account cannot ever be signed into. `createFirstSchoolAdmin`
  still tolerates a null email for the school-provisioning path that infers it
  from the principal; the route is what refuses.
- The status badge no longer says "Invite pending". It reads **"Never signed
  in"**, from `auth_user_id` rather than `joined_at` — which is what it
  actually means.

### Diagnosed at the same time: the `pa_…@` Supabase user

A Supabase user appeared as
`pa_5ee3118fa477706539e8a809@schoolhub.codexmill.com`, minutes after the
school user was created, and looked like the missing invitation. It is not.
`pa_` is a **platform-admin impersonation account**, minted by "Login as
Admin" — the one thing `app_metadata` is used for (§5d). It has no connection
to the school member. Nothing was ever sent to `ray.pro1112@gmail.com` because
nothing was ever going to be.

### ⚠️ `SMTP_PORT` is not set in `.env.local`

`lib/email-sender.ts` defaults to **587** with STARTTLS. The Supabase dashboard
is configured against `smtp.titan.email` on **465**, which is implicit TLS. If
"Send sign-in email" reports a transport error, set `SMTP_PORT=465` — the two
are separate credentials and Supabase's setting does not reach this code.

---

## 5h. Super Admin user and school controls — done 2026-08-08

- **`PATCH .../users/[userId]`** — activate / deactivate. Instant: `is_active`
  is read per request by `membershipFor()`, never carried in a token, so there
  is no session to revoke separately.
- **`DELETE .../users/[userId]`** — removes a member. Several foreign keys into
  `school_users` are `NO ACTION` (attendance marked, leave decided, payroll
  run, periods taught), so Postgres refuses the delete once the person's name
  is on any record. **That refusal is correct** — who marked a register is part
  of the register — and it is translated into an explanation pointing at
  deactivate. In practice: delete works for people who never got started, which
  is the case it is for; deactivate is the answer for everyone else.
- Delete is confirmed inline rather than with `window.confirm`, which is
  unstyled and dismissed by reflex.
- **Schools list** — Edit / Login as Admin / Deactivate are now three buttons of
  one size on one baseline, right-aligned with the column header. They were two
  links and a button: three heights, two hit areas, for actions of equal weight.
- **"Login as Admin" added to the school Overview page**, same pair and order as
  the list so the two places an operator acts on a school agree.
- **"GHL Location ID" column renamed "Tenant ID"**, and the page description no
  longer says schools are "keyed by GHL Location ID". Both were left over from
  before the decoupling: the column holds `schools.location_id`, a plain uuid.
  The GHL sub-account is `ghl_location_id` and lives on the Integrations tab.

typecheck, lint and build green. Routes confirmed reachable (401, not 404).
**The UI has not been clicked** — see §5i.

---

## 5j. Verified in a browser 2026-08-08 — and what it caught

First real click-through of any of this. Six defects found that typecheck,
lint and build all passed.

**Confirmed working, against the live database:**
- Bulk apply: Fee Management switched on for one school; the other nine
  modules stayed off, proving "Leave" does not clobber untouched flags. Audit
  row recorded `enabledBy: haznain666@gmail.com`.
- Multi-select: dropdown, filter, checkbox, named chip, "1 school selected",
  per-flag "off everywhere" summaries.
- **"Send sign-in email" actually delivered** to the school administrator.
- Integrations tab, Modules sidebar entry, aligned school-row buttons,
  "Login as Admin" on Overview, "Never signed in" badge.

**Found and fixed:**
1. **The multi-select dropdown was invisible.** `Card` carries
   `overflow-hidden` to clip its header to the rounded corners, which clipped
   the absolutely-positioned dropdown: the filter box showed and the school
   list was cut off, so nothing could be selected. `cn` is tailwind-merge, so
   `className="overflow-visible"` on that one card wins.
2. **Action buttons wrapped onto a second line** on both the schools list and
   the users table — the exact misalignment the button change was meant to
   remove. `flex-nowrap` + `whitespace-nowrap`; the tables are already inside
   `overflow-x-auto`, so a narrow window gets a scrollbar instead.
3. **The school Overview page labelled the tenant uuid "GHL Location ID"** —
   the same staleness fixed in the table, telling an operator a school was
   connected to GoHighLevel when it never has been. Now "Tenant ID" plus a
   separate "GoHighLevel" field reading "Not connected".
4. **`SchoolForm` told operators the phone number "becomes the principal's
   login, so use a mobile that can receive WhatsApp".** Both halves untrue
   since Stage 4.
5. Stale WhatsApp-as-login copy on the Users and Login-as pages.
6. **SMTP hangs for two minutes**, see below.

### ⚠️ SMTP: use port 465, not 587

Measured from this machine against `smtp.titan.email`:

| Port | Connect time |
| --- | --- |
| 587 (STARTTLS) — the code default | **111 seconds** |
| 465 (implicit TLS) | **1.4 seconds** |

The mail arrives either way; on 587 the operator watches a spinner for two
minutes first and concludes the feature is broken. `SMTP_PORT` was unset, so
`lib/email-sender.ts` defaulted to 587. **Set `SMTP_PORT=465`** in `.env.local`
and in the Hostinger panel.

`lib/email-sender.ts` now also sets `connectionTimeout` / `greetingTimeout` /
`socketTimeout` (15–20s). Nodemailer's defaults are minutes long and every
caller is inside a request someone is watching: slow is a failure mode and
should look like one, rather than as an unresolving spinner.

---

## 5k. First-time sign-in drops the code — done 2026-08-08

**The two paths are now genuinely different things, and that is the point.**

| | Before | Now |
| --- | --- | --- |
| First time | link → type email → request code → read 2nd email → type code → set password | **link → set password** |
| Forgotten | same six steps, same link | code → set password, reached from **"Forgot password?"** |

The link in the welcome email is now the proof of mailbox control. That is
exactly what a code demonstrated, so asking for one as well proved the same
thing twice with a second email and a transcription in between.

**New:** `password_setup_tokens` (migration `0014`, applied and verified),
`POST /api/school/auth/setup`, `/set-password/[token]`, `SetupPasswordForm`.

### The constraints that make the link safe — do not relax these

The email is now a credential rather than instructions. Same trust model as
every password-reset link, which is why it is acceptable; these are what keep
it narrow:

- 32 random bytes, single use, 48 hours, bound to one member at one school.
- **Only ever issued to a member who has never signed in**, re-checked at
  redemption rather than trusted from issue time. An account that already has
  a password must go through Forgot Password and prove the mailbox with a
  code. Otherwise an old link in an old inbox would outrank the stronger path
  forever. `send-signin` sends a *different* email — a plain reminder, no
  link — to anyone who already has an account.
- **Nothing is redeemed on page load.** Mail clients and scanners follow links,
  so a GET that consumed the token would spend it before the recipient
  clicked. The token travels with the password in one POST.
- The token is spent *before* the account is touched, in an UPDATE whose WHERE
  still requires it unused, so two simultaneous submissions cannot both win.
  If anything after that fails, the spend is rolled back — see below.

### Verified end to end against the live database

Setup link redeemed: `200 redirectTo=/dashboard`, account created and bound
(`auth_user_id` + `joined_at` set), session minted. Immediate replay of the
same token: `404 invalid_token`. Bogus token: 404. Weak password: 400, **and
the token was not spent** — the strength check runs before the lookup, so a
weak password cannot burn a link the person may not be able to re-request.

### ⚠️ Two real bugs this found

**1. `revokeAllSessions` has never worked.** It called
`auth.admin.signOut(userId, 'global')`, but that method takes a **JWT** —
`signOut(jwt: string, scope?)`. GoTrue rejected every call with *"token
contains an invalid number of segments"*. Nobody noticed because
`endSchoolSession` catches and logs it and `revokeSchoolSession` has no
callers; it surfaced only when a new caller let it reach a user as a 500.

It is now a **documented no-op**. Throwing was strictly worse: it revoked
exactly as much (nothing) and broke the caller too. **This is not a
regression** — `membershipFor()` re-reads `is_active` on every request, and
that is what actually makes deactivation instant. What is genuinely missing is
the tidy-up: a deactivated user's Supabase refresh token lives until it
expires. Buys them nothing while the membership check refuses them, but it
should be closed — the admin API here has no revoke-by-user-id, so it needs
the GoTrue REST endpoint and a deliberate decision.

**2. A failure after the token was spent left a dead link.** That is how the
bug above presented: the token was consumed, `revokeAllSessions` threw, and
the member was left with a burnt link and no account. The post-spend work is
now wrapped, and the spend is undone on failure.

### ⚠️ Correction: port 465 does not fix the slow email

Earlier measurements used `verify()`, which only opens a connection. Measuring
the real `sendMail`:

| | 587 | 465 |
| --- | --- | --- |
| `verify()` (connect only) | 111s | 1.4s |
| **`sendMail()` (actual send)** | ~125s | **~103s** |

So the port barely matters for the thing that actually blocks the request.
`smtp.titan.email` is simply slow to accept mail from here, and the
`socketTimeout` added earlier does not fire because the socket is never idle
long enough. 465 is still the better setting, but **the fix for the two-minute
spinner is not to block the response on the send** — that is an open decision,
because the current design deliberately reports delivery failure to the
operator.

---

## 5i. Browser verification — how far it got

The dev server runs from this worktree. `.env.local` was copied in from the
main repo (`.env*.local` is gitignored here, so it cannot be committed) and
`.claude/launch.json` added.

**Everything Super Admin needs is already configured** — `DATABASE_URL`,
`SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD_HASH`, `SUPER_ADMIN_JWT_SECRET` are
all present and filled. **Super Admin does not use Supabase Auth**; it is
bcrypt + its own JWT (`lib/super-admin-credentials.ts`). An earlier note in
this file claiming the panel was blocked on Supabase Auth was wrong — only the
*school* portals are.

The user has signed in and created "Sample Test School" successfully.

**What still blocks it:** the assistant's in-app browser has its own cookie jar
and is not signed in, and passwords are not something it types. Someone has to
sign in to that browser once per session; everything after that is drivable.

The Supabase dashboard is now configured: Email provider enabled, Confirm email
on, custom SMTP through `smtp.titan.email:465`.

---

## 5m. Sprint 0 — rate limiting, lockout and the email outbox

Branch `feature/sprint-0-auth-hardening`. Migration **`0015_sprint0_auth_hardening.sql`**,
**written and not applied.** Two new tables, `auth_attempts` and `email_outbox`.
typecheck, lint and build all green. Nothing has been seen in a browser and
nothing has touched the live database.

`SPRINTS.md` said Sprint 0 needed no migration. It was wrong — all three pieces
of this sprint are tables — so Sprint 0 took `0015` and every migration named
for Sprints 9 onward shifted up by one. That is corrected in `SPRINTS.md` in the
same commit.

### What was built

**1. `lib/auth-throttle.ts` + `auth_attempts`.** There was no rate limiter in
this codebase at all, on a live auth surface. Now every unauthenticated endpoint
records its attempts and consults them first: `/api/school/auth/login`,
`/otp/request`, `/password`, `/setup`, and `/api/super-admin/auth/login`.

**2. `lib/email-outbox.ts` + `email_outbox`.** Nothing sends mail inside a
request any more. Callers enqueue; a drainer sends. `lib/email-sender.ts` is
unchanged and is still the only transport — what changed is who calls it.

**3. Drain triggers.** A new `instrumentation.ts` starts a 30-second in-process
interval, and `POST /api/internal/email/drain` behind `EMAIL_DRAIN_SECRET` lets
a host cron drive the same function. Both can run at once safely.

### Decisions — do not re-litigate these

**Postgres, not Upstash.** The source document assumed `@upstash/ratelimit`.
That is right for a fleet of serverless instances with no shared memory. This is
one persistent Node process with a Postgres pool already open, so Redis would be
a new vendor, a new secret and a new thing to be down, and an in-process counter
would be lost on every restart. The table is also the audit trail Sprint 23's
security review will ask for, which no counter is. Cost: one indexed SELECT per
auth request.

**Two axes, deliberately asymmetric.** Per email: 5 failures in 15 minutes, then
15 minutes locked. Per IP: much looser (30, or 20 for super-admin). Schools in
this market sit behind shared NAT — a whole staff room, sometimes a whole cable
segment, arrives from one address — so an IP-only limit punishes the customer,
and an email-only limit lets one origin spray a thousand accounts without any
single counter reaching five. Neither alone covers both attacks.

**A success clears the email's streak, but never the IP's.** Four typos followed
by a correct sign-in must not leave someone one mistake from a lockout. The IP
axis cannot work that way: an attacker holding one valid account would otherwise
reset the whole origin's counter at will.

**Attempts refused by the throttle are not recorded.** That is what makes a
lockout expire on its own instead of being extended forever by a client that
keeps retrying. There is no `locked_until` column: the lock lifts when the
oldest of the counted failures leaves the 15-minute window.

**`auth_attempts` carries no `location_id`, on purpose.** It guards the surface
*before* a tenant is established, so there is no verified tenant to attribute an
attempt to, and recording the *claimed* one would key the counter on
attacker-supplied data — a counter an attacker can reset. This is written in the
schema docblock and in the migration because every other table in the repo
carries `location_id` and its absence otherwise reads as an oversight.

**`email_outbox.location_id` is nullable.** The queue also carries platform mail
— the Super Admin's "Send sign-in email" — which must work while a school is
still being set up. Null means platform. A synthetic tenant value would be a lie
in the one column every tenancy filter trusts. There is also no foreign key to
`schools`: a queued message should survive its school being closed rather than
vanish mid-flight.

**The two mail-sending endpoints count successes; the credential endpoints do
not.** `/otp/request` answers "sent" unconditionally so it cannot be enumerated,
which means it has no failures to count and a failure-only limiter would leave
it with no limit at all. There the volume *is* the harm: every call costs an
SMTP send and lands in a mailbox.

**The IP is hashed, and salted with `ENCRYPTION_KEY`.** IPv4 is 32 bits; an
unsalted digest is reversible in seconds, which would make "hashed" decorative.
If the key is absent the digest is still stable and the limiter still works —
only the irreversibility is lost, which is the correct order of failure.

**The limiter fails open.** If the database is unreachable, sign-in still works.
A limiter that takes the product down when it is unavailable trades a rare
attack for a certain outage.

**Cleanup rides on writes, ~1 call in 50.** Hostinger has no platform cron, so a
sweep either rides on traffic or does not happen.

**The claim is hand-written SQL.** `FOR UPDATE SKIP LOCKED` over a subselect is
the one thing Drizzle's builder cannot express, and it is exactly what stops two
drainers handing the same message to SMTP twice. A duplicated fee notice to a
parent is not a cosmetic bug. `scheduled_at` is reset to `now()` by the claim so
it doubles as the claim time — without that, a message enqueued an hour ago
would look abandoned the instant it was claimed and a second drainer would take
it back mid-send.

### The UX consequence, which is real and was not hidden

Those screens used to report **actual delivery**. They cannot any more, and
their copy now says so:

| Screen | Was | Is |
| --- | --- | --- |
| Super Admin → Users → Send sign-in email | "Sign-in instructions sent to …" | "Sign-in email queued for … It usually arrives within a minute." |
| Pending invitations badge | `Email` | `Email queued` |
| Invite form warning | "Invitation sent, with issues: …" | "Invitation queued, with issues: …" |
| User detail → Resend invite | "Invitation sent again." | "Invitation queued again. It usually arrives within a minute." |

What the operator loses is "it bounced, that address is wrong" **at the moment
of pressing**. What they gain is an answer in milliseconds instead of ~103
seconds (§5k). The outcome is not lost, it moves: `email_outbox.status` and
`last_error` hold the SMTP server's own words, and a bad address ends up
`failed` after five attempts. A screen that says "Sent" when it means "queued"
is a worse lie than the two-minute spinner it replaced.

`school_invitations.email_sent` still exists and now records that the message
was *queued*. Renaming the column would cost a migration for a distinction the
schema cannot make anyway; the UI is where the wording matters and the UI says
"queued".

### ⚠️ A build trap this hit, and the fix

`instrumentation.ts` is compiled for the **Edge** runtime too, because
`middleware.ts` exists. `lib/email-outbox.ts` pulls in postgres-js and
nodemailer, which need `fs`, `crypto` and TCP sockets, and the Edge build fails
outright. The guard must be written as a **positive** block:

```ts
if (process.env.NEXT_RUNTIME === 'nodejs') {
  const { startOutboxDrainer } = await import('./lib/email-outbox');
  startOutboxDrainer();
}
```

Next substitutes the variable with a literal at build time, so in the Edge
compilation this becomes `if (false)` and webpack never parses the body. The
obvious equivalent — `if (… !== 'nodejs') return;` — reads the same to a human
and **does not work**: the parser walks on past the return and records the
import anyway. The first build of this sprint failed exactly that way.

### What is still open

1. **Migration `0015` is not applied.** DevOps step. Nothing in Sprint 0 works
   until it is — every code path degrades quietly rather than crashing (the
   limiter fails open, `enqueueEmail` throws and is reported), which is by
   design but means an unapplied migration looks like "email stopped working".
2. **None of this has been seen in a browser.** No lockout has been triggered,
   no message has been drained, and the drain route has never been called.
3. **`EMAIL_DRAIN_SECRET` is unset**, so `/api/internal/email/drain` refuses
   everything. That is the correct default — the in-process drainer is what runs
   on Hostinger — but it means the escape hatch is untested.
4. **The queue has no operator screen.** A `failed` row is visible only in the
   database. Sprint 11 builds on this table and is the natural place for it;
   until then, a message nobody received is a `SELECT` away and no closer.
5. **`/api/school/auth/otp/verify` is not throttled.** GoTrue rate-limits code
   verification itself, so it is not unguarded — but it is the one auth route in
   this repo without a counter of its own, and that is a decision, not an
   oversight.
6. The remaining Sprint 0 checklist items from `SPRINTS.md` — I-2 (Supabase
   bucket public), I-4 (storage diagnostics), I-6 (prune 4 merged branches and
   4 worktrees), I-8 (DMARC, blocked on the domain) — are **untouched by this
   branch**. Branch deletion was explicitly out of scope for this agent.

---

## 6. Open items for the user

1. ~~Install GitHub CLI~~ — **partly regressed.** Git has a stored credential
   and push works, but `gh` is **not on PATH** in this environment (checked
   2026-08-08, both Bash and PowerShell). PR creation from a session does not
   work; push and merge do.
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
| 2026-08-08 | **Sprint 0 built** (§5m) — rate limiting, account lockout and the email outbox, on `feature/sprint-0-auth-hardening`. New `auth_attempts` and `email_outbox` tables (migration `0015`, **written not applied**), `lib/auth-throttle.ts` on all five auth endpoints, `lib/email-outbox.ts` with a `FOR UPDATE SKIP LOCKED` claim, an `instrumentation.ts` interval drainer and a secret-guarded `/api/internal/email/drain`. Every screen that used to claim "sent" now says "queued", because that is now all it knows. Corrected `SPRINTS.md`: Sprint 0 does need a migration, and Sprints 9–21's numbers each shifted up by one. typecheck + lint + build green. | **Apply `0015`** (DevOps), then exercise a lockout and a drain in a browser. Then Sprint 9 — it is the keystone and everything in R1 waits on it. |
| 2026-08-07 | Surveyed codebase, established STATE.md, scoped both migrations, identified the Edge-middleware DB hazard. | — |
| 2026-08-07 | **Stage 1 complete.** Neon → Supabase Postgres: postgres-js driver, Edge-safe REST tenant lookup, all 15 `db.batch()` sites converted to real transactions, `next/image` Supabase host fix, `output: 'standalone'`. typecheck + lint + build all green. | — |
| 2026-08-07 | **Stage 3 documented.** User confirmed Hostinger supports Node.js and auto-issues HTTPS per subdomain. Wrote `DEPLOYMENT.md`; de-Vercel'd the operator-facing strings in the storage diagnostics route. | — |
| 2026-08-07 | **Stage 2 started.** `is_active` enforcement landed in `verifySchoolSession()` — the revocation guarantee is now provider-independent. Wrote up the provider-swap design. 4 commits made; **could not push — no git credential and no `gh` on this machine.** | — |
| 2026-08-07 | **Direction changed by the user.** Login becomes email + password; signup uses an email OTP to set a password; everything merges to main as one piece. This makes Supabase Auth the right answer and supersedes the earlier design — see the ⚠️ block in §3. | — |
| 2026-08-08 | **GoHighLevel decoupled from tenant identity.** A school no longer needs a GHL sub-account to exist: `location_id` is now the school's own uuid, and the new nullable `schools.ghl_location_id` carries the GHL account when one is connected. Every call that names a location to GHL goes through `ghlLocationFor()`, which refuses clearly when a school has not connected. Migration 0013. **Tested end to end against the live database** — school created with no GHL id (201), tenant resolved through Edge middleware, first admin provisioned, test data removed. | **Build the Integrations tab** so GHL can actually be switched on, then "Print selected" on the challan list. |
| 2026-08-08 | **Migrations 0011 + 0012 applied** — the first time any Stage 4 work touched the live database. 13 recorded; every effect verified, including the per-tenant unique index that lets one person hold accounts at two schools. Corrected `drizzle.config.ts`, which pointed at the IPv6-only direct connection. | **Configure Supabase Auth (email provider + SMTP), then sign in for real.** |
| 2026-08-08 | **WhatsApp gated (step 8) — Stage 4 code-complete.** New `whatsapp` channel flag in `school_modules`, declared separately from the product modules and rendered in its own Channels section. All five live send paths gated; the invite passcode moved to email, killing the last WhatsApp dependency in auth; the orphaned `lib/otp-sender.ts` deleted and its duplicated SMTP transport extracted to `lib/email-sender.ts`. Fee reminders now report how many guardians nobody could reach. Migration 0012. typecheck + lint + build green. | **Run 0011 + 0012, configure Supabase Auth, then sign in for real.** Nothing here has touched the live database. |
| 2026-08-08 | **Login UI rebuilt.** `EmailLoginForm` replaces `LoginOTPForm`: password sign-in plus a code path for first-time and forgotten passwords. `PasswordField` + `lib/password-strength.ts` lifted from the email-auth branch and made the single source the password route also reads. Closed a hole this created: invitations now require an email address, because the address is the identity. typecheck + lint + build green. | **WhatsApp gating (step 8)**, then run migration 0011 and try signing in for real. |
| 2026-08-08 | **Stage 4 auth substrate.** Firebase Authentication → Supabase Auth. New `lib/supabase-auth.ts`; `lib/school-auth.ts` now resolves claims from `school_users` per request instead of from the token, which retires the stale-claims hazard. Login/OTP/password/logout/platform-session/emergency-login/invite-accept all reworked; `/api/school/auth/session` and the browser round trip deleted. `firebase_uid` → `auth_user_id` + migration `0011`. Firebase removed entirely. typecheck + lint + build green. | **The login UI (§5d item 1) — it is broken until then.** Then WhatsApp gating (step 8). |
| 2026-08-08 | **First-time sign-in drops the code** (§5k). A welcome email now carries a single-use link that goes straight to "choose a password"; the code survives only behind "Forgot password?". New `password_setup_tokens` table, migration 0014 applied and verified. Found two real bugs doing it: `revokeAllSessions` has never worked (it passed a user id where GoTrue wants a JWT), and a failure after the token was spent left a dead link. | **Decide the SMTP blocking question** (§5k) and whether to implement refresh-token revocation properly. |
| 2026-08-08 | **First browser verification** (§5j). Bulk apply confirmed against the live database — one module on, nine untouched, audit row correct — and "Send sign-in email" delivered for real. Six defects found that typecheck/lint/build had all passed, including an invisible dropdown (Card's `overflow-hidden` clipped it), action buttons still wrapping, and the Overview page labelling the tenant uuid "GHL Location ID". Also measured SMTP: port 587 takes 111s where 465 takes 1.4s. | **Set `SMTP_PORT=465`** locally and in Hostinger. Rotate the production Super Admin password — it is still the leaked one. |
| 2026-08-08 | **Found why school users get no email** (§5g): "Add administrator" was never designed to send one, and after Stage 4 that leaves an account nobody can find. Added "Send sign-in email", made email required, and corrected the misleading "Invite pending" badge. Also added deactivate/delete for members (§5h), turned the schools-list actions into aligned buttons, put "Login as Admin" on the Overview page, and renamed the stale "GHL Location ID" column. | **Sign in to the assistant's browser once** so this can finally be clicked through. |
| 2026-08-08 | **Integrations tab + bulk module management** (§5f). GHL can finally be connected to a school — the write path never existed. New cross-school `/super-admin/modules`: multi-select schools as named chips, all ten modules plus WhatsApp plus GoHighLevel, three-state On/Off/Leave so an apply cannot clobber untouched flags. GHL is off-only in bulk, because connecting needs a per-school id. Also found and documented a build hazard: `next build` in a worktree creates `.claude/worktrees/node_modules`, which breaks the next build. | **Configure Supabase Auth**, then sign in and exercise this — none of it has been seen in a browser. |
| 2026-08-08 | **"Print selected" on the challan list** (§5e) — checkboxes on `ChallanTable`, selection that survives paging but not filtering, and a shared `lib/challan-print.ts` so the 200-challan cap cannot drift between the list and the print page. Also **confirmed there is still no Integrations tab**: nothing in the app writes `schools.ghl_location_id`, so GHL cannot be switched on for a school. typecheck + lint + build green; nothing browser-verified, because sign-in is still blocked. | **Configure Supabase Auth in the Supabase dashboard** (§5d item 2) — it now blocks every remaining item. Then build the Integrations tab. |
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
