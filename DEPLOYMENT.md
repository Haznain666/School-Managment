# Deploying to Hostinger

Target: Hostinger Node.js hosting. The app is a Next.js 15 server — it needs a
running Node process, not static files.

---

## 1. Build artifact

`next.config.mjs` sets `output: 'standalone'`, so `npm run build` emits a
self-contained server under `.next/standalone` with only the `node_modules` it
actually reaches. You do **not** run `npm ci` on the host.

Next does not copy two directories into `standalone` — you must:

```bash
npm run build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
```

Upload the contents of `.next/standalone/`. The entry point is `server.js`.

> Build on a machine with the same major Node version as the host (Node 20+).
> `sharp` ships platform-specific binaries, and a Windows build will not run on
> Hostinger's Linux. If you build on Windows, either build inside WSL/Docker or
> let Hostinger run `npm run build` from a git deploy.

## 2. Start command

```bash
node server.js
```

The standalone server reads `PORT` and `HOSTNAME` from the environment.
Hostinger assigns the port — do not hard-code 3000. If the app starts but the
panel reports it unreachable, set `HOSTNAME=0.0.0.0`; the default binds to
localhost only, which is invisible to the reverse proxy.

## 3. Environment variables

Set every variable from `.env.example` in Hostinger's Node.js app environment
settings.

**Don't upload `.env.local`** — but not for the reason this section used to
give. It claimed a `.env` file *overwrites* platform-injected variables and
that empty keys in one "blank every secret the panel provides". **That is
wrong**, and it was measured wrong on 2026-08-11 against `@next/env` 15.5.22:

| Panel sets | File sets | Process gets |
| --- | --- | --- |
| `from-the-panel` | `from-the-file` | **`from-the-panel`** |
| `from-the-panel` | *(empty key)* | **`from-the-panel`** |
| *(nothing)* | `from-the-file` | `from-the-file` |

dotenv does not replace a variable that already exists in the environment, so
the panel always wins and a file only fills gaps. The reason to keep the file
off the host is narrower: it silently supplies values for anything the panel
*forgot*, so a variable you believe you removed from the deployment is quietly
still set, and a stale secret keeps working long after it should have broken.

The practical consequence when debugging: **if the running process holds a
wrong value, the panel is where it came from.** Deleting `.env` files will not
change it. Confirm with `scripts/check-super-admin-live.sh`, which reads the
running process rather than guessing.

The ones that must carry the real domain:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_APP_DOMAIN` | apex, e.g. `yourdomain.com` |
| `PLATFORM_BASE_DOMAIN` | same apex |
| `INVITE_LINK_BASE_URL` | `https://yourdomain.com` |
| `GHL_REDIRECT_URI` | must match the GHL marketplace app exactly |

Database: use the **transaction pooler** string (port 6543) for `DATABASE_URL`.
See `.env.example` for why.

### `SUPER_ADMIN_PASSWORD_HASH` — the escaping flips between the two places

A bcrypt hash is full of `$`, and the right way to write it **depends on who
reads the file**:

| Where | Write it as |
| --- | --- |
| `.env.local` | `"\$2b\$12\$..."` — `@next/env` runs dotenv-expand, so `$` must be escaped |
| Hostinger's env panel | `$2b$12$...` — raw, no backslashes, no quotes |

Copying the escaped line out of `.env.local` into the panel is the mistake, and
it is invisible: `compare()` in bcryptjs opens with `if (hash.length !== 60)
return false`, so a damaged hash does not throw. It answers "wrong password".
Sign-in returns a bare 401 with nothing in the log to explain it — which reads
as a wrong password, a session problem, or a cookie problem, and is none of
them. This cost a day on 2026-08-10.

To settle it, run one of these **on the host, from the directory holding
`server.js`**. `scripts/` is not part of the standalone artifact, so upload the
one file you need alongside it. Neither prints a secret.

```bash
bash scripts/check-super-admin-live.sh
```

**Prefer this one.** It reads `/proc/<pid>/environ` of the *already running*
server, so it reports the environment the panel actually injected — and it
needs no redeploy. Then it offers to test the password against that hash, with
the terminal echo off.

```bash
node scripts/check-super-admin-env.mjs
```

The portable fallback, for a host without `/proc`. Careful: it reads *its own*
environment, which on a panel-managed host is your SSH session's, not the
server's. It can report "missing" for a variable the server holds. Trust the
`/proc` one when they disagree.

The route now also logs the reason for every refusal
(`[super-admin] sign-in refused. email matched: …; password matched: …`), so a
future occurrence is answerable from the server log alone.

## 4. Database migrations

Migrations do **not** run on deploy. Run them yourself, from your machine,
against the **session pooler** — port 5432 on the *pooler* host. DDL and
advisory locks need one stable session, which the transaction pooler (6543)
cannot promise:

```bash
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" npm run db:migrate
```

Do **not** use the direct connection (`db.<ref>.supabase.co`). Supabase serves
it over IPv6 only unless the paid IPv4 add-on is enabled, so on a normal IPv4
network it fails with `getaddrinfo ENOTFOUND` — which looks like a typo or a
paused project and is neither. Both pooler endpoints are IPv4-reachable.

## 5. School subdomains

Each school is reached at `<slug>.yourdomain.com`, and middleware turns that
subdomain into the tenant's GHL Location ID.

**Confirmed:** Hostinger issues HTTPS automatically for subdomains created in
hPanel.

**Implication to be aware of:** that is per-subdomain issuance, not a wildcard
certificate. A school created in the Super Admin panel is not reachable until
someone also adds its subdomain in hPanel — so onboarding a school has a manual
hosting step. That is fine at tens of schools and painful at hundreds.

If self-service onboarding is wanted later, put Cloudflare in front: a wildcard
DNS record plus their Universal SSL covers `*.yourdomain.com` at the edge, with
Hostinger holding a single origin hostname. No application code changes — the
tenancy resolution in `middleware.ts` already works either way.

**Fallback if a subdomain is ever unavailable:** the app still resolves a tenant
from `?school=<slug>`, remembered afterwards in a `school_slug` cookie. That
path is implemented and tested, so a missing subdomain degrades rather than
breaks.

## 6. Post-deploy checks

Sign in as Super Admin and open:

- `/api/super-admin/diagnostics/database` — reports which database the running
  process is actually connected to, and whether migrations are applied. The
  host it prints should be the Supabase pooler.
- `/api/super-admin/diagnostics/storage` — confirms the bucket exists, is
  public, and that the service_role key (not the anon key) was pasted.

Both are guarded by the Super Admin cookie and touch no tenant table, so they
still answer when everything else is failing — which is when they are needed.
