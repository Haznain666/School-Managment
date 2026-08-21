# SMS Platform — Sprint 1 Foundation

Multi-tenant SaaS school management system for Pakistani schools.

Each school is a **GoHighLevel (GHL) sub-account**, and its **GHL Location ID is
the tenant key**. It flows through every layer — subdomain resolution, JWT
claims, database rows, file paths, realtime paths, and outbound GHL calls.

```
beaconhouse.platform.com
        │
        ▼  middleware.ts  (subdomain -> school_subdomains -> location_id)
   x-location-id: 8xK2p...
        │
        ▼  lib/auth-middleware.ts  withAuth()
   Firebase ID token claims: { location_id, role, branch_id, is_dual_role }
        │
        ▼  header location_id MUST equal claim location_id
   AuthContext { uid, locationId, role, branchId, isDualRole }
        │
        ▼  every query: WHERE location_id = auth.locationId
```

---

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router), TypeScript strict |
| Styling | Tailwind CSS |
| Auth | Firebase Authentication + custom claims |
| Database | Neon serverless PostgreSQL + Drizzle ORM |
| File storage | Firebase Storage |
| Realtime | Firebase Realtime Database |
| Background jobs | Firebase Functions (2nd gen) — scaffold only |
| Deploy target | Hostinger (`output: 'standalone'`) |

---

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in real values
# .env.local is gitignored and must stay that way: @next/env loads it at
# server start and OVERWRITES platform-injected variables, so a committed
# one silently blanks every secret in production.

# Generate an encryption key for GHL tokens at rest
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Apply the schema to your Neon database
DATABASE_URL="postgresql://..." npm run db:migrate

npm run dev
```

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run check-loaders` | Asserts every data-fetching route has a `loading.tsx` — see `CLAUDE.md` |
| `npm run db:generate` | Generate a migration from `db/schema` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Drizzle Studio |

`drizzle-kit` reads `DATABASE_URL` from the environment, not from `.env.local`.
Either export it or run with `node --env-file=.env.local`.

### Working locally without a subdomain

`localhost` has no school subdomain, so middleware falls back in this order:

1. `?subdomain=beaconhouse` on the URL — resolved against the database
2. `DEV_FALLBACK_LOCATION_ID` in `.env.local` — pins every local request to one school
3. Neither — the request proceeds with no tenant (landing page only)

---

## Tenancy rules

These are enforced, not aspirational. Breaking one is a cross-tenant data leak.

1. **`location_id` is never derived from user input.** It comes from verified
   Firebase claims. URLs, request bodies and query strings are untrusted — the
   `[locationId]` in the portal URL is checked against the resolved tenant and
   discarded, never used as the filter.
2. **Every API route calls `withAuth()` first.** It verifies the ID token and
   then cross-checks the JWT's `location_id` against the `x-location-id` header
   that middleware derived from the subdomain. A mismatch is a 403 — that is the
   tenant-spoofing defence.
3. **Every query filters on `location_id`.** Drizzle applies no implicit scope.
4. **Branch scoping is a second layer.** `branch_id = null` in claims means all
   branches; otherwise the user is confined to their own branch.
5. **GHL tokens are encrypted at rest** (AES-256-GCM, `lib/crypto.ts`). Only
   `lib/ghl-tokens.ts` reads or writes the `ghl_tokens` table.
6. **Admin SDK is server-only; client SDK is browser-only.** `lib/firebase.ts`
   initialises lazily so it never runs during server prerender.

---

## Layout

```
app/
  (auth)/login/            Branded per-school login (page + client form)
  (auth)/role-select/      Dual-role users pick an active role
  (super-admin)/           Platform admin shell + /super-admin page
  (school)/[locationId]/   School portal shell + dashboard
  api/
    auth/[...nextauth]/    Firebase auth support endpoints (see note below)
    schools/               Tenant directory
    branches/              Campuses within a school
    students/              Student records
components/
  ui/                      Button, Card, Input, Badge
  layout/                  Sidebar, TopBar, PortalShell, SchoolPortalFrame
  auth/                    AuthProvider (client auth state)
lib/
  firebase.ts              Client SDK (lazy)
  firebase-admin.ts        Admin SDK, custom claims
  neon.ts / drizzle.ts     Database client + ORM instance
  ghl-client.ts            GHL API wrapper (token refresh, backoff)
  ghl-tokens.ts            Encrypted token storage
  crypto.ts                AES-256-GCM
  auth-middleware.ts       withAuth(), requireRole(), assertBranchAccess()
  schools.ts               Subdomain <-> location_id resolution
  claims.ts                UserClaims type + parsing
db/
  schema/                  Drizzle tables
  migrations/              Generated SQL
functions/                 Firebase Functions (2nd gen) scaffold
middleware.ts              Subdomain -> x-location-id
storage.rules              Firebase Storage rules
database.rules.json        Realtime Database rules
```

### Schema

| Table | Tenant key | Notes |
| --- | --- | --- |
| `school_subdomains` | *is* the mapping | subdomain PK, `location_id` unique |
| `ghl_tokens` | `location_id` PK | tokens stored encrypted |
| `branches` | `location_id` | `secondary_path` ∈ matric / o-level / a-level |
| `users` | `location_id` | `firebase_uid` unique; email unique per school |
| `user_roles` | `location_id` | multiple rows = dual role |
| `students` | `location_id` | admission number unique per school |
| `staff` | `location_id` | employee code unique per school |

Every table is indexed on `location_id`.

---

## API

All routes require `Authorization: Bearer <firebase-id-token>` except
`POST /api/auth/resolve-identifier`, which runs before sign-in.

| Route | Method | Who |
| --- | --- | --- |
| `/api/auth/resolve-identifier` | POST | public (tenant-scoped by subdomain) |
| `/api/auth/session` | GET | any signed-in user |
| `/api/auth/roles` | GET | any signed-in user |
| `/api/auth/select-role` | POST | any signed-in user, own roles only |
| `/api/schools` | GET | own school; super_admin sees all |
| `/api/schools` | POST | super_admin |
| `/api/branches` | GET / POST | read: all; write: school_admin, principal, vice_principal |
| `/api/students` | GET / POST | read: all; write: + coordinator |

Responses use one envelope: `{ ok: true, data }` or
`{ ok: false, error: { code, message } }`.

---

## Firebase security rules

Deploy with `firebase deploy --only storage,database`.

- **Storage** — objects live under `/{locationId}/...`; a caller may only touch
  the prefix matching their `location_id` claim. `super_admin` reaches all.
  Branding is writable by school admins and marketing; a user's own files by
  themselves; everything else by staff roles. Anything outside a `locationId`
  prefix is denied.
- **Realtime Database** — `/notifications/{locationId}/{userId}` (user reads own
  inbox, any school member may write) and `/live_sessions/{locationId}`
  (school members read, teaching and leadership roles write; participants update
  their own presence). Root is denied and nothing else is granted.

`database.rules.json` contains `//` comments, which the Firebase CLI supports
for this file.

---

## Deviations from the original Sprint 1 spec

Two, both forced and both small:

1. **Super Admin page path.** The spec placed it at `(super-admin)/page.tsx`,
   which resolves to `/` and collides with the public landing page at
   `app/page.tsx`. It lives at `/super-admin` inside the same route group.
2. **`api/auth/[...nextauth]`.** The path is kept as specified, but this is not
   NextAuth — authentication is Firebase. The catch-all serves the Firebase
   support endpoints listed above.

---

## Not built yet (later sprints)

School dashboards, GHL workflow setup, Pakistan-specific features, the full
Super Admin UI, and the GHL OAuth install/callback screens. The token exchange
itself (`exchangeGhlAuthorizationCode`) is implemented in `lib/ghl-client.ts`
and needs a callback route wired to it.

## Deployment note

**The app is deployed on Hostinger**, as a long-lived Node process built with
`output: 'standalone'`. `DEPLOYMENT.md` is the procedure; `STATE.md` carries the
current state of the pipeline and its outstanding panel actions.

Each school is reached at `<slug>.<PLATFORM_BASE_DOMAIN>`, and those hostnames
are **parked domains** on the hosting account, not Hostinger "subdomains" — a
subdomain builds a separate vhost whose requests never reach the Node process.
See `lib/hostinger.ts`. Set every variable from `.env.example` in the hosting
panel.

Never commit `.env.local`. Next.js loads it at server start and it overwrites
variables injected by the host, so a committed file — even one holding only
empty keys — blanks every secret the panel provides.
