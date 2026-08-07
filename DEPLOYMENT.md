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

**Never upload `.env.local`.** Next.js loads it at server start and it
*overwrites* platform-injected variables — a committed or uploaded file, even
one holding only empty keys, blanks every secret the panel provides. This has
bitten this project before; it is why `.gitignore` covers it.

The ones that must carry the real domain:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_APP_DOMAIN` | apex, e.g. `yourdomain.com` |
| `PLATFORM_BASE_DOMAIN` | same apex |
| `INVITE_LINK_BASE_URL` | `https://yourdomain.com` |
| `GHL_REDIRECT_URI` | must match the GHL marketplace app exactly |

Database: use the **transaction pooler** string (port 6543) for `DATABASE_URL`.
See `.env.example` for why.

## 4. Database migrations

Migrations do **not** run on deploy. Run them yourself, from your machine,
against the **direct** connection (port 5432 — DDL and advisory locks need one
stable session, which the transaction pooler cannot promise):

```bash
DATABASE_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" npm run db:migrate
```

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
