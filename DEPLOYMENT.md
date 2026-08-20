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

**`HOSTNAME` must be `0.0.0.0`, and not a loopback address.** Measured against
the standalone artifact on 2026-08-11:

| `HOSTNAME` | Redirect `Location` from middleware |
| --- | --- |
| `0.0.0.0` | `/super-admin/login` — relative, correct behind any proxy |
| `127.0.0.1` | `https://localhost:3400/super-admin/login` — **absolute and wrong** |

With a loopback value, Next emits absolute redirects built from the bind
address, so every middleware bounce — an unauthenticated deep link, an expired
session — sends the visitor's browser to `localhost`. `Host` and
`X-Forwarded-Host` are both ignored; the bind address is what decides. The
login page itself still loads when typed directly, so this presents as
"sometimes it throws me somewhere strange" rather than an obvious break.

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

### ⚠️ On Hostinger, the panel and the `.env` file are ONE store

**Measured 2026-08-11, the hard way.** This section and STATE.md §5u both used
to describe the panel and `.env` as two stores with the panel winning. On
Hostinger they are the same thing: **deleting `.env` in File Manager also
deletes every entry from the Node.js app's Environment variables screen.**

Consequences:

- Add and remove variables **only through the Environment UI**. Editing or
  deleting the file in File Manager silently edits the panel.
- The precedence table below still describes `@next/env` correctly, but it
  cannot be used to reason about this host, because there is no second store
  for it to arbitrate.
- The site survives the deletion until the next restart — a running process
  holds its environment in memory. It is the **restart or redeploy** that takes
  it down, which makes the damage look unrelated to its cause.

### Pushing to `main` deploys to production automatically

The git-connected deployment builds on every push to `main` — confirmed
2026-08-11: a push at 20:37:11 started build `019ff28b` within seconds.

There is no manual gate. `.github/workflows/deploy.yml` (§5b) is *additional*,
not the only path. **`NEXT_PUBLIC_*` are inlined at build time**, so they must
be present in the panel before any push, or the bundle ships wrong values.

### `SUPER_ADMIN_PASSWORD_HASH` — repaired on read since 2026-08-11

**The escaping question no longer decides whether sign-in works.**
`normalizeBcryptHash()` in `lib/super-admin-hash-shape.ts` strips wrapping
quotes and backslashes that escape a `$`, so the escaped `\$2b\$12\$…` form,
quoted forms, and stray whitespace all verify. Measured against real bcrypt:
63, 62, 65 and 61-character damaged forms all repair to 60 and pass.

It is a repair, not a guess: a bcrypt hash draws from `$ . / A-Z a-z 0-9`, so a
backslash there is impossible except as transport damage. A hash whose `$`
segments were genuinely *expanded away* is **not** repaired — those bytes are
gone — and still fails loudly.

Still paste the **raw** form. The boot log now says when it repaired something,
precisely so a working deployment does not hide a misconfigured panel.

### The original escaping guidance, kept because it explains the history

A bcrypt hash is full of `$`, and the right way to write it **depends on who
reads the file**:

| Where | Write it as |
| --- | --- |
| `.env.local` | `"\$2b\$12\$..."` — `@next/env` runs dotenv-expand, so `$` must be escaped |
| Hostinger's env panel | `$2b$12$...` — raw, no backslashes, no quotes |

**Single-quoting does not save you in a `.env` file.** Measured 2026-08-11:
`SUPER_ADMIN_PASSWORD_HASH='$2b$12$…'` resolved to a **36-character** value,
because dotenv strips the quotes and *then* expands `$2b` and `$12` as
variables. Only the `\$` escaping works there.

The corollary is the thing to check on any host: **the value the panel shows is
not necessarily the value the process holds.** If anything between the two
performs expansion, a raw hash arrives shortened and prefix-less. Compare
fingerprints rather than trusting the panel — see below.

**Where the backslashes came from.** Until 2026-08-11, `npm run hash-password`
printed *only* the escaped form, labelled "the SUPER_ADMIN_PASSWORD_HASH line",
with nothing to say it was escaped or that a panel wanted it otherwise. Pasting
that output into Hostinger — the obvious thing to do with it — stored 63
characters and three backslashes. The script now prints both forms and says
which goes where; if you generated a hash before that change, regenerate it.

The failure is invisible either way: `compare()` in bcryptjs opens with
`if (hash.length !== 60) return false`, so a damaged hash does not throw. It
answers "wrong password". Sign-in returns a bare 401 with nothing in the log —
which reads as a wrong password, a session problem, or a cookie problem, and is
none of them. This cost four sessions across 2026-08-10 and 2026-08-11.

### Asking the deployed process directly (no SSH needed)

The checks below run *beside* the server. When the question is specifically
"what does the **deployed process** hold", ask it:

1. Set `SUPER_ADMIN_DIAGNOSTICS_SECRET` in the panel to any long random string
   and restart. Without it the endpoint is disabled and answers 503.
2. Call it:

```bash
curl -s -X POST https://YOUR-DOMAIN/api/internal/super-admin-check -H "Content-Type: application/json" -H "x-diagnostics-secret: THE-SECRET" -d '{"email":"you@example.com","password":"the-password"}'
```

It answers from inside the running process: the pid and uptime serving that
request, the configured email, the hash's length, prefix and **fingerprint**,
which `.env` files exist beside it, and whether bcrypt accepts that password
*there*. It returns no hash, no secret and no password — only booleans and
shapes.

Compare `passwordHash.fingerprint` with `npm run fingerprint` over the value in
your panel. Equal fingerprints prove the process holds exactly what you pasted;
different ones prove it does not, which length and prefix alone can never show.

Call it two or three times and watch `process.pid`. **A changing pid means more
than one instance is behind the proxy**, and they need not hold the same
environment — one restarted after your edit and one did not.

**Unset the secret once the deployment is healthy.** It is a debugging
instrument, not a feature.

### Checks that run beside the server

Run one of these **on the host, from the directory holding `server.js`**. `scripts/` is not part of the standalone artifact, so upload the
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

### `SMTP_PASS` — why a correct password returns 535 in production

**Measured 2026-08-19.** Outbound mail failed with
`535 5.7.8 Error: authentication failed` on every message from 2026-08-13, while
the identical credentials authenticated against `smtp.titan.email` locally on
the first attempt, on both ports. The password was re-verified by the operator
more than once and was **correct every time**. It was never the problem.

The mailbox password contains `!`, `@` and `#`. In a `.env` file an unquoted `#`
**opens a comment**, so everything from it onward is silently discarded.
Measured against this repository's own `@next/env`:

| Written as | What the process receives |
| --- | --- |
| `SMTP_PASS=fooBar!x@y#z` | `fooBar!x@y` ← **truncated, silently** |
| `SMTP_PASS='fooBar!x@y#z'` | `fooBar!x@y#z` |

Now read that against the section above: **on Hostinger the panel and the `.env`
file are one store.** A password typed into the Environment UI is written into a
`.env` line, and if it contains a `#` the rest of it does not survive. The panel
goes on displaying the whole password, which is why inspecting it proves
nothing and why this was diagnosed three times as "the panel's copy is wrong".

The mirror-image mistake is copying the working single-quoted form *out* of
`.env.local` and into the panel **including its quotes** — nothing strips them
there, and the mailbox receives two characters it has never heard of.

**The fix, and it is not a workaround:**

```
SMTP_PASS_B64=<npm run smtp-encode>
```

Base64's alphabet is `A-Z a-z 0-9 + / =`. No `#`, no `$`, no `!`, no quote, no
backslash — nothing for dotenv, a shell or a panel to act on. It wins over
`SMTP_PASS` when both are set, exactly as `SUPER_ADMIN_PASSWORD_HASH_B64` does.
Generate it with `npm run smtp-encode`, which prompts with the echo off and
prints a fingerprint. **Then remove `SMTP_PASS` from the panel** and restart.

`lib/smtp-credentials.ts` additionally repairs the damage that *is* reversible
— wrapping quotes and stray whitespace — and refuses to touch a value where the
quote could legitimately be data. `npm run check-smtp` asserts both halves (28
assertions, no network). The boot log now says which state it is in:

```
[smtp] SMTP_PASS_B64 decoded cleanly (17 chars). This is the transport-safe form.
[smtp] SMTP_PASS is set as plain text and contains "#", "!" — ...
```

### Asking the deployed process what password it actually holds

```bash
curl -sX POST https://schoolhub.codexmill.com/api/internal/smtp-check \
  -H "x-diagnostics-secret: $SUPER_ADMIN_DIAGNOSTICS_SECRET" \
  -H 'content-type: application/json' \
  -d '{"verify":true}'
```

The sibling of `/api/internal/super-admin-check`, and the only check that proves
anything: every other one reads some other environment. It returns the
password's **length** and **fingerprint** (never the password), which fragile
characters it contains, which variable it came from, and — with
`{"verify":true}` — the SMTP server's own reply to a real AUTH, sending nothing.

Compare `password.fingerprint` with what `npm run smtp-encode` prints locally.
**Different fingerprints mean the process is not holding the password you
entered**, and a `password.length` shorter than the real one is the `#`
truncation above. Call it twice: more than one Node process has been observed
behind this proxy and they need not hold the same environment.

Requires `SUPER_ADMIN_DIAGNOSTICS_SECRET`; refuses everything while unset.
**Unset it once mail is flowing.**

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

## 4b. Automatic subdomain provisioning — parked domains, NOT subdomains

Set `HOSTINGER_API_TOKEN` and `HOSTINGER_USERNAME` and creating a school
automatically creates `<slug>.<PLATFORM_BASE_DOMAIN>`. Leave them unset and
every school reports **Manual** — a supported state, not a failure.

**⚠ The single most important fact here.** Hostinger offers two features that
sound interchangeable and are not. Measured 2026-08-11:

| | Creates | Serves | Reaches Node? |
| --- | --- | --- | --- |
| **Subdomain** | separate LiteSpeed vhost, own docroot | PHP | ❌ **never** |
| **Parked domain** | alias of the parent website | the Node app | ✅ yes |

A subdomain resolves, gets its own certificate, and still cannot serve the
tenant — everything looks right and nothing works. `lib/hostinger.ts` calls the
parked-domain endpoint only, and deliberately does not wrap the delete endpoint,
so no retry can remove a working domain.

Verified end to end: `credo.schoolhub.codexmill.com` parked against
`schoolhub.codexmill.com` answered `/login` with the tenant's sign-in page
(`X-Powered-By: Next.js`); the platform host answered the same path with
"School not found". TLS issued automatically ~3 minutes after creation.

**The token.** hPanel → API → generate, with **write access to hosting /
websites**. It can create and delete domains — treat it as a credential.

**Statuses** (`schools.subdomain_status`, migration 0021): `pending` ·
`provisioning` · `ready` · `failed` · `unmanaged`. Provisioning is idempotent —
the Provision / Re-check button on the schools list is safe to press any number
of times, and is also how schools created before this feature get reconciled.

### ⚠ A wildcard DNS record makes provisioning *look* done when it is not

**Fixed 2026-08-19; read this before adding a wildcard.** Provisioning has two
halves — the parked domain (a vhost alias) and the DNS record — and since the
existence check became "does the name resolve?", a wildcard in the zone breaks
it. A wildcard answers **every** label by definition, so a school created
seconds ago resolves immediately, `ensureDnsRecord` concludes its record is
already in place, writes nothing, and reports success.

What that looks like, and it is exactly what was reported for
`rehearsal-academy.schoolhub.codexmill.com`:

- the parked domain appears in hPanel,
- hPanel reads **"Not connected"**, because it looks for a record for that exact
  name and there is none,
- **no HTTPS certificate is ever issued**, because those are issued per
  hostname against a name the panel can see pointed at this account, and a
  wildcard is not that,
- and the platform records `subdomain_status = 'provisioning'` with
  `subdomain_error` **null** — success, as far as it knew.

`nameHasOwnRecord()` in `lib/hostinger.ts` now separates the two: it resolves a
random `wildcard-probe-*` label first, and a zone that answers *that* cannot be
trusted to say whether any particular name is provisioned, so the Hostinger API
decides instead and the explicit record gets written. With no wildcard present
the probe fails and behaviour is identical to before — this cannot regress a
zone that does not have one.

The retry control gained a fourth readiness state, `wildcard-only`, which says
so in one line instead of reporting the misleading `tls-pending` ("wait a couple
of hours for the certificate") for a certificate that is never coming.

**Press Provision / Re-check on any school stuck at "Not connected"** once this
is deployed; it is idempotent and will write the missing record.

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

## 5b. Automated deploy (GitHub Actions)

`.github/workflows/deploy.yml` does everything in §1–§2 and then verifies the
result. Run it from the **Actions** tab → *Deploy to Hostinger* → *Run
workflow*. It is `workflow_dispatch` only: deploying to production should be a
decision, not a consequence of merging.

It builds on Ubuntu — which is the point, since `sharp` ships platform-specific
binaries and a Windows build cannot run on the host — copies `.next/static`
(and `public/` if it ever exists) into `standalone`, rsyncs the tree over SSH,
restarts the app, waits, and then runs the smoke test below. A failing smoke
test fails the workflow, so a deploy cannot report success over a broken site.

### Secrets to set

**Settings → Secrets and variables → Actions.** They are encrypted, and they go
in that page — never into a chat, an issue, or a commit.

| Secret | What it is |
| --- | --- |
| `HOSTINGER_HOST` | SSH hostname or IP |
| `HOSTINGER_USER` | SSH username |
| `HOSTINGER_PORT` | SSH port. Blank means 22 — **which is usually wrong on Hostinger shared hosting**, where SSH commonly listens on **65002**. hPanel → Advanced → SSH Access has the real one |
| `HOSTINGER_SSH_KEY` | **private** key of a deploy keypair — generate a fresh one, do not reuse a personal key |
| `HOSTINGER_PATH` | absolute path of the directory holding `server.js` |
| `HOSTINGER_RESTART_COMMAND` | optional. Command that restarts the app. If blank the upload still happens and nothing restarts — but the deploy now **measures** whether the new build started serving and fails if it did not, so a blank value can no longer be mistaken for a successful deploy |
| `NEXT_PUBLIC_APP_DOMAIN` | **baked into the build.** `app/page.tsx` is prerendered, so this ends up in the static homepage HTML. Unset, the platform says `platform.com` everywhere and the panel cannot correct it |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | optional, but **baked into the build** — read by `AddressAutocomplete`, a client component. Unset, the address field falls back to plain text with a line saying why, which is what production does today. The panel cannot switch it on afterwards |
| `PRODUCTION_URL` | e.g. `https://schoolhub.codexmill.com`. Without it neither the smoke test nor the build-id check can run, and the deploy cannot say whether it deployed |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL` | optional. Passed to the build for safety, but both are read at runtime from the panel's `.env`; `publicEnv.supabaseAnonKey` is currently read by nothing |
| `SMOKE_SUPER_ADMIN_EMAIL`, `SMOKE_SUPER_ADMIN_PASSWORD` | optional; enables a real sign-in assertion after each deploy |

### Everything else stays in Hostinger

**This list is short on purpose.** `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SMTP_*`, `GHL_*` and the rest are **not** repository secrets and must not be
copied here. The application reads them through `serverEnv` /
`requireServerEnv`, which are `process.env[name]` — a dynamic lookup Next.js
cannot inline — so they are read on the host, from the panel's `.env`, every
time. Duplicating them into GitHub would create a second copy that silently
goes stale.

Only two kinds of value have to be repository secrets:

1. **How to reach the host** — the SSH four. They cannot live on the host,
   because they are what gets you *to* the host.
2. **What Next.js freezes into the artifact** — `publicEnv` in `lib/env.ts`
   references `process.env.NEXT_PUBLIC_X` as a literal, and the compiler
   substitutes the value. Setting those in the panel afterwards changes nothing
   about a bundle that has already been built.

Generate the deploy key with `ssh-keygen -t ed25519 -f deploy_key -N ""`, put
the **public** half in the host's `~/.ssh/authorized_keys` and the private half
in `HOSTINGER_SSH_KEY`.

> ### These names, not the ones in the error log
>
> A failing step prints its **env var** names, which are deliberately different
> from the **secret** names:
>
> ```
> env:
>   SSH_PRIVATE_KEY:      <- the env var inside the step
>   SSH_HOST:
>   SSH_PORT:
> ```
>
> Those are `HOSTINGER_SSH_KEY`, `HOSTINGER_HOST` and `HOSTINGER_PORT` in the
> table above. On 2026-08-20 that log was read exactly as it reads and three
> secrets were created called `SSH_PRIVATE_KEY`, `SSH_HOST` and `SH_PORT` — two
> under the wrong name, one under a typo, none of them visible to the workflow,
> and the next run failed identically.
>
> The **Check the deploy secrets are set** step now runs first and names the
> missing secrets, so this costs one line of log rather than a rerun.

## 5c. Smoke test

```bash
npm run smoke-test https://schoolhub.codexmill.com
```

Exits non-zero when the deployment is not healthy. It checks reachability, that
`/super-admin` actually redirects when unauthenticated, that the redirect does
not point at the bind address (§2), and — without needing any credentials — it
sends a deliberately wrong password and reads the status:

| Response | Meaning |
| --- | --- |
| `401 invalid_credentials` | route healthy, env present, bcrypt ran |
| `500 server_misconfigured` | a `SUPER_ADMIN_*` variable is missing from the process |
| `429` | throttled; retry in 15 minutes |

That single distinction is the diagnosis this project spent four sessions
failing to make by hand. Given `SMOKE_SUPER_ADMIN_EMAIL` and
`SMOKE_SUPER_ADMIN_PASSWORD` it also performs a real sign-in and asserts the
cookie comes back `HttpOnly`, `Secure` and `SameSite`. Neither value is printed.

## 6. Post-deploy checks

Sign in as Super Admin and open:

- `/api/super-admin/diagnostics/database` — reports which database the running
  process is actually connected to, and whether migrations are applied. The
  host it prints should be the Supabase pooler.
- `/api/super-admin/diagnostics/storage` — confirms the bucket exists, is
  public, and that the service_role key (not the anon key) was pasted.

Both are guarded by the Super Admin cookie and touch no tenant table, so they
still answer when everything else is failing — which is when they are needed.
