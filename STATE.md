# STATE.md — development state

**Purpose:** the handover file. Any new Claude session reads this first and can
resume without re-deriving context. Updated at the end of every development
step, before the session ends.

**Last updated:** 2026-08-28 (**Sprint 18 — a challan is a Voucher, concession
schemes the school owns, student CRUD as four permissions, and the family
voucher as three steps — §5bg. `0034` APPLIED and verified, 34 rows → 35.
**DEPLOYED AND LIVE as `02904e373dc3`**, PRs #37 and #38 merged.

⚠ **#37 shipped a 500.** `/dashboard/admissions/students` was down at every
school on `dbe7571156cb` — `listStudents` aliased a raw-`sql` subquery column
`phone` and Drizzle emits those *unqualified*, so it collided with the joined
`school_users.phone`: Postgres 42702, `column reference "phone" is ambiguous`.
**This is the second time that exact Drizzle behaviour has shipped a defect**
— §5av is the first. Alias to a name no joined table has, and qualify it.
Nine green gates could not see it because none of them executes a query; §5bf
had recorded, in its own words, that the phase was never driven in a browser.
#38 is QA's fix for it plus four more.

⚠ **`npm run build` caught what nothing else could** — a `'use client'` table
value-importing from a `server-only` module. A bundling fault is invisible to
typecheck, lint and all eight check scripts. Do not treat the build as the slow
gate to skip.

⚠ **One row was left at LGS and it is money**: a 5,000.00 unspent credit on
Student 11, needing a human's `DELETE`. See §5bg.**;
2026-08-27 (**Sprint 17 — onboarding, the admission fee, and
the discount that never applied — §5be. `0033` APPLIED and verified.
**DEPLOYED AND LIVE as `51c185f367cd`**, PR #33 merged. Four defects found by QA
driving the fee module against real data, plus one caught in review; all five
fixed and re-verified. The live origin returned `status=000` for forty minutes
after the merge and it was **not** the deploy — two untouched sibling sites on
the same host failed identically.**;
2026-08-26 (**Sprint 16 — school feedback both ways, global
search on all five portals, the setup-progress panel, and three dashboard
fixes — §5bd. `0032` APPLIED and verified. **DEPLOYED AND LIVE as `47e072c1f058`**,
PR #32 merged, cache purged and the commit confirmed by the workflow. The second
scrollbar was `sr-only`: it is `position: absolute`, and with no positioned
ancestor those spans escaped `<main>`'s `overflow-y` and grew the document
behind it.**;
2026-08-24: **Mail delivery: no invitation had sent since
2026-08-20 — production held a 31-character `SMTP_PASS_B64` where the working
password is 17, with a shadowed `SMTP_PASS` beside it. Fixed; outbox drained.
The Mapbox dropdown and the wizard past step 1 are both verified live, and the
expired Hostinger token that turned the 429 into a 401 is replaced — §5bc.**;
2026-08-23: **Sprint 15 — the school creation wizard, the 429
recorded as a refusal, the clipped address list, dashboards on all five portals,
and one table primitive across thirty listings — §5az, §5ba, §5bb, §5bc.
`0031` APPLIED and verified. Merged to `main` as `9dfb735`.**;
2026-08-22: **Sprint 14 — exam terms, datesheets, descriptors
and promotion, §5ay. `0029` and `0030` APPLIED; fifteen QA defects fixed.**;
**The deploy was never blocked and the probe that
would have said so was gitignored — §5ax**; WhatsApp removed from the platform,
the invite form's phone field unblocked, the dashboard outage, and the login
error that named nothing — §5aw. `0027` and `0028` are both APPLIED to the live
database.**; 2026-08-21: Sprint 13.5 — §5au, driven end to end — §5av;
2026-08-20: Sprint 13.8 — sibling identity, §5as; the announcement sweep, §5at;
Sprint 13.7 — §5ar; 2026-08-19: §5aq, §5ap, §5ao, §5an, §5am, §5al, §5ai–§5ak)

> ✅ **Sprint 16 is DEPLOYED AND LIVE — 2026-08-26.** `/api/internal/build`
> answers `{"buildId":"47e072c1f058"}`, which is the merge commit, and every
> prerendered page carries `<!--47e072c1f058-->`.
>
> The sequence, and it is the one to repeat: migration first and verified,
> branch pushed, PR #32 opened and merged, `main` pushed, then **watch the build
> id change** rather than assuming. It took **three minutes** — the origin
> restarted at 13:32:36 still on `232f8af` and came back at 13:35:30 on
> `47e072c1f058`, so a probe taken in the first two minutes would have read the
> old build and looked like a failed deploy. Poll it.
>
> *Verify the live deployment* then ran green end to end: **Cache cleared (HTTP
> 200)**, `expected: 47e072c1f058` / `live: 47e072c1f058`, and the smoke test
> passed. The three new platform endpoints answer **401**, not 404, which is
> what proves the new routes are actually on the host and guarded.
>
> ⚠ **Do not run the verification immediately after a purge on a cold origin.**
> The second deploy that day (`762f1017f5fe`, the docs) was purged at 13:43:44
> and probed at 13:44:39, and the probe returned `status: 000000` /
> `live: <no answer>` — a curl timeout while the freshly restarted origin warmed
> up, **not** an old build. Re-run a minute later: `status: 200`, expected and
> live both `762f1017f5fe`, everything green, and a hand probe in between
> answered in 0.5s.
>
> This is precisely the ambiguity §5bc's fix was written for, and it behaved:
> the step reported what it saw and **did not assert a cause**. Read the status
> code before concluding anything about the deploy — `000` is the network, not
> the build.

> ✅ **Migration `0032` is APPLIED to the live database — 2026-08-26.** The
> bookkeeping table held 32 rows before and **33** after. Verified against the
> real schema rather than trusting the success message: four tables with
> exactly the expected columns (13 / 7 / 7 / 10), five CHECK constraints, seven
> foreign keys and seven indexes — and then the constraints were made to *fire*
> inside a transaction that was rolled back, because a CHECK in the catalogue
> that nobody has tested is a CHECK nobody has tested. An invented status, an
> invented nature, an invented audience and a school notification with no
> recipient were all refused; a platform notification with no recipient was
> accepted, which is the asymmetry the schema intends. Nothing was left behind.
>
> It is expand-only: four new tables, no column changed and no row rewritten.
> It had to go in **before** the merge for the reason §5aw records — both portal
> layouts grow an unread-notification count, and a layout runs on every page of
> its portal. Both reads are wrapped anyway.
>
> ⚠ **The first run of the verification script reported a false failure.** A
> statement that errors aborts the whole Postgres transaction, so the second
> expected-refusal test failed with the *first* one's error still in effect and
> read as a missing constraint. Each expected failure now runs inside its own
> `SAVEPOINT`. Write refusal tests that way or do not write them.
>
> ~~Next free migration number is `0033`.~~ **`0033` is taken — Sprint 17. The next free number is `0034`.**

> ✅ **Migration `0031` is APPLIED to the live database — 2026-08-23.** The
> bookkeeping table held 31 rows before and **32** after. Verified against the
> real schema rather than trusting the success message: the CHECK on
> `schools.subdomain_status` now carries `throttled`, and a real
> `UPDATE … SET subdomain_status = 'throttled'` was run inside a transaction,
> accepted, and rolled back — the row was left exactly as found.
>
> It is expand-only: one CHECK widened, no column changes, no row changes. It
> had to go in **before** the merge, because `provisionSchoolSubdomain` writes
> `throttled` the first time a school is created after this deploys and that
> write fails against the old constraint. Applying it while the old build was
> still live cost nothing, since nothing yet wrote the value.
>
> ~~Next free migration number is `0032`.~~ **`0032` is taken — see the Sprint
> 16 banner above. The next free number is `0033`.**
>
> ⚠️ **`STATE.md` said "next free is `0030`" for a day while `0030` already
> existed on disk.** Sprint 15 took `0031` and this line is now the record.
> Check `db/migrations/` before trusting a number in prose, including this one.

> ✅ **Migration `0029` is APPLIED to the live database — 2026-08-22.** The
> bookkeeping table held 29 rows before and **30** after. Verified against the
> real schema rather than trusting the success message: seven tables created,
> ten columns added, `exam_terms.start_date`/`end_date` now nullable, the four
> default result sub-categories seeded for the one existing school,
> `results.promotion` present in the `role_permissions` CHECK, and
> `exam_schedule_grades_term_grade_idx` partial on `archived_at IS NULL` — the
> last of those is what lets an archived schedule release its grades instead of
> locking them out of the term for good.
>
> **`0029` had to go in before the merge, not after.** `app/(teacher)/layout.tsx`
> awaits `listClassTeacherSections`, which reads `sections.class_teacher_id`. A
> layout runs on every page of the teacher portal and that call is unguarded, so
> deploying Sprint 14 against the old schema would have 500'd the whole portal —
> §5aw again, one module over. The migration is expand-only, so applying it
> while the *old* code was still live cost nothing: the running build did not
> know these tables existed.
>
> **Next free migration number is `0030`.**

> ✅ **Migrations `0027` and `0028` are APPLIED to the live database —
> 2026-08-22.** `npx drizzle-kit migrate` against the pooler host on port
> **5432** (session mode — 6543 is what the app uses and will not do DDL; see
> §5c). The bookkeeping table held 27 rows before and 29 after.
>
> `0027` is Sprint 13.5's accounting schema: six tables, the three accounting
> permission keys, the seeded chart of accounts, and the backfill of every fee
> payment ever recorded. Until this ran, **the accounting module had no tables**
> — and that is not a quiet absence. `getAccountingOverview` is called by the
> **school-admin dashboard**, inside a `Promise.all`, so the missing
> `ledger_transactions` threw and took the entire dashboard down with it: the
> screen an administrator lands on rendered as "Could not load the dashboard"
> and a digest, at a school where every screen behind it worked. See §5aw.
>
> `0028` removes WhatsApp from the database — the `school_modules` row and its
> CHECK constraint, `school_invitations.whatsapp_sent` and
> `whatsapp_message_id`, and the `'whatsapp'` value on
> `announcement_recipients.channel`. Delivery-log rows are **re-labelled to
> `'notice'`, not deleted**: they are the school's record of what it told which
> parent and when.
>
> ~~Next free migration number is `0029`.~~ **`0029` is taken — see the Sprint 14
> banner above. The next free number is `0030`.**

> ✅ **Deploying is automatic, and the SSH secrets are dead — 2026-08-22.**
> hPanel has this site connected to the repository with **Auto-deployment on**,
> branch `main`, root `./`. The merge `17099d4` built at 16:52 in 2m29s, state
> Completed, and the live HTML carries `<!--17099d4dec24-->`.
>
> `HOSTINGER_SSH_KEY`, `HOSTINGER_HOST`, `HOSTINGER_PORT`, `HOSTINGER_PATH` and
> `HOSTINGER_USERNAME` are leftovers from the rsync workflow that #24 deleted.
> **Nothing reads them.** This file said for two days that the deploy was
> blocked on them; it was not, and saying so cost a session.
>
> `deploy.yml` is now *Verify the live deployment* and does not deploy. The
> three secrets it reads — `PRODUCTION_URL`, `HOSTINGER_API_TOKEN`,
> `HOSTINGER_USER` — are set. **Only `SMOKE_SUPER_ADMIN_EMAIL` and
> `SMOKE_SUPER_ADMIN_PASSWORD` are missing**, and only the smoke-test step uses
> them.
>
> **Still do the cache purge after every deploy.** Prerendered pages ship
> `s-maxage=31536000`.

> 🐛 **The day book threw on every call, and shipped that way — found and fixed
> by QA on 2026-08-21, §5av.** `column reference "id" is ambiguous`. **Drizzle
> renders a column interpolated into a `sql` template unqualified when the outer
> query has a single table in its `FROM`**, and qualified once a join is present
> — so five correlated sub-selects that are correct beside a join were bare
> column names without one. One was ambiguous and Postgres refused it; the one
> beside it compared two `ledger_entries` columns and would have printed a
> column of zeroes had the query survived.
>
> ⚠ **`npm run check-reports` is the only thing in this repository that would
> ever have said so — and it was failing for an unrelated reason.** It asserted
> nine reports; 13.5 added seven and did not update the count. It needs a
> database, so it is not in CI. **Run it after touching any runner.**

> 🐛 **No scheduled announcement had ever been released, at any school, since
> Sprint 11 — fixed 2026-08-20 (§5at).** `lib/announcement-queries.ts` compared
> the due time with a raw `` sql`` `` template, which is the one construct where
> Drizzle has no column to map the value against — so the JavaScript `Date` went
> to postgres-js untouched and every sweep threw `ERR_INVALID_ARG_TYPE` before
> reading a row. `lte(column, now)` maps it to an ISO string first.
> **Reproduced against the live database before and after:** the generated SQL
> is byte-identical to the production log, the raw form fails 3 of 3 runs, `lte`
> succeeds 3 of 3.
>
> This is the error this file has dismissed as "pre-existing and unrelated" in
> §5ar and twice before it. It was neither.

> ⚠ **Production runs SEVEN scheduler processes, not one.** The log shows the
> 60-second sweep at seven distinct offsets within each minute (…:05, :14, :27,
> :27, :35, :48, :55, repeating exactly). `instrumentation.ts` starts one per
> server process. **Fixing the query alone would have shipped a 7x email bug:**
> all seven would have read `scheduled`, passed the old
> `if (status === 'sent')` check, and queued a full email run each —
> `announcement_recipients` de-duplicates on a unique key but `email_outbox` does
> not, so seven runs are seven emails to every parent. `sendAnnouncement` now
> claims its row with a conditional `UPDATE … WHERE status <> 'sent' RETURNING
> id` and reverts on failure. **Verified with seven simultaneous claims against
> the live table: exactly one won.**

> ✅ **DEPLOYED AND LIVE, 2026-08-20.** Sprint 13.8 (sibling identity, §5as) and
> the announcement-sweep fix (§5at) are both serving. Proven by the build id at
> `/super-admin/login` moving from `F0I8X3x6DwUmW54YEsSig` to
> `CzQgh6S8PQoqClztHso6u` across the deploy, and by the homepage rendering
> `schoolhub.codexmill.com` rather than the `platform.com` fallback — which is
> what proves the build-time `NEXT_PUBLIC_APP_DOMAIN` secret took.
>
> **The deploy workflow now works end to end.** It took four failures to get
> there, each a different thing, and each one is now self-diagnosing rather than
> silent:
>
> | Failed at | Cause | Fixed by |
> | --- | --- | --- |
> | Authorise the deploy key | secrets created under the step's *env var* names (`SSH_HOST`…), not the secret names | preflight step that names every missing secret before the build |
> | Authorise the deploy key | nothing listening on port 22; `HOSTINGER_PORT` unset | `2>/dev/null` removed from `ssh-keyscan`, which had been hiding the reason |
> | Upload the artifact | `rsync` creates only the last directory; the parents of `HOSTINGER_PATH` did not exist | `mkdir -p` over the same SSH connection first |
> | (would have been) Verify | `smoke-test-live.mjs` exits 2 with no origin, failing a deploy that had already succeeded | absent `PRODUCTION_URL` skips the check with a warning |
>
> ⚠ **Every step env var now carries the same name as the secret behind it.**
> They were `SSH_PRIVATE_KEY` / `SSH_HOST` / `SSH_PORT` / `DEPLOY_PATH` /
> `RESTART_COMMAND`, which is what a failing step prints — and that is exactly
> how three unusable secrets came to be created. Do not reintroduce the split.
>
> ✅ **Cache purge: endpoint and method settled, 2026-08-21.**
> `DELETE /api/hosting/v1/accounts/{username}/websites/{domain}/cache/clear`,
> `Authorization: Bearer <token>` — both from Hostinger's own API SDKs
> (`clear_website_cache_v1` on `HostingCacheApi`), not guessed.
>
> The earlier candidate-loop version was a workaround and produced another red
> run, **but its output named the answer**: three paths returned 404 and
> `cache/clear` returned **405 Method Not Allowed** — a path that exists,
> rejecting the verb. The path was always right; POST was always wrong.
>
> ⚠ **Still blocked on the token.** With the real secret the API replies
> `{"message":"Unauthenticated."}` — the same string an unauthenticated client
> gets. Endpoint, method and scheme are all confirmed by the 401 itself (a wrong
> path gives 404, a wrong verb gives 405). So `HOSTINGER_API_TOKEN` is not a
> valid Hostinger **API** token, or is stored with quotes/whitespace around it.
> Test it outside GitHub before touching the workflow again:
>
> ```
> curl -i -H "Authorization: Bearer $TOKEN" >   https://developers.hostinger.com/api/hosting/v1/accounts
> ```
>
> 200 ⇒ the token is fine and the GitHub secret is malformed. 401 ⇒ the token is
> wrong; generate one at hPanel → API with Hosting scope.
>
> Until it works, **press Clear website cache in hPanel after every deploy** —
> this is not optional, see the year-long TTL above.

> ⚠ **The purge is verified, not trusted.** `Age` is read before and after; a
> 2xx that leaves the edge serving an equally old copy fails the step. Do not
> replace that with a status-code check — an API that returns success and
> changes nothing is the failure this exists to catch.

> 🔴 **THE DEPLOY WORKFLOW UPLOADS TO A PLACE THE RUNNING APP DOES NOT SERVE
> FROM — found 2026-08-21, and it invalidates every "deployed" claim above.**
>
> Run `32424514882` built and uploaded `Iwrd9bUQ0XAqcQJcKVEWO`. Two minutes
> later, and stable for six minutes after that, the host was serving
> **`AwZbOojWVOxme4EitSUoi`** and the route added in that very build,
> `/api/internal/build`, answered **404** on both hosts. The artifact never
> arrives.
>
> **Code still reaches production — by something else.** Sprint 13.8 is live
> (`/api/school/guardians/lookup` answers 401), and the live build id has changed
> four times today with no workflow run in between. Hostinger is building and
> deploying from the repository on its own cadence. The rsync is redundant at
> best, and at worst writes into a directory that is then rebuilt over.
>
> **So `HOSTINGER_PATH` is pointing at the wrong directory**, or the host rebuilds
> on top of whatever is placed there. Next step is hPanel → the Node.js
> application → its root directory, and either point `HOSTINGER_PATH` at that or
> delete the upload steps and let Hostinger's own deploy be the deploy.
>
> ⚠ **This was invisible until today**, because the check that was supposed to
> catch it was reading a CDN-cached page — see below. The workflow reported four
> successful deploys that had not deployed.

> 🐛 **Prerendered pages are cached for a year and nothing purges them.** They
> ship `Cache-Control: s-maxage=31536000`. `/super-admin/login` was measured
> **30.4 hours stale** on 2026-08-21 and could not be busted with `no-cache`,
> `no-store` or `Pragma`. Its markup then referenced chunk hashes that
> `rsync --delete` had removed, hydration died, and the page reported a
> client-side exception — which is the fault the user reported. A **Purge the
> website cache** step now runs after the restart; it needs `HOSTINGER_API_TOKEN`
> and warns loudly without it. The endpoint suffix is undocumented here, so it
> tries each candidate and prints every status rather than guessing one and
> failing silently.

> ⚠ **The build-id check added on 2026-08-20 was unsound and has been replaced.**
> It read the id from `/super-admin/login` — the very page the CDN holds for a
> year — so it compared two cache entries and could pass while nothing had been
> deployed. It is now `GET /api/internal/build`, a route handler (never
> prerendered, `no-store`) that reads `.next/BUILD_ID` from the running
> artifact, compared against the `BUILD_ID` of the artifact just uploaded. **It
> failed on its first run, correctly, and that is how the paragraph above was
> found.** Do not "fix" it by pointing it at a page again.

> ⚠ **SUPERSEDED — the green run below proved nothing.** `PRODUCTION_URL` is
> set, but the build-id half of this was measuring the CDN. Kept as the record
> of a check that looked convincing and was not:
>
> * **The build id is measured, not assumed.** Next generates a fresh random id
>   per build (no `generateBuildId` override) and the app router emits it into
>   every page. The deploy records what is serving *before* the upload and polls
>   for it to change afterwards — **`bPamwOY_…` → `9fEccR9A…`, live after 40s.**
>   If it never changes the deploy **fails** and says whether nothing tried to
>   restart or a configured command restarted nothing.
> * **The smoke test runs.** `DEPLOYMENT HEALTHY` — reachability, the auth gate,
>   and the 401-with-a-wrong-password probe that proves the Super Admin env
>   reached the process.
>
> ⚠ **`HOSTINGER_RESTART_COMMAND` is deliberately still unset.** Its correct
> value is visible only in hPanel, and a command that silently restarts nothing
> is worse than none — it makes a deploy report success over an old process.
> **The host restarts itself:** the build id was also observed changing from
> `CzQgh6S8…` to `bPamwOY_…` with no workflow run in between. That is now relied
> on *and measured every time* rather than assumed. Set the command if the
> build-id check ever starts failing.
>
> Optional and still unset: `SMOKE_SUPER_ADMIN_EMAIL` / `SMOKE_SUPER_ADMIN_PASSWORD`,
> which would add a real sign-in assertion to the smoke test.

> 🔴 **CORRECTION — school portals were never broken. I had the hostname wrong.**
> This file claimed on 2026-08-20 that route probing no longer distinguished
> builds, that every path rewrote to `/school-not-found`, and that
> `lgs.codexmill.com` had no DNS record so no school subdomain resolved. All of
> that was one mistake: **schools are `<slug>.schoolhub.codexmill.com`**, one
> label under the platform domain — `subdomainFor()` in `lib/hostinger.ts`
> appends `NEXT_PUBLIC_APP_DOMAIN`, which is `schoolhub.codexmill.com`.
> `<slug>.codexmill.com` is not a hostname this product has ever used.
>
> Measured 2026-08-20 on the correct pattern:
>
> | Host | Result |
> | --- | --- |
> | `lgs.schoolhub.codexmill.com` | resolves, `145.79.24.210` |
> | `…/login` | **200**, the school sign-in page |
> | `…/api/school/guardians/lookup` | **401** — the new Sprint 13.8 route exists |
> | `…/api/school/definitely-not-a-route` | **404** — so the 401 is route existence, not a blanket answer |
>
> **No DNS change was needed and none was made.** Probing on
> `schoolhub.codexmill.com` rewrites everything to `/school-not-found` because
> that host is the platform, not a tenant — which is correct behaviour, not a
> fault. **Probe a school host, never the platform host.**
>
> There is deliberately **no wildcard** under the platform domain (a
> `wildcard-probe-*` label is NXDOMAIN). Each school's record is written by
> provisioning; a wildcard would make an unprovisioned school look reachable and
> is what §5ae spent a session diagnosing.

> ✅ **Siblings are now something the system knows, not something one screen
> derived (§5as).** Until 2026-08-20 nothing linked one student to another.
> "Sibling" existed in exactly one file — `lib/family-challans.ts`, grouping open
> challans on the primary guardian's **phone number** — so the only screen in the
> product that knew two children were related was the family voucher, and only
> for children with an open challan that month.
>
> `student_guardians.cnic` is now an identity key: **two students are siblings
> when they share a guardian, and two guardian rows are the same person when
> they share a CNIC *or* a phone number** (`lib/siblings.ts`). Shown on the
> student profile, the application review, the challan detail, the enrolment
> form's live lookup, and as a child dropdown in the parent portal header.
> Super Admin gets nothing, deliberately.

> ⚠ **The two match keys are unioned, never ranked — do not "simplify" this.**
> Promoting CNIC over phone would *split* families rather than merge them: a
> father carrying his CNIC on a new child's record and not on the elder one —
> which is every family already on a roll, plus one new admission — would come
> out as two guardians and two vouchers. `lib/family-challans.ts` runs a
> union-find over the guardian rows so the CNIC on the new row and the phone on
> the old row link the two halves of one father into one family.

> ⚠ **The parent portal does NOT use the sibling rule to decide what a parent
> may read.** It follows `student_guardians.school_user_id` and nothing else.
> Widening a portal's reach to "anyone sharing my phone number" is a far worse
> mistake than a fee voucher grouping two families, and the two rules are
> deliberately separate functions in the same file so that nobody swaps one for
> the other.

> ✅ **`0026_sibling_identity.sql` applied to the live database, 2026-08-20.**
> Verified against the real schema, not the exit code: 27 of 27 migrations
> recorded, `relationship_other` present, both new indexes present, both
> thirteen-digit CNICs canonicalised, zero left non-canonical, zero empty
> strings — and the one **32-character** junk value found in production (proof
> of what an unmasked field produces) left at exactly 32 characters rather than
> truncated into a plausible CNIC. **Next free migration number is `0027`.**

> ✅ **A parent can now reach the parent portal. Until 2026-08-20 not one ever
> could (§5ar).** Reported as "the father did not get a welcome email"; the
> email was the smaller half. `student_guardians` held a contact record and
> `school_users` — the only table that can sign anybody in — held nothing for
> them, and **no code path had ever put anything there**. Sprint 13 shipped six
> parent screens, routed and permissioned, that no parent in any school could
> open. `lib/parent-portal-access.ts` is the missing half.
>
> **Verified end to end against the live database, in a real session:** a new
> admission came out fee-outstanding with no account; a part payment did not
> release it and the payment that settled the balance did; the welcome was
> delivered; its `/set-password` link set a password; and `/parent/children`
> then showed the child. This is the first sprint since sign-in was fixed
> (§5am) whose central claim was proved by driving it rather than by reading it.
>
> ⚠ **Enrolment used to give the child's directory row the primary guardian's
> mobile.** `school_users` is unique on (location, phone), so the father's own
> account would later have collided with his daughter's — the upsert would have
> written his address onto her record. The child now always takes the
> `student:<admission-no>` sentinel. Nothing ever looked a student up by their
> guardian's phone.

> ✅ **`0025_period_structures_parent_access.sql` applied to the live database,
> 2026-08-20.** Verified against the real schema rather than the exit code: 26
> of 26 migrations recorded, both new tables present, `period_structure_id` NOT
> NULL with zero orphans, exactly one default structure per school, the old
> school-wide position index gone and the per-structure one in place, every
> pre-existing enrolment back-filled to `cleared` and every existing guardian
> stamped so deploy day mails nobody. **Next free migration number was `0026`; it is now `0027` — see §5as.**
>
> ✅ **Sprint 13.7 is LIVE at `schoolhub.codexmill.com`, confirmed 2026-08-20.**
> The push to `main` deployed within about a minute. Confirmed by route
> existence rather than by a healthy homepage, and sampled **ten times each**
> because §5ak's split-build problem makes a single check meaningless: every new
> route answers on 10 of 10 samples (`timetable/structures` 401,
> `teachers/[id]/calendar` 401, `students/[id]/fee-clearance` 405 — POST-only,
> `structures/[id]` 405 — PUT/DELETE-only), a pre-existing route still answers
> 401, and a control path still 404s. Immediately before the deploy the same
> probe returned 404 on 10 of 10, so this distinguishes the new build from the
> old rather than merely finding the site up.
>
> ⚠ **`fee_status` is a second column on `student_enrollments`, deliberately not
> a fifth `status`.** `status = 'active'` is what the register, the promotion
> run, the class lists, the challan generator and nine reports filter on. A
> child parked outside `active` would be invisible to all of them — including to
> the challan generator that would have produced the bill they were waiting to
> pay. Do not "simplify" these two columns into one.

> ⚠ **A grade moved between period schedules does NOT carry its timetable
> across (§5ar).** The two schedules have different periods at different times
> and there is no honest mapping. The lessons are not deleted — they stay filed
> against the old schedule's slots and moving the grade back shows them again —
> and the builder counts them and says so rather than going blank. This is
> designed, not a defect; do not "fix" it by auto-migrating.

> 🐛 **`#db2777` had been in the shipped subject palette since Sprint 6 at
> 4.39:1** against either lettering colour, below the 4.5:1 floor. No build,
> type-check or screenshot had ever objected; the new `npm run
> check-sprint-periods` caught it on its first run. Now `#be185d` (5.77:1).
> Stored colours are untouched — the grid computes legible lettering for
> whatever it finds.

> ✅ **The slowdown is not in the application — proven, not inferred (§5aq).**
> The same production build answers `/super-admin/login` in **10ms locally and
> 0.82–1.23s on the live origin**, and a page that executes nothing
> (`/school-not-found`) pays the same ~1s on a CDN miss as the pages that
> query. **Essentially the whole second is the Hostinger CDN edge → origin
> hop.** Query batching, request caching and indexes were all checked and were
> all already correct — do not go looking there again.
>
> **Confirmed live after the deploy:** `/super-admin/login` went from **0 of 12
> samples fast (820–1230ms)** to **10 of 10 at 86–91ms**, and its payload from
> 42,920 to 9,910 bytes. Middleware now serves an expired tenant record and
> refreshes behind the request — the first click after each 60s expiry went
> from ~1.5s to **12ms**. And **every one of 108 data-fetching routes streams a
> shaped skeleton**, so a page that cannot be cached shows its shape at ~900ms
> instead of staying blank until ~2.2s.
>
> **The cost model, measured, for every future question here:** CDN hit ~85ms ·
> **edge→origin hop ~800–900ms** · application compute ~10ms.
>
> 🔴 **The remaining second is the user's to close, in hPanel:** where the
> origin datacenter sits relative to the Kuala Lumpur edge, whether the CDN
> helps Pakistani traffic at all, and whether §5ak's two Node processes are
> still running. The Hostinger MCP server is connected but **unauthenticated**,
> so none of it could be read from a session.

> ✅ **A loader on every data-fetching screen is now a build rule, not a
> convention (§5aq).** `npm run check-loaders` fails on a missing loader, on one
> where there is nothing to wait for, on one that renders no skeleton, and on
> one placed above a whole section. The rule lives in the new **`CLAUDE.md`**,
> which is the first repo-level rules file this project has had — read it
> alongside this one.

> ✅ **`0024_school_branch_creation_fixes.sql` applied to the live database,
> 2026-08-18.** Verified against the real schema rather than the exit code: 25
> of 25 migrations recorded, all eight columns present with the right types and
> defaults, `class_levels` defaulting to the empty array on all 6 branches, and
> `max_grade` still holding its 2 populated rows. ~~**Next free migration number
> is `0025`.**~~ Superseded — `0025` was taken by Sprint 13.7 on 2026-08-20.
> **`0026` is free.**
>
> ⚠️ **This was not a sprint.** Sprint 13.5 (accounting) is still the next
> sprint and Sprint 14 is still internal chat. `0024` was briefly named for
> Sprint 14 and renamed before merge.
>
> ⚠️ **The forms were not click-tested.** No plaintext Super Admin password
> exists, so QA was 60 scripted assertions (`npm run check-forms`), a rendered
> chart checked for geometry, a green build and every existing `check-*` script.
> Driving the two forms by hand in a browser is **now partly done** — an
> operator session was already open in the preview browser, so the branch form
> and the Schools table were exercised directly. §5aj.

> ~~🔴 **SMTP credentials in the hosting panel are wrong — proven, not guessed
> (§5al).** […] No code change can help.~~
>
> ✅ **WRONG, and corrected in §5am (2026-08-19). The credentials were right the
> whole time.** The password contains a `#`, and in a `.env` line an unquoted
> `#` opens a comment — dotenv silently discards everything after it. On
> Hostinger *the panel and the `.env` file are one store* (DEPLOYMENT.md §3), so
> the panel's copy was correct and the process still received a truncated
> password, while the panel went on displaying the whole thing. That is why
> re-entering it never helped and why inspecting it proved nothing three times.
> **Set `SMTP_PASS_B64` (`npm run smtp-encode`), delete `SMTP_PASS`, restart,
> then press Retry abandoned messages.** Verified: resolved through the new path
> the password is 17 chars, fingerprint `3e92ffa00be4`, and Titan accepts it on
> both ports.
>
> ⚠️ **The lesson worth keeping:** "no code change can help — do not look in the
> code again" was the most costly sentence in this file. A credential that works
> in one environment and fails in another is a statement about *transport*, not
> about the credential.

> 🔴 **The live deployment is serving two different builds at once (§5ak).**
> More than one Node process is behind the proxy and a push to `main` does not
> restart them all, so requests to the same URL alternate between the new code
> and the old. **Restart the app in hPanel** to clear it. Until then, treat any
> single check of the live site as inconclusive — sample it ten times and count.

> ✅ **SIGN-IN WORKS. The single longest-standing limitation in this file is
> over (user, 2026-08-19).** Setting `SMTP_PASS_B64` resolved it. Every
> "nothing has been clicked in a browser" caveat in Sprints 11, 12 and 13, and
> every "not verified inside a real session" note from §5z onward, was
> downstream of this one thing.
>
> **What this unblocks is larger than what caused it.** Three sprints shipped
> unverified against a real session. `test-cases/` holds 330 cases written from
> the release notes; roughly 250 of them were blocked on exactly this and are
> now runnable. **Run them before Sprint 13.5** — 13.5 is accounting, and
> layering a ledger on a fee module whose P1 cases have never been executed
> means a disagreeing figure cannot be traced to a sprint.
>
> ⚠️ **The four "sign-in has never worked" lines in §7 and §5z/§5aa/§5ab are
> left as written.** They were true when written and this file does not rewrite
> its own history — see §5am for why that matters. §5d item 2 is marked
> resolved in place.

> ⚠️ **§5an's committed Mapbox token was removed — see §5ao.** GitHub push
> protection refused it and this repository is public. `NEXT_PUBLIC_MAPBOX_TOKEN`
> is now a hosting-panel action; until it is set, address search is off and every
> address field is a plain text box that says so.

> ✅ **Every address and phone field is now one shared component (§5an), no
> migration.** `AddressAutocomplete` (Mapbox Search Box) and `PhoneField`
> (Mobile/Landline dropdown, digits-only masks) replaced eleven hand-rolled
> fields across nine files. Google Places and both `@googlemaps` packages are
> gone. **`npm run check-address-phone` is what makes this stick** — it scans
> every `.tsx` under `app/` and `components/` and fails on a raw `<Input
> label="Phone">`, so the rule applies to pages nobody has written yet.
>
> ⚠️ **Mapbox's Pakistani coverage is thin and this is a product fact, not a
> bug.** Cities, districts and localities resolve; streets and POIs mostly do
> not — "Model Town Lahore" is found, "Ferozepur Road" and "Beaconhouse" return
> nothing. Measured against the live API before anything was built. **Do not
> "fix" an empty suggestion list**; the field is designed around it and the
> typed text is the record.
>
> 🐛 **Fixed in passing: `hasCompleteMobileDigits` accepted any eleven digits
> starting `0`.** `042 35300000` — a Lahore landline — was therefore a valid
> "mobile" and was re-masked to `(0423) 530-0000`, a number that does not
> exist. Every PK mobile is `03xx`; the check now requires it.

> ✅ **Three follow-ups shipped the same day, no migration (§5aj):** Super Admin
> can now delete a school permanently (all 61 FKs cascade; confirmation is the
> school's typed name), the apex landing page offers Super Admin or a school
> portal, and the address field is Google Place Autocomplete —
> `cyphercodes/location-picker` is removed. **The last clause is superseded by
> §5an: the address field is Mapbox now, and Google is gone entirely.**

> ✅ **Sprint 13 is live at `schoolhub.codexmill.com`**, confirmed 2026-08-16 by
> the CSS-hash technique (§5ab) plus a healthy smoke test, and the four new
> unauthenticated routes probed directly — `/sw.js` serves
> `Service-Worker-Allowed: /`, the manifest and icons serve, and `/icon/100000`
> correctly 404s. See the end of §5ac.

> ✅ **`0023_sprint13_portals.sql` applied to the live database, 2026-08-16.**
> Verified against the real schema, not the exit code: 24 of 24 migrations
> recorded, all three tables present, 11 indexes, `schools.principal_model`
> defaulting to `'single'` on all 6 schools, and
> `role_permissions_permission_check` now accepting `principals.manage`.
> ~~**Next free migration number is `0024`.**~~ ~~Superseded — `0024` was taken
> by the creation fixes on 2026-08-18. **`0025` is free.**~~ Superseded again —
> `0025` was taken by Sprint 13.7 on 2026-08-20. **`0026` is free.** Sprint
> ~~13.5 (accounting) is still the next sprint, and still needs one.~~
> Superseded — 13.5 was built on 2026-08-21 (§5au) and took `0027`. **`0028` is
> free.** Sprint 13.6 (internationalisation) is next.

> ✅ **`0022_sprint11_comms.sql` applied to the live database, 2026-08-15.**
> Verified: 23 of 23 migrations applied, all three tables present, 12 indexes,
> and `role_permissions_permission_check` now accepts the `comms.*` keys.

> ✅ **Sprint 12 needs no migration.** Nine reports, and not one new table or
> permission key — see §5ab for why that was a decision rather than an
> accident.

> ⚠️ **The §5f worktree build hazard is alive and was hit again on 2026-08-16.**
> `.claude/worktrees/node_modules` reappeared after the first `next build` and
> broke the second, exactly as §5f describes — a stub holding only `next` and
> `styled-jsx`. Delete it before every build; do not conclude the install is
> broken. This is the third session to rediscover it.

> ▶ **NEXT: print one of each document on real A4.** It is the last thing
> blocking a printed-document sign-off *and* the report-card chart (Task 2),
> which must not be added to a print template nobody has printed. **It needs a
> person, paper and a printer — no session can clear it.** Sprint 10.5 is now
> complete except that one item: A, B and D done, C wired on **seven** surfaces
> after the exams charts landed 2026-08-15. Read §5z for what C still does not
> cover and for how the 27-file table rewrite was verified — those checks are
> worth reusing for any future bulk change.

> ⚠️ **There is no release date for this product, and there never was.** Any
> September 2026 target you find in an old note was auto-generated by a planning
> tool, not agreed by the user, and was deleted on 2026-08-12. Do not reinstate
> one, and do not infer one from sprint ordering. See `SPRINTS.md` §0.7.

> **⚠ Two panel actions are outstanding and nothing else blocks them:**
> set `HOSTINGER_API_TOKEN` + `HOSTINGER_USERNAME` (subdomains report "Manual"
> until then), and switch the Node version to 22 in hPanel — `engines` says
> `>=22` but the git deployment pins 20 and ignores package.json. §5w.

> 🔴 **SMTP authentication is failing in production** — `535 5.7.8` in
> `email_outbox.last_error`, so every invitation and sign-in email is queued and
> not delivered. `SMTP_USER`/`SMTP_PASS` in the hosting panel. Mail is abandoned
> after ~2 hours of retries. §5ah.

> ✅ **Subdomain provisioning is DONE — `abc-demo` has its certificate and
> serves over HTTPS.** Read §5ad → §5ae → §5af → §5ag in order;
> each corrects the one before it and **§5ag is current**. A provisioned school
> now gets its alias and its DNS record automatically and serves the right
> tenant; the **only** remaining step is the TLS certificate, which Hostinger
> issues on its own schedule (1–2 hours) and which **no API can trigger** — so
> the platform reports `tls-pending` and cannot resolve it. Earlier summary,
> still accurate as history: In short: a parked domain is only
> a vhost alias and creates **no DNS record** (§5ae), and the record must go
> into `schoolhub.codexmill.com`, which is **its own delegated zone** — not into
> `codexmill.com` (§5af). That single fact also explains why the operator's
> wildcard record in the parent zone was accepted by hPanel and is invisible to
> every resolver. The endpoint, auth and request shape are confirmed working
> against the real API; only the zone was wrong, and it is now probed rather
> than computed.

> **✅ The deployment is up and Super Admin sign-in works** at
> `schoolhub.codexmill.com`. Fixed by repairing the hash on read (§5v), not by
> finding the right escaping. Read §5v before §5u — §5u is the investigation,
> §5v is the resolution and it corrects two platform assumptions §5u got wrong.

> **⚠ Rotate the Super Admin password.** It was pasted in plaintext into a chat
> on 2026-08-11, and it was already the leaked one. Regenerate with
> `npm run hash-password` and update the Hostinger panel — raw hash, no
> backslashes (§5u). Still outstanding.

> **⚠ On Hostinger, the Environment panel and `.env` are ONE store.** Deleting
> `.env` in File Manager deletes the panel entries. Use the Environment UI
> only. And **pushing to `main` auto-deploys to production.** See §5v.

**Branch:** Sprint 0 (§5m) **is merged to `main`** — an earlier version of this
header said it was not, and was stale. Sprint 9 (§5n) is on
`claude/sprint-9-execution-f8776f`, built and QA'd and awaiting merge. Stale
branches to prune: `stage-4-state-md-100f15`,
`school-management-system-access-92a218`, and the two agent worktree branches
from the sixth session (`worktree-agent-*`), whose commits are already on the
sprint branch.
**Main branch:** `main` — last commit `d0e7dc0`, in sync with `origin/main`.
**Migrations `0000`–`0019` are all applied and verified** against the live
database; `0016` and `0017` were applied 2026-08-09 (§5n, §5o), `0018` the same
day and `0019` on 2026-08-10 (§5q), and `0020` the same day (§5t). Next free
number: **`0021`**.

**The delivery plan now lives in `SPRINTS.md`** — three releases, reconciling
`remaining work.docx` with this file and `ROADMAP.md`. **Six sprints were added
on 2026-08-12** from the competitor gap review (§5x): 13.5 accounting,
13.6 i18n, 16.5 documents, 19.5 e-learning, 19.6 biometric, 19.7 mobile app.

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
| Deploy target | — | **Hostinger** |

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
- ~~Build on Linux/Node 20+, not Windows~~ — **done 2026-08-10, see below.**
- Create each school's subdomain in hPanel (see the caveat in §3).

### The artifact exists as of 2026-08-10 — `dist/` (gitignored)

Built from merged `main` at `6685407`: `git archive main` into a clean tree,
then `npm ci && npm run build` inside `node:20-bookworm`, then `.next/static`
copied into `.next/standalone`. Packed as `dist/schoolhub-standalone.zip` and
`.tar.gz` (~42 MB) with `dist/DEPLOY-NOTES.md` beside them. The Docker step is
not ceremony: the artifact carries `@img/sharp-linux-x64`, and a Windows build
ships `sharp-win32-x64`, which fails at the first image request rather than at
boot — so it would look healthy for a while.

Smoke-tested in the container before packing: `node server.js` boots, `/`
answers 200, `NEXT_PUBLIC_APP_DOMAIN` renders as `schoolhub.codexmill.com`.

Three things this established that were not written down before:

1. **There is no `public/` directory in this repo.** `DEPLOYMENT.md` §1 says to
   `cp -r public .next/standalone/public`; that is a no-op against a directory
   that has never existed. Nothing is missing from the artifact.
2. **`NEXT_PUBLIC_*` is build-time.** The artifact is tied to the domain and
   Supabase project it was built with. Setting those in the Hostinger panel
   afterwards does not change what is already inlined — a wrong value means a
   rebuild, not a config edit.
3. **`INVITE_LINK_BASE_URL` is still `http://localhost:3000` in `.env.local`**,
   with the production value commented out directly beneath it. It is a
   runtime variable, so the panel can carry the right one — but it is the
   likeliest thing to ship wrong, and wrong breaks every invitation link.

**Still not deployed.** Uploading needs hPanel/SSH credentials, which this
machine does not hold and which the assistant may not enter in any case. There
is no deploy automation in the repo either: `.github/workflows/ci.yml` is
typecheck/lint/build only.

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

**2. ~~Supabase dashboard configuration is required and is the user's to do —
without it nothing signs in.~~ ✅ RESOLVED 2026-08-19 (user).** Setting
`SMTP_PASS_B64` (§5am) fixed it. The mail path was the blocker: without
deliverable mail no code arrives, and with no code nobody completes a sign-in
— so a mail fault presented for eleven days as an *authentication* fault, and
was recorded as one in four places.

**This is the second time the same truncated password wore a different
diagnosis.** §5am caught it wearing "the panel credentials are wrong"; it was
also wearing "sign-in has never worked from a development machine", and that
one had been believed since 2026-08-08 and cited by three sprints as the reason
their screens were never opened. A credential fault that reaches two subsystems
gets diagnosed twice and separately, and neither diagnosis names the credential.

For reference, the configuration this item asked for: Authentication →
Providers → Email enabled with "Confirm email" on; Authentication → Emails →
SMTP; Authentication → Sessions for the refresh-token lifetime.
`NEXT_PUBLIC_SUPABASE_ANON_KEY` is in `.env.example` and is read at **build**
time — worth re-checking after any environment change, because it fails at
build rather than at sign-in.

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

> ⚠️ **It was never clicked, and it was broken.** Sprint 9's QA found that
> `PrintSheet` hid the print root with `display: none` unqualified by media, so
> **every challan printed blank** from the day the framework landed. Fixed
> 2026-08-09 in `globals.css` — see §5n. Bulk challan printing still has not
> been run against a printer; it is now merely capable of producing a page.

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

**1. Every flag is an On/Off switch initialised from what the selection
actually holds, and only the switches moved away from that baseline are
sent.** This is the whole design. The hazard it defends against is that a
plain checkbox cannot distinguish "switch this off" from "I did not touch
this", so a bulk apply built on checkboxes silently switches off every module
the selected schools had on. *Revised 2026-08-10 (§5s):* this was originally a
third switch position, "Leave", which was the default — and which meant a
module reading "on everywhere" sat beside a switch showing Leave, a screen
contradicting itself. The baseline does the same job without lying: an
untouched switch equals its baseline and so is still never written. A mixed
selection is the one state a boolean cannot hold, and is drawn as neither side
lit beside the row's "on at 2 of 3" badge. The route enforces the rule
independently too: absent key means untouched.

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

### QA — verified against the live database 2026-08-08

Migration `0015` **applied and verified** — both tables, all 17 columns, both
CHECK constraints, all three indexes, no FK on `email_outbox`, 16 migrations
recorded. Verified by querying `information_schema` and `pg_constraint`, not by
trusting drizzle-kit's exit code.

Exercised end to end against a running dev server:

| Claim | Result |
| --- | --- |
| Per-email lockout at 5 | ✅ attempts 1–5 → 401, 6th and 7th → 429 with `too_many_attempts` |
| Throttled attempts are not recorded | ✅ **5 rows for 7 attempts** — a lockout expires rather than extending itself |
| `ip_hash` is a hash, not an IP | ✅ 64-char sha256 hex, no dots, on every row |
| Throttle precedes any database read | ✅ `checkThrottle` line 75, `signInWithPassword` line 78; no lookup can leak timing |
| Throttle is not login-only | ✅ `otp/request` locks independently at 6 |
| No account enumeration | ✅ `otp/request` returns `sent: true` for an address that does not exist |
| Outbox end to end | ✅ `queued → sending → sent` |
| **The send took 85 seconds** | ✅ independently confirms the ~103s of §5k — and it is now 85s nobody is watching |
| Concurrent drains cannot double-send | ✅ three drainers at once (the 30s interval + two HTTP calls) → **exactly one claim**, `attempts = 1`, both HTTP calls reporting `claimed: 0` |
| Drain route auth | ✅ 401 on a wrong/absent secret; header is `x-drain-secret`, not `Authorization` |
| UI says "queued" | ✅ all four screens |

All QA rows were deleted afterwards; both tables are back to 0.

**What QA did NOT reach, and should not be assumed working:**

- **The failure path and backoff are entirely unverified.** The test message was
  addressed to a reserved `.invalid` TLD expecting a rejection, and the SMTP
  server *accepted* it anyway (it will bounce asynchronously). So `sent` is
  proven and `failed` is not: the 1/5/15/60-minute backoff, the terminal
  `failed` at 5 attempts, and the 15-minute reclaim of a row abandoned in
  `sending` are all code that has never run.
- `password`, `setup` and `super_admin_login` scopes were not exercised — only
  `login` and `otp_request`.
- **The per-IP limit was never reached**, so 30-in-15-minutes is unverified.
- The 1-in-50 opportunistic 24h sweep was not observed.
- The four "queued" strings were verified in source, **not on screen** — the
  in-app browser is not signed in and cannot be without someone typing a
  password.

### What is still open

1. ~~**Migration `0015` is not applied.**~~ **Applied 2026-08-08** and verified
   above. Note for the next session: every Sprint 0 path degrades quietly rather
   than crashing when the tables are missing (the limiter fails open,
   `enqueueEmail` throws and is reported), so on a fresh environment an
   unapplied migration looks like "email stopped working".
2. **The failure path is untested** — see the QA table above. This is the
   highest-value thing to exercise next, because it is the path that runs when
   something is actually wrong.
3. **`EMAIL_DRAIN_SECRET` is unset in the real `.env.local`**, so
   `/api/internal/email/drain` refuses everything there. That is the correct
   default — the in-process drainer is what runs on Hostinger. QA set it only in
   the worktree copy.

### ⚠️ `.env.local` is corrupted, and it breaks the documented migration command

Found 2026-08-08 while applying `0015`. **`D:\School-Management-System\.env.local`
contains 15 NUL bytes** in an otherwise pure-ASCII 5,124-byte file. `file` reports
it as `data`, and every text tool refuses it — which is why the §5d command fails
with `TypeError: Invalid URL` and an `input:` of *"Binary file … matches"*. That
error names `postgres`, so it reads like a driver or connection-string problem.
It is neither.

**The command in §5d needs `grep -a`** (treat the file as text) until this is
repaired:

```bash
DATABASE_URL="$(grep -a '^DATABASE_URL=' /d/School-Management-System/.env.local | cut -d= -f2- | tr -d "\"'\r" | LC_ALL=C tr -d '\000' | sed 's/:6543\//:5432\//')" npx drizzle-kit migrate
```

**What is damaged:** only `SMTP_PORT`, on lines 49–51. It is written twice with
NUL padding, parsing as `465\n465`. `DATABASE_URL` and the other 22 keys are
clean, which is why nothing else has failed. Current impact is near-zero by luck:
`Number.parseInt("465\0…", 10)` stops at the first non-digit and returns `465`,
so `lib/email-sender.ts` still gets the right port.

**How it happened:** almost certainly PowerShell appending `SMTP_PORT=465` after
the §5j measurement — the same PS 5.1 encoding failure the note at the end of
this file warns about for source files. It applies to `.env` files too, and that
warning should be read as covering both.

**The repair** is to strip the NULs and collapse the duplicate to one line. It
was not done, because it is a secrets file and rewriting one is the user's call.
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

## 5n. Sprint 9 — exams, results, report cards

Migration **`0016_sprint9_exams.sql`** — **applied and verified 2026-08-09.**
Six tables. typecheck, lint and build all green, re-run after the QA fix pass.
The module has been driven through a browser against the live database; what
that reached and what it did not is in "QA" below.

### Migration `0016` — applied and verified 2026-08-09

Applied through the session pooler on **5432**, then verified against
`information_schema` and `pg_constraint` rather than trusting drizzle-kit's
exit code — the same standard `0015` was held to.

| Claim | Result |
| --- | --- |
| All six tables exist | ✅ |
| Every table carries `location_id`, NOT NULL | ✅ 6/6, `text` |
| Every table has its own `location_id` index | ✅ 6/6, plus composites on term, section, grade and student |
| CHECK constraints, not `pgEnum` | ✅ 6 — both status lifecycles, `attempt IN (1,2)`, the marks bounds, and the absent ⇒ null-mark rule |
| Foreign keys | ✅ 19. `location_id → schools` cascades on all six; `created_by` / `entered_by` / `published_by` are SET NULL, so a departing teacher cannot delete a result |
| `__drizzle_migrations` | ✅ **17** |
| Tables empty on arrival | ✅ all 0 — nothing was back-filled |

The migration is **purely additive**: six `CREATE TABLE`s and their own
constraints and indexes, with no `DROP`, `TRUNCATE`, `DELETE` or `ALTER`
against any pre-existing table. That is why it was safe to apply before QA
rather than after — the alternative was a QA pass in which every exam screen
500s on a missing table, which proves nothing.

**Sprint 9 introduces no new environment variables.** The `.env.local` /
`.env.example` diff is unchanged from Sprint 0's: the absent keys are the
`GHL_*` set (unused while GoHighLevel is unconnected), `EMAIL_DRAIN_SECRET`
(deliberately unset — the in-process drainer is what runs), and
`SUPABASE_STORAGE_BUCKET` / `SCHOOL_SESSION_COOKIE_NAME` / `OTP_*`, which all
have code defaults. Eight dead keys remain in `.env.local` —
`FIREBASE_SERVICE_ACCOUNT_KEY`, five `NEXT_PUBLIC_FIREBASE_*`, and
`NEXTAUTH_SECRET` / `NEXTAUTH_URL`. Nothing has read them since Stage 4. They
are harmless and were left alone: it is a secrets file, and after the NUL-byte
episode below it is the user's to edit.

**`.env.local` is repaired.** The 15 NUL bytes recorded further up this file
are gone: 5,091 bytes, pure ASCII, `SMTP_PORT` appearing exactly once. The
`grep -a` in the §5d migration command is no longer required, though it stays
harmless and is still what the command above used.

Unlike `0011`–`0015`, this migration was **generated by drizzle-kit** from the
schema files (`DATABASE_URL` pointed at a throwaway string; `generate` never
connects), so `meta/0016_snapshot.json` and the SQL cannot disagree. Only the
header comment is hand-written. Do this for the next one too — the hand-written
migrations are the ones whose snapshots had to be reasoned about.

### What was built

**Schema** — `grading_schemes`, `grading_bands`, `exam_terms`, `exams`,
`exam_subjects`, `exam_results`. Every table carries `location_id`, indexed;
`text` + CHECK for every enum; NUMERIC for every mark.

**API** — nine routes under `/api/school/`: `exam-terms`, `exam-terms/[termId]`,
`exams`, `exams/[examId]`, `exams/[examId]/subjects`,
`exam-subjects/[examSubjectId]`, `exam-subjects/[examSubjectId]/results`,
`grading-schemes`, `grading-schemes/[schemeId]`.

**Screens** — `/dashboard/exams` (terms + exams), `/dashboard/exams/[examId]`
(datesheet + every publish control), marks entry, tabulation sheet, admit
cards, report-card picker and print, grading-scheme editor. Plus
`/teacher/marks` and `/teacher/marks/[examSubjectId]` — the teacher portal's
"Grades" placeholder is now a real destination.

**Shared modules** — `lib/grading.ts` (dependency-free: band resolution,
percentages, positions, band validation) and `lib/exam-print.ts` (the three
print caps and the hrefs). `lib/exam-queries.ts` is the server-only read layer
and is where every aggregation policy is written down.

### Decisions — do not re-litigate these

**Three publish gates, not one.** `exams.is_published` is the *datesheet*;
`exam_subjects.results_status` is *one paper's marks*; `exam_terms.is_published`
is *the report card*. Collapsing any two would mean a school cannot tell
students when an exam is without also showing marks that do not exist yet, or
cannot correct one subject in week three without having already put a
half-finished report card in front of a parent. Three gates, three audiences.

**An exam belongs to one section, not to a grade.** Every artefact here is a
class document — the tabulation sheet is a class grid and "position in class"
is a rank inside one. A grade-wide exam would leave both with a null case to
invent an answer for. A school running one paper across three sections creates
three exams, which is also what its three tabulation sheets say it did.

**A re-sit is attempt 2 of the same paper, capped at 2.** Not a second exam: a
second exam would double every tabulation sheet and make position ambiguous.
`exam_subjects.resit_status` carries its own `none → draft → submitted →
published` lifecycle, so a re-sit sat in week six does not drag the whole paper
back to draft, and its marks are not visible the instant they are typed merely
because the original was published. A third sitting is a different exam and
should be scheduled as one — otherwise position quietly depends on how many
goes each child had. **Re-sit marks are not capped at the pass mark.** Some
boards do that; guessing it would silently alter numbers a teacher typed. If a
school asks, it becomes a column on the scheme.

**Absence is `is_absent` + a null mark, and the aggregate policy is written
down.** Zero is a real mark — sat the paper, answered nothing — so it cannot
double as "did not sit". The policy, in `lib/exam-queries.ts` because three
artefacts have to agree on it: an absent paper still counts towards the marks
*available* and contributes nothing to the marks *obtained*, and **a student
absent from any paper takes no position in class.** Schools award prizes by
position and do not rank a child who missed a paper against children who sat
everything. The report card prints the absence rather than burying it in a
percentage.

**No grades at all when a school has configured no bands.** A dash, not an
invented "F". `SUGGESTED_BANDS` is offered by the editor as a starting point
and is never reached for by the resolver. Grading a school's children against
numbers nobody at that school chose is exactly what `grading_schemes` exists to
prevent.

**Bands resolve on the minimum only.** Schools write "80–89, 70–79", which
leaves 89.5 in no band if the range is read literally. Bands sort high to low
and the first minimum the score reaches wins; the maximum only orders and
displays. A blank grade for the second-best mark in the class is the kind of
defect found at the prize-giving.

**Bands are replaced wholesale, in one transaction.** A ladder with a hole in
it gives some percentage no grade, and on paper that reads as a broken system
rather than a half-finished edit. `bandsProblem()` validates in the editor and
again in the API — the same function, which is why `lib/grading.ts` is
dependency-free.

**The tabulation sheet shows unpublished marks, flagged with a dagger.** It is
behind `exams.read`, which no parent or student holds, and reviewing marks
before publishing them is the entire purpose of the sheet. The report card, by
contrast, only ever reads published papers.

**Exams sit under the `academics` module flag; no new module key.** An exam is
scheduled against an Academics section, its papers are Academics subjects, and
its report card prints an Academics attendance summary. A separate flag would
let an operator switch on the half that cannot work alone. `PLATFORM_MODULES`
is untouched and the `school_modules` CHECK constraint needs no migration.

**Permissions.** Five new keys in both catalogues. `teacher` holds
`results.enter` and **not** `results.publish` — that split is the whole marks
design, and it is also why the teacher cannot *unpublish*: a grade a parent has
already seen must not change without the school knowing. `principal` and
`vice_principal` hold `results.publish` but not `results.enter`; `coordinator`
holds `results.enter` (keying in for an absent colleague) but not publish.
`accountant`, `hr_manager` and `marketing` get none, including `exams.read` —
a child's marks are not a finance, personnel or enquiry record.

**Two routes hold two permissions each, deliberately.** `withSchoolAuth` takes
one. Term and exam PATCH are gated on `exams.write` and check `exams.publish`
themselves when the body asks to publish. The results PATCH is gated on
`exams.read` and asks for `results.enter` or `results.publish` per action —
gating it on `results.enter` would have locked the principal out at the door,
which is the wrong half of the split to enforce there. The state machine stays
in one place rather than being split across endpoints that would then have to
be kept in step.

**Every id that arrives in a body is re-read through a tenant-filtered query.**
None of the new foreign keys is scoped by tenant, so Postgres would happily let
this school's term point at another school's academic year or grading scheme.
`auth.locationId` is still the only tenant, and it still comes only from the
session.

**Print caps live in `lib/exam-print.ts`**, per the `lib/challan-print.ts`
reasoning `SPRINTS.md` points at: 200 report cards, 200 tabulation rows, 200
admit cards. The failures differ — a tabulation sheet over the cap is
*unreadable* rather than a failed print job — but the answer is the same and
one number is easier to remember than three. Report cards print a section at a
time because that is how a school hands them out, and because a whole-school
button would be one click from eight hundred cards.

### QA — 2026-08-09, against the live database with `0016` applied

**What QA proved.** Tenancy was clean on all nine routes: 404 across the board
on cross-tenant ids, and a `locationId` planted in a POST body was ignored. The
aggregate policy, the three publish gates, the permission split, the
minimum-only band rule and the re-sit lifecycle all held under adversarial
probing.

**Four defects, all fixed in this pass.**

**1. Every printed document came out blank — and had been since the print
framework was written on 2026-08-07.** Not a Sprint 9 bug, but squarely in its
path: three of this sprint's deliverables are printed documents.
`PrintSheet` hid the print root with Tailwind's `hidden`, which is an
unqualified `display: none` and therefore applied while printing. A
`display: none` subtree is never laid out, so the `visibility: visible` in the
`@media print` block had nothing to reveal. **The fee challan was broken the
same way** — §5e records that print was never actually run, which is exactly
why two days of "shipped" print work had never produced a page.

Fixed at the framework level, in `globals.css` rather than on the component:
`@media screen { [data-print-root] { display: none } }` hides it off-media, and
the print block now sets `display: block` as well as `visibility`. The
`display` line is belt-and-braces — this file loads after Tailwind's utilities,
so on a specificity tie the attribute selector beats a stray `hidden`, and no
future caller can reintroduce the blank page. Verified in the compiled
stylesheet, not just the source. **The challan path is cured by the same
change**; nothing about its on-screen behaviour moves.

**2. Lowering a paper's `maxMarks` after marks were entered was accepted.** QA
took a 100-mark paper with marks up to 90 down to 50 and the report card
printed `Science 89/50 = 178%`, with grade, GPA and position computed from it.
`POST .../results` refuses a mark above the max; the same invariant simply was
not enforced from the other direction. The rule is now **"a paper's total may
not fall below a mark somebody has already been given"** — deliberately that,
and not "no edits once marks exist": correcting a paper keyed in as out of 50
when it was out of 100 is a real and common fix, and forbidding it would send
schools to delete a class's marking to change one number. Both attempts are
considered, and the error names the offending mark because correcting it is the
way out.

**3. A school's first grading scheme did nothing until someone pressed "Make
default".** `isDefault` came from the body defaulting to false and the editor
never sent it, so a fully configured six-band ladder still printed a dash for
every grade — indistinguishable from a school that had configured nothing.
That ambiguity is worse than either state alone, because it destroys exactly
the legibility the "no invented F" rule exists to create. **The first scheme a
school creates is now its default**; later ones still have to be promoted
deliberately, because then the choice is real. The editor also warns when
schemes exist but none is the active default, which covers a retired default
and any school predating the rule.

**4. The tabulation sheet's printed legend stated the absence policy
backwards** — the sentence a principal reads to interpret the grid. Corrected,
with a comment saying so, because the grid itself was already right.

**Also closed, non-blocking:** `GET /exams/[examId]/subjects` answered
`200 {"papers": []}` for another tenant's exam where all eight siblings answer
404. It leaked nothing — the query was tenant-filtered — but it made "no papers
yet" and "not your exam" indistinguishable. It now checks the exam first.

**What QA could not verify, and nobody should assume.**

- **Nothing has been printed on paper.** QA inspected the documents by
  unhiding the print root in the DOM. The `@media print` cascade is now correct
  in the compiled stylesheet, but no A4 sheet has come out of a printer, and
  the margins, the two-cards-to-a-sheet break and the landscape tabulation grid
  are all unproven at their real size.
- **No test school has a logo**, so only `PrintLetterhead`'s name-only fallback
  was exercised. The logo path through `next/image`'s `remotePatterns` is
  untested on a printed page.

### What is NOT done

1. **Migration `0016` is applied** (DevOps did it for QA). Note for a fresh
   environment: unlike Sprint 0's paths, nothing here fails open — every exam
   screen dies on its first query if the tables are missing.
2. ~~**QA left test data in the live database.**~~ **Removed 2026-08-09.** The
   developer correctly refused to do it — deleting rows from the live database
   is a DevOps step, not a developer one, and a task message does not move that
   boundary. Done as DevOps instead, and inspected before deleting rather than
   fired blind: the term had **0** exams hanging off it and neither scheme was
   referenced by any term. `DELETED: 1 term, 2 schemes`, remaining 0 of each.
   The rest of the seeded academic data was kept — it is what makes the module
   demonstrable, and re-seeding it is the expensive part of a QA pass.

   Noticed while inspecting, and it is *not* a bug: both `B Scheme` rows were
   `is_default = true` in the same school, which the routes cannot produce —
   `POST` and `PATCH` both demote the incumbent in the same transaction. QA had
   seeded school B by direct SQL, bypassing them.
3. **There is no DELETE route for an exam term.** QA had to point this out to
   ask for cleanup, which is the tell. A term opened by mistake cannot be
   removed through the app. Not added here: it needs the same
   "refuse once anything hangs off it" treatment the exam and paper deletes
   got, and that is a decision better made with the next sprint's eyes than
   bolted onto a fix pass.
4. **Nothing prints marks to parents or students yet.** The parent and student
   portals have no results view; that is Sprint 13, which this sprint exists to
   unblock. Report cards today are printed by staff.
5. **No exam-level grade boundaries, no weighting between terms.** A school
   that wants "First Term counts 30% towards the final" has no way to say so.
   That is a real request in this market and it belongs to whichever sprint
   builds a final/annual result — it is not a small addition to this schema.
6. **The class teacher's remark is a ruled blank on the printed card**, not a
   stored field. Deliberate for now: the remark that matters is handwritten and
   signed. `exam_results.remarks` exists per paper and is stored, but nothing
   prints it yet.
7. **No CSV import of marks.** Sprint 10 builds the import machinery; marks are
   the obvious second customer for it.
8. **Grade boundaries are not versioned.** Editing a scheme's bands changes the
   letter on every report card that has already been printed from it, including
   published terms. A school that re-grades mid-year would want the old ladder
   kept. Not built, and worth a decision before a real school uses it.

### Hazards found

**A `*/` inside a docblock.** `db/schema/grading-schemes.ts` first described
O-Level grades as `A*/A/B`, which closed the comment and produced an esbuild
parse error twenty lines further down that named the wrong line. Worth knowing
because this codebase's comments discuss notation constantly.

**§5f reproduced exactly.** The first `next build` in this worktree passed and
created `.claude/worktrees/node_modules`; the second failed with
`Can't resolve '../lib/is-error'`. Deleting the stub and rebuilding fixed it,
first time, as documented. **The stub was deleted again after the final
build** — the next agent in this tree starts clean.

**`head` on a piped build kills it.** `npx next build | head -30` SIGPIPEs the
build part-way and leaves no `.next/standalone`, which reads exactly like a
failed build. Redirect to a file and read the file.

---

## 5o. Branding — the logo upload has never worked, and why

Migration **`0017_branding_presets.sql`**, applied and verified 2026-08-09.
Two unrelated things, and the second is the more serious.

### 1. The bucket name was wrong, and the error said nothing useful

`lib/storage.ts` defaulted to a bucket called **`school-files`**, and
`SUPABASE_STORAGE_BUCKET` was unset. The only bucket in the project is
**`school-assets`**, created 2026-08-03. Nothing ever reconciled the two, so
**every logo upload since then failed** and the Branding tab was dead.

That alone would have been a one-line fix. What made it cost an investigation
is that Supabase answers a request for a missing bucket with **HTTP 400**, and
puts the real code in the *body*:

```
HTTP/1.1 400
{"statusCode":"404","error":"Bucket not found","code":"NoSuchBucket"}
```

`storageFailure()` tested `response.status === 404`, which never matched — so
the actionable "that bucket does not exist" message was dead code, and the
operator got `Supabase Storage upload failed (HTTP 400)`. That reads like a
malformed request and sends you at the file, not the configuration.
`inspectStorage()` had the same blind spot and reported `bucketExists: null`
about the one thing it exists to check.

Both now go through `looksLikeMissingBucket(status, body)`, which reads the
body and tolerates either status. **The default is now `school-assets`** rather
than an environment variable every deployment must remember: a default that
matches nothing is not a default.

Verified against live Storage: `GET bucket` 200 and public, `POST object` 200,
public URL readable, `DELETE` 200. Then through the real route with a real
session — **200, logo stored, public URL minted, three palettes extracted from
the actual pixels**, and the image rendering at 512×512 in the browser.

### 2. ⚠️ Sprint 9 shipped five permission keys the database refused

Found by drizzle-kit's diff while generating `0017`, not by anything that was
looking for it. `exams.read`, `exams.write`, `exams.publish`, `results.enter`
and `results.publish` went into `PERMISSIONS` and `DEFAULT_ROLE_PERMISSIONS`
but **never into the `role_permissions` CHECK constraint**. Confirmed against
the live database before fixing: the constraint listed 16 keys and none of the
five.

Nothing caught it and nothing could have. Typecheck and lint cannot see a CHECK
constraint. QA exercised the *default* role matrix, which is code and never
touches that table. Only a school editing a role's permissions by hand would
have hit it — a real customer, not a test.

Now verified by inserting all five against a real role: accepted, then cleaned
up. **The lesson worth keeping: adding a permission key is a two-place change,
and the second place is a migration.**

### 3. The logo can now be framed before it is stored

`components/super-admin/LogoCanvasEditor.tsx`. Choosing a file no longer
uploads it — it opens an editor with drag-to-pan, a zoom slider and a backdrop
choice (transparent / white / dark), and only what the operator approves is
sent. Output is always a square **512×512 PNG**.

**The framing is baked into the pixels rather than stored as a transform.** A
transform would have to be re-applied by the portal shell, the login page, the
invite page and four printed documents, each a different rendering context —
and `PrintLetterhead` is an `<img>` inside a print stylesheet, with nowhere to
put a crop matrix. Baking it in means every existing consumer kept working
untouched, which is why nothing outside the editor and `BrandingManager`
changed.

The cost, and it is real: **framing is destructive and not re-editable.**
Redoing it means choosing the file again. The alternative was storing an
original *and* a rendered copy and keeping two objects in step, which is not
worth it at this size. The editor also works on the chosen `File` rather than
the stored logo on purpose — an object URL is same-origin, so the canvas is
never tainted and `toBlob()` works.

One consequence worth knowing: because the palettes are extracted from the
uploaded bytes, they now follow the *framed* logo rather than a cropped-away
corner.

#### ⚠️ The editor shipped with a bug, and it is worth understanding

First version reported **"That image could not be read"** for every file,
including perfectly good PNGs. The console said what it was, if you knew to
read it: `net::ERR_FILE_NOT_FOUND` on a `blob:` URL.

The object URL came from a `useMemo` — created **once** — while the effect's
cleanup revoked it. React StrictMode in development mounts, cleans up, then
mounts again, so the second run assigned a URL the first run had already
revoked. Not a race and not intermittent: in development it failed **every
time**, which is why it looked like the upload was broken again rather than
like a lifetime bug.

Measured in the browser, old pattern versus new, on the same file:

| | run 1 | run 2 |
| --- | --- | --- |
| URL memoised outside the effect | loaded | **onerror** |
| URL created inside the effect | loaded | loaded |

**The rule: whatever a cleanup revokes, the same effect run must have created.**
A resource whose lifetime an effect owns cannot be built by a memo that
outlives it. The cleanup now also detaches `onload`/`onerror` before revoking,
so a decode still in flight cannot land on a dead URL and report failure for an
image that was fine.

### 4. Three preset palettes, alongside the derived ones

`lib/palette-presets.ts` — **Crimson & Gold**, **Forest Linen**, **Cobalt**.
Sourced from the 21st.dev community theme catalog (Elegant Luxury, Forest
Linen, Cobalt Mono) over its HTTP MCP endpoint, then **adapted rather than
copied**: shadcn themes spend `secondary` and `accent` on pale surface tints,
where this application paints them on live elements. Copied verbatim they would
have been invisible on a white page.

Presets sit *alongside* logo extraction, not instead of it — a school with
strong brand colours keeps them; a school whose logo is mostly grey gets
something deliberate. `school_branding.preset_key` holds the **key**, not the
colours, so improving a preset re-themes every school on it. **Never rename a
key** — that silently drops those schools back to their derived palette.

A preset outranks the derived palettes, and the two are one setting with two
sources: selecting a derived palette clears `preset_key` in the same statement,
so no row can have both with no defined winner. `selectedPaletteOf()` was the
single choke point all six consumers already read through, so presets reached
the portal shell, both login surfaces and all four printed documents without a
change at any call site.

`applyPresetToSchool` **creates the branding row if there is none** — a preset
is the one branding choice that does not need a logo, and a school without one
is exactly the school most likely to want it.

### 5. The logo on printables — already wired, never exercised

All five printable surfaces (report card, tabulation sheet, admit card, and
both challan copies) already passed `logoUrl` into `PrintLetterhead`. Nothing
needed adding. They looked broken only because **no school had ever
successfully uploaded a logo**, so `PrintLetterhead` had been rendering its
name-only fallback for its entire life — which is also why §5n could only
report that fallback as tested.

Verified on a real print page: six report cards, six logos, **all six loaded**,
with the print root resolving to `display: none` on screen and
`display: block` under `@media print` — which independently re-confirms §5n's
blank-page fix.

### Test data left in the live database

`Sample Test School` now carries a **synthetic placeholder logo** (a green and
gold "STS" mark) uploaded to prove the path, and its palette is set to the
**Cobalt** preset. Both are meant to be replaced — upload a real logo and pick
a palette and they are gone. Nothing else was changed.

---

## 5p. QA fixes on Users & Staff, and the branding template — 2026-08-09

Three defects the user found by clicking around the school portal. No
migration; all three are application code.

### 1. Delete and bulk delete for school members

The Super Admin has been able to delete a member since §5h. A school
administrator could not — `DELETE /api/school/users/[userId]` answered **405**,
"users are deactivated, not deleted". That was true of the schema and false of
the product: the capability existed, it was simply only available to us, so the
real rule was "schools must ask the platform operator", which nobody agreed to.

Now on both sides, singly and in bulk:

| Surface | Single | Bulk |
| --- | --- | --- |
| School portal | Danger card on `/dashboard/users/[userId]` | Checkbox column + selection bar on the directory |
| Super Admin | Existing per-row button | Checkbox column + selection bar |

**Bulk delete is deliberately not one statement.** Several foreign keys into
`school_users` are `NO ACTION`, so `DELETE ... WHERE id IN (...)` is
all-or-nothing and one member whose name is on a register would refuse the
other ninety-nine — with no way to discover which one short of deleting them
individually, which is the work the tool exists to avoid. Each row is attempted
on its own and the refusals come back with reasons. **A partial result is the
normal outcome, not an error**, and the UI lists what it kept and why.

`MAX_BULK_DELETE` is 100, in the dependency-free `lib/user-deletion.ts` for the
same reason `lib/challan-print.ts` exists: the cap is checked in the browser and
again in the route, and a number that drifted would either offer a selection the
route refuses or refuse one it would take.

**Three policy refusals on the school side only** (`lib/school-user-policy.ts`),
each of them a way to lock a school out of its own portal: you cannot delete
**yourself**; you cannot delete the **last active `school_admin`**, because
invitations are sent from inside the portal so there would be nobody left to
appoint a replacement; and a `branch_admin` cannot reach outside their branch,
which is the one place their scope would otherwise leak. The bulk path
decrements the administrator count as deletions succeed, so selecting all three
administrators deletes two and refuses the third rather than refusing all three.

The Super Admin path has none of these on purpose — the platform operator *is*
the recovery path, and refusing them would only mean doing it in SQL.

`deleteSchoolMember` and `referencedExplanation` are shared by all four
surfaces: two places refusing for the same reason must not word it differently.

**No new permission key.** Delete is gated on `users.write`, the same key that
already permits deactivating and re-roling. A `users.delete` key would be a
two-place change requiring a migration (§5o) for a distinction nobody asked to
draw.

### 2. The selected branding template reached one colour out of five

`school_branding` stores five colours. `PalettePreview` draws a portal mock-up
in all five — header in `primary`, sidebar in `secondary`, page in
`background`, body in `text`, a marker in `accent` — and the picker shows five
swatches. **Only `--brand-primary` was ever consumed.** Measured before the
fix: 136 uses of `brand-*` across 93 files, every one of them `primary`. The
shell painted `bg-slate-50` while `--brand-background` sat set and unread.

So a school chose a five-colour template and got a coloured button. That is
exactly "the selected style template is not fully applied", and the preview was
the specification the product had never met.

The four shells now match the preview. Verified in the browser against Sample
Test School on Crimson & Gold: `--brand-background` `250 247 245` painting the
page, `--brand-secondary` `127 29 29` the sidebar, `--brand-primary`
`155 44 44` the navbar, `--brand-accent` at 25% marking the current page.

**Three new variables are computed, not stored.** `--brand-on-primary`,
`--brand-on-secondary` and `--brand-on-accent` are near-black or near-white by
WCAG luminance against the surface they sit on. Painting a surface in a
school's colour means something must be legible on it, and the shells had
hardcoded `text-white` — correct for the navy default and all three presets,
**wrong for a school whose logo is yellow**, which `lib/color-extraction.ts`
will happily produce a primary from. Computed rather than stored so schools
themed before this change get them without a migration.

`lib/color-contrast.ts` is new and dependency-free: the WCAG arithmetic used to
live only inside `lib/color-extraction.ts`, which is `server-only` and pulls in
sharp and node-vibrant. So contrast was checked when *deriving* a palette and
never when *painting* with one. One implementation now does both.

Sidebar hierarchy is expressed as opacity on `onSecondary` (75% resting, 40%
placeholder, 50% section heading) rather than fixed slates, because a tint of
the computed foreground is legible on any surface and a slate is not.

**Not repainted, and deliberately:** cards and tables stay white on slate, as
the preview has always shown them. Page bodies still set `text-slate-900`
explicitly in many places, so `--brand-text` is inherited by the shell but
overridden there. Since every palette's `text` is a contrast-checked near-black
(`#1a1a1a`, `#111111`, `#0d0d12`), the visible difference is nil and the diff
would have been sweeping.

### 3. The status filter contradicted the badges beside it

The table drew three states. The filter offered two — Active only / Inactive
only — both read from `is_active`. A member who has never signed in has
`is_active = true`, so **"Active only" returned every Pending row as well**.

Status is now three values from one server-side definition
(`USER_STATUSES`), read from `auth_user_id` rather than `joined_at` — having a
Supabase identity is what "has signed in" means, and it is the source §5g
already moved the Super Admin table to. The school directory and the user
profile panel both still said "Pending" / "Invite pending"; both now read
**Active / Never signed in / Deactivated**, matching the badge to the filter.

**The filters are now faceted.** Each dropdown offers only the values that still
return rows under the *other* filters, with counts: choosing Status = Active
narrowed Role to `School Administrator (2), Teacher (1)` — Student disappeared,
because no student has signed in — and Branch to `STS Main (1), No branch (2)`.
Every facet is counted with **its own** dimension excluded and the others
applied; counting a dimension against its own selection would collapse each
dropdown to the value already chosen and there would be no way to change your
mind. The current value is always kept in its own list even at zero, so a
filter can never become impossible to clear from the control that set it.

Two things fell out of this that were separately broken:

- **A branch filter could not find school-wide members at all.** `''` already
  meant "no filter", so `branch_id IS NULL` — every `school_admin` — was
  reachable only with the filter off. There is now an explicit
  **No branch (school-wide)** option.
- **Search now matches email**, not just name and phone. Under Supabase Auth
  the address is the identity; searching the directory by it and getting
  nothing was its own small lie.

Selection follows `ChallanTable`'s rule (§5e) — survives paging, cleared by any
filter change — for the reason recorded there, which matters more here: after a
filter change the rows chosen from are off screen, and carrying an invisible
selection into a new result set is how somebody deletes people they never
looked at.

### Verified in a browser, and what was not

Against the live database, Sample Test School, signed in as a school
administrator. A throwaway member was created, deleted through the bulk UI
alongside the operator's own row, and the database left exactly as found:

- `1 user deleted, 1 kept.` — the probe gone, **"You cannot delete your own
  account"** listed under "These were kept".
- Facets narrowing each other, as above. Badges reading "Never signed in".
- All eight brand variables present on the shell and painting the surfaces.
- No console errors. typecheck, lint and build all green.

**Not exercised:**

1. **The referential refusal was not triggered.** Provoking it means selecting
   somebody who has marked a register — and if they turn out not to have, they
   are deleted. The FK path is shared with the Super Admin delete that has been
   live since §5h; the translation into words is four lines. Worth doing
   against Sprint 10's seeded school, where losing a row costs nothing.
2. **The Super Admin bulk delete UI has not been clicked.** No operator session
   in this browser, and signing one in is the user's to do. The route was
   exercised through its shared code; the component is a near-copy of the
   school one.
3. **The last-administrator guard** was not driven to its refusal, for the same
   reason as (1).

### Two things worth knowing for the next browser session

**A worktree has no `.env.local`, and the dev server fails opaquely without
one.** It lives in the main repo (§5c) and Next loads it from the *project*
directory, so a dev server started in a worktree has no `DATABASE_URL` and every
school page renders **"School portal unavailable"** — which reads as a broken
tenant, not a missing environment. Copy it in for the session and delete it
after; `.gitignore:21` (`.env*.local`) already covers the worktree, checked with
`git check-ignore` before copying.

**`.claude/launch.json` now has `"autoPort": true.`** The user commonly has
their own dev server on 3000; without this the preview refuses to start rather
than picking another port. Cookies on `localhost` are not port-scoped, so a
session established on :3000 carries to the assigned port — but the tenant does
not, because the slug cookie is set per resolution: append
`?school=sample-test-school`.

---

## 5q. Sprint 10 — in progress (started 2026-08-09)

On `claude/pending-items-next-sprint-bfa612`.
**Migration `0018` is applied and verified** against the live database — six
tables, `fee_challans.family_challan_id`, and the `role_permissions` CHECK
widened. `0019` followed on 2026-08-10 — see below. **20 migrations recorded;
next free number `0020`.**

> `SPRINTS.md` names this sprint's migration `0017`. That number was taken by
> `0017_branding_presets.sql`. Every migration number in `SPRINTS.md` from
> Sprint 10 onward is one behind the repo.

### Done

| Piece | State |
| --- | --- |
| Schema + migration `0018` | ✅ applied and verified |
| Permission keys ×3 | ✅ both catalogues **and** the CHECK |
| CSV parsing + row validation | ✅ browser-verified |
| Import: upload → map → dry run → commit | ✅ browser-verified end to end |
| Promotion | ✅ browser-verified against 128 real students |
| Transfer with proration | ✅ browser-verified; needed migration `0019` |
| Family voucher | ✅ browser-verified, issue → pay → settle |
| Aged-debt report | ✅ browser-verified against 409 students |
| Adversarial seed script | ✅ run; 409 students live |

**Sprint 10 is complete and every piece has been clicked.**

### ⚠️ Migration `0019` — one active enrolment, not one enrolment

Applied 2026-08-10. **A design defect the browser found and nothing else could
have**: `student_enrollments` was uniquely indexed on
(location, student, year), but a transfer's whole design is to close the
enrolment at one campus and open another *in the same year*. Every transfer
failed at the database with "Something went wrong".

Editing the existing row in place was the obvious alternative and is wrong:
`attendance_records.enrollment_id` points at it, so a register taken at the old
campus in July would afterwards claim to have been taken at the new one. The
child really did have two placements that year and both have to exist.

The index is now **partial — `WHERE status = 'active'`**. The invariant that
matters is unchanged (a student is in one class at a time); closed rows
accumulate, which is what history is.

Two consequences worth carrying:

- **`transferStudent` closes the old row before inserting the new one.** Both
  are active for the instant between the statements otherwise, and Postgres
  checks a unique index on the insert, not at commit. Reversed, every transfer
  fails. The order is not cosmetic.
- **Promotion's "already enrolled" checks now filter on `active`.** A student
  transferred between campuses within the receiving year leaves a closed row
  there, and counting it would refuse to roll them over at all.

### Also found by clicking these two

- **The transfer picker had the same year-duplication defect as promotion** —
  "Grade 5 — A" three times, one per academic year, two of them refused by the
  route. Written twice before it was seen once. The campus is now named on
  every option, because this screen exists to move a child between campuses.
- **Family vouchers could be issued but not paid.** The route distributed a
  payment across the children's challans; the screen offered no way to record
  one, so a voucher could be raised and then only settled a child at a time —
  the queueing the feature exists to remove. A payment control is now on each
  row, pre-filled with the balance.

### The seeded school

**`Rehearsal Academy`, slug `rehearsal-academy`**, created by
`db/seed/adversarial-school.ts` and living in the same Supabase database as
`Sample Test School`. 409 students, 10 classes, 2 campuses, 3 academic years,
3 months of challans.

Re-running the script **replaces it** — it deletes the school on that slug and
reseeds, and `location_id` cascades to all 43 tenant tables. It refuses to
delete a school on that slug that does not carry its marker, so it cannot eat
somebody else's data.

**Two things the seed sets up that are not in the script**, because they belong
to the platform rather than the school, and both are needed again after every
reseed:

1. The **Admissions, Fee Management and Academics modules** must be switched
   on. Nothing in Sprint 10 is reachable otherwise.
2. Somebody needs a `school_users` row there. During this session the operator's
   existing Supabase identity was given a second membership — which is exactly
   the design in §5d, one person holding accounts at two schools — rather than
   creating a new sign-in.

### What the browser caught, and the lesson that repeated

Seven defects, none visible to typecheck, lint or build. **The same performance
defect appeared three times in three different features**, and it is worth
naming as a pattern rather than three bugs:

> **A loop of single-row writes is unusable against Supabase from anywhere.**
> Every statement is a round trip. The importer's dry run took 25 seconds for
> *seven* rows; saving 128 promotion decisions and applying them was nearly 400
> round trips inside one held-open transaction. All three are now one
> `UPDATE … FROM (VALUES …)` or a set-based `INSERT … SELECT`: a fixed number
> of statements whatever the row count. **Write bulk operations set-based from
> the start** — this is not an optimisation to come back to.

The others, briefly:

- **Promotion offered *earlier* years as destinations.** "A different year" is
  not "a later year", and since applying closes the old enrolment it would have
  rewritten history rather than extended it. Fixed in the picker and in the
  route, which is the actual gate.
- **Destination classes appeared once per academic year** — 21 entries for 7
  classes, two-thirds of which the route would refuse.
- **"Grade 5" appeared twice** with nothing to distinguish the campuses.
- **Re-opening an existing promotion returned "Something went wrong."** The
  unique index is deliberate; nothing translated it. An unapplied draft is now
  handed back rather than refused.
- **The importer discarded the admission numbers it was given** (§ above).

### What was proved by clicking, against the seeded school

- **Transfer.** Areeba Raza, Main Campus → Johar Town on 2026-08-09. Old
  enrolment closed as `transferred` and still naming Main Campus A; new one
  active at Johar Town from the effective date; PKR 5500 outstanding split
  8 days / 23 days as **4080.65 each way**; the August challan cancelled with
  the reason on it, and **June (paid) and July (partial) untouched** — the
  "a challan already paid is not clawed back" rule, in practice.
- **Family vouchers.** `RHA-F-2026-08-0001` over three siblings sharing one
  number, PKR 16,000. A part payment of 8,000 cleared the oldest challan in
  full (5,500) and part-paid the next (2,500), leaving the third untouched, with
  a `fee_payments` row against each. Settling the balance through the new
  payment control marked the voucher and all three children paid. Over-payment
  and cancelling-after-payment are both refused in words.
- **Promotion.** 122 promoted, 4 retained, 2 graduated of 128; last year's rows
  present and closed by status; every retained student still in the section
  they were in.
- **Aged debt.** 319 students, PKR 2,105,531, bucketed; 8 households with no
  contact reported as unchaseable.

### What is still NOT verified

1. **No import of anything near 2000 rows.** The seed is the first thing that
   could produce a file that size; export one from it and try.
2. **Nothing printed.** Unchanged from §5n — still the standing gap, and now
   the largest one.
3. **The Super Admin bulk delete UI** (§5p) is still unclicked.
4. **No second transfer of the same student**, so a student with three
   placements in one year is untested. The partial index allows it; nothing has
   produced one.

### The permission CHECK problem is now structural, not remembered

`db/schema/role-permissions.ts` builds the constraint from the `PERMISSIONS`
array rather than restating the keys, so drizzle-kit regenerated it on its own
when the three new keys were added. §5o's failure — five keys shipped that the
database refused — cannot recur by forgetting. It can still recur by
hand-writing a migration that restates the list; do not.

### What the browser caught in the import that the build did not

The standing evidence of §5j, again. All three were found by running a
deliberately messy file against the live database, and all three are fixed.

**1. The dry run was one round trip per row.** Seven rows took 25 seconds. At
the 2000 rows the importer accepts that is a request nobody waits out, with a
transaction held open across all of it. Now one
`UPDATE ... FROM (VALUES ...)` — one round trip whatever the file's size.

**2. Duplicate admission numbers went unreported when the row had a second
fault.** The check read the number off the parsed candidate, which is null the
moment a row has any error, so a duplicate hid behind a bad email address: fix
the email, re-upload, *then* discover the collision. It reads the raw mapped
value now.

**3. The supplied admission number was used to detect duplicates and then
thrown away.** The field's own hint promised "their existing number". A school
migrating eight hundred children has every fee receipt, certificate and filing
cabinet filed under the old number, so renumbering them on day one breaks the
link to all of it. `enrollStudent` takes `existingStudentId`; the counter is
deliberately not advanced past a supplied number, because the school's sequence
and ours need not be compatible.

### Measured: this machine is ~2.4 seconds per round trip to Supabase

Not a code problem and not fixable in code — page loads took 17–22 seconds in
dev against the same pooler. It matters for one design decision: **the commit
loop is one `enrollStudent` per student and cannot be batched**, because each
issues an admission number from a per-school counter and holds a connection for
its own transaction. 400 students would be ~13 minutes *from here*. Co-located
on Hostinger it is seconds. **Do not conclude the importer is slow from a
measurement taken on this machine** — but do re-measure it once deployed,
because if it is slow there it needs a job queue rather than a request.

### Changed on the live database, and reversible

- **The Admissions module was switched on for `Sample Test School`** (direct
  SQL, so no audit row). Sprint 10 is entirely admissions-side and none of it
  is reachable with the module off. Switch it back from
  `/super-admin/modules` if it should be off.
- Test students and import batches created during verification were **removed**.
  `student_import_batches` and `student_import_rows` are both empty;
  `student_profiles` is back to 8.

### Verified in the browser

Against `Sample Test School` with an eight-row file written to be hostile: a
UTF-8 BOM, a quoted field containing a comma, `M`/`F` genders, a day-first
date, an ISO date, `31/02/2015`, a malformed phone, a missing name, an
unrecognised relationship, a bad email, and the same admission number twice.

All eight columns were guessed from headers like `Father Mobile` and `Sex`.
Five rows were refused with their own reasons, by spreadsheet row number. Two
imported. `09/03/2015` stored as `2015-03-09`, `uncle` folded to `other`,
`03001112221` normalised to `+923001112221`. A second file proved a supplied
`GVS-2019-0042` is kept while a blank one gets `STS-2026-0003`.

**Not verified:** a file anywhere near 2000 rows, and therefore neither the
commit loop's real duration nor whether the report screen is usable with
hundreds of failures. Both belong with the seed script, which is the first
thing that will produce a file that size.

---

## 5r. Dress rehearsal — started 2026-08-10

### ⚠️ This is not the R1 exit gate, and cannot be yet

`SPRINTS.md` §1.1 schedules the rehearsal for **Sep 4–7, after Sprints 11, 12
and 13**. None of those exist. So what has been run is a rehearsal of Sprints
0–10 — everything built — and it certifies nothing about R1. Its value is that
it finds defects now rather than in September, and on that it delivered
immediately.

**Still missing from R1:** Sprint 11 (communications), Sprint 12 (reports &
analytics), Sprint 13 (portals + PWA + BR4). The parent and student portals in
particular have no results view, so "every role" cannot be exercised.

### The seed now carries a full examined term

Printing was unprovable without one: a report card, a tabulation sheet and an
admit card are all views over exam data, and the fixture had none. The seed now
adds 5 subjects, a grading scheme, a **published** First Term, one exam per
section, **50 papers, 2,121 marks, 63 absences and 76 re-sits**, plus a
fortnight of registers so the attendance panel is not blank.

Deliberately imperfect, like the rest of it: absences are `is_absent` with a
null mark rather than a zero, some marks fall below the pass mark, one paper per
exam stays **unpublished** so the report card has something it must not show,
and mid-term joiners are skipped in the register rather than marked absent.

### All four printed documents render, and are correct

Verified by revealing the print root and reading the compiled `@media print`
rules — the same method §5n used, and still **not** a sheet of A4.

| Document | Result |
| --- | --- |
| Report card | 44 cards, 43 page breaks. The unpublished paper correctly absent from both the subject list and the `/400` denominator. `ABS` printed, and **"Not ranked (absent from 2 papers)"** — §5n's policy, working. |
| Tabulation sheet | 44 rows, unpublished paper daggered and **included** at `/500` — right, it is a review sheet behind `exams.read`. Legend states the absence policy correctly. Position holders block. |
| Admit card | 44 cards, all five papers including the unpublished one — right, a datesheet is not a result. |
| Fee challan | Three copies, cut line, amount in words, concession column. |

The cascade is right in the compiled stylesheet: `display: none` on screen,
`display: block` + `visibility: visible` under print.

### Three defects found

**1. The suggested grading ladder had no band below 33%.** A card printed
`Mathematics 22% —` beside `Science 71% A`. §5n's "a dash, not an invented F"
rule is about a school that has configured *nothing*; for a school that has
configured a ladder and simply had a child fail, a blank grade reads as a broken
report card. `SUGGESTED_BANDS` now offers **F, 0–32.99**. The resolver is
unchanged, and a school that would rather leave failures blank deletes the band.

**2. The seed marker was printing on every fee challan.** It lived in the
school's postal address — which the challan carries, along with the name,
campus and telephone — so every voucher a parent would take to a bank read
`12 Ferozepur Road, Lahore — SEEDED-BY db/seed/adversarial-school.ts`. It has
moved to the school's **email**, on a `.invalid` domain that RFC 2606 reserves,
so no real school can hold it by accident.

*The guard proved itself in the process*: after the change, re-running the seed
**refused** to delete the school still carrying the old marker, exactly as
designed. It had to be removed deliberately once.

**3. Ambiguous class names, for the fourth and fifth time.** The report-card
picker showed "Grade 5 — A" twice with nothing to distinguish the campuses, and
so did the exam scheduler. That is the same defect already fixed in the
promotion picker, the aged-debt filter and the transfer picker — **fixed four
times and still present in a fifth place**, which is the tell that it needed one
home rather than four patches.

`lib/class-labels.ts` now owns the rule and all five call sites use it. The rule
itself is unchanged: **qualify only what is actually ambiguous**, so a
single-campus school is never made to read its own name against every class.

### Still not verified

1. **Nothing has been on paper.** Unchanged, and now the only thing between
   here and a printed-document sign-off. Margins, the A4 page break and the
   landscape tabulation grid are all unproven at real size.
2. **No school in the fixture has a logo**, so `PrintLetterhead` has still only
   ever rendered its name-only fallback on these documents (§5o proved the logo
   path separately, on `Sample Test School`).
3. **Sprints 11–13**, as above.

---

## 5s. The bulk switches, and the dead Settings link — 2026-08-10

Two things the user found by looking at `/super-admin/modules`.

**The switch was contradicting its own badge.** Every Phase 1 module reported
"on everywhere" for the selected school and every switch beside it read
*Leave*. Both were true — the modules were on, and the operator had not chosen
anything yet — but a screen that says "on" and shows "not on" in the same row
is not defensible, whatever the second control technically means.

"Leave" is gone. A switch is On or Off, it opens on what the selected schools
actually hold, and the safety it used to buy is now bought by the **baseline**:
`BulkModuleManager` reads the selection's current state (it always did — that
is where the badges come from) and sends only the flags whose switch differs
from it. An untouched flag still never reaches the database, which was the
entire point of the third state. Consequences worth knowing:

- **Nothing can be decided before the baseline is known.** The switches are
  inert until schools are selected *and* their state has loaded, and the apply
  button says "Reading current settings…" meanwhile. This is stricter than
  before, when a choice could be made against an empty page.
- **A mixed selection lights neither side** — three schools with two on is
  genuinely not On and not Off. The badge already said "on at 2 of 3"; pressing
  either side is then a real change, because either one normalises the group.
- **A moved switch is ringed** in the brand colour. One changed row out of
  twelve was otherwise invisible.
- Moving a switch and moving it back leaves zero changes, not two.
- "Reset choices" is now "Undo my changes", because there is a baseline to
  return to and that is what it returns to.

**The Settings sidebar entry is removed.** It pointed at
`/super-admin/settings`, which was never built, appears nowhere in
`SPRINTS.md` or `ROADMAP.md`, and had been dimmed with "Coming in a later
sprint" since §5f. Everything a Super Admin configures is per-school and lives
on that school's own tabs; the one cross-school screen is Modules. The
`placeholder` support in `SuperAdminSidebar` went with it — the other four
portals' sidebars have their own copies and are untouched.

**Verified in the browser against the live database**, not just built: Phase 1
now shows On beside "on everywhere"; a three-school selection shows HR &
Payroll as "on at 1 of 3" with neither side lit; switching Event Management on
for Rehearsal Academy sent exactly `{"updates":[{"module_key":"event_mgmt",
"is_enabled":true}]}` and nothing else; re-selecting the school afterwards read
the new baseline back as "on everywhere" with the switch on and nothing left to
apply — which is the whole mechanism demonstrated end to end. Reverted
afterwards, so the fixture is where it started. No console errors.

---

## 5t. The enrolment form, and a branding page that named the wrong theme — 2026-08-10

Four things the user reported from the school-admin CRM. All four are fixed, and
all four were checked by clicking against the live database rather than only
built.

**Two probe students** (`STS-2026-0004`, `RHA-2026-0410`) were enrolled to prove
the paths end to end and deleted afterwards; the fixtures are back at 6 / 409 / 2
students. Their sequence numbers stayed spent, which is by design — gaps are
harmless, duplicates are not.

**One field was rebuilt after the browser caught it.** The masked input first
rendered a derived string (`•••••-•••••67-1`) and had to be read-only so typing
would not edit the mask — which meant the first digit landed and the second was
refused. It passed a scripted test only because automated typing outran React's
re-render. It now obscures with `text-security` and leaves the input alone, so
the real value is always what is being edited. Worth remembering: a scripted
"type the whole string" is not a test of a controlled, reformatting field.

### Migration `0020` — applied and verified 2026-08-10

`db/migrations/0020_student_id_document_type.sql` adds
`student_profiles.id_document_type` (`text`, nullable, CHECK `'cnic' | 'b_form'`).
Additive, and deliberately **not** back-filled — see below for why guessing would
be worse than a null.

Verified against the live schema after applying: the column is `text NOT NULL =
NO`, the CHECK reads
`id_document_type IS NULL OR id_document_type = ANY (ARRAY['cnic','b_form'])`,
and all **417** student rows survived with **0** typed, which is the intended
starting state. Next free number: **`0021`**.

`lib/admissions-queries.ts` selects the column, so the student directory and
profile pages would fail against a database without it — worth knowing if this
branch is ever deployed somewhere the migration has not run.

### 1. The branding page named a theme the school was not using

`/dashboard/settings` reported **"Vibrant — in use"** for Sample Test School,
whose branding row holds `preset_key = 'crimson-gold'`. Neither half of that was
a rendering slip:

- `GET /api/school/branding` **never returned `presetKey`**. It returned
  `selectedPalette`, which for a school on a preset is simply whatever integer
  the column happened to hold — `0` by default, i.e. Vibrant — while
  `selectedPaletteOf()` was painting the portal around it in the preset.
- The two screens also disagreed on names. Super Admin called the third derived
  palette *Auto-complementary*; this page called it *Balanced*. An operator
  comparing the two screens was comparing labels that did not line up.

Fixed at all three levels, because a caption alone would still have been a page
that cannot express the setting it is editing:

- The route returns `presetKey`, and its `PATCH` now accepts one.
- The school page shows the presets as well as the logo palettes, and a derived
  palette is "in use" only when `presetKey === null`.
- `DERIVED_PALETTE_NAMES` in `lib/palette-presets.ts` is now the single source
  of those three names; both screens import it.

Presets became school-selectable rather than Super-Admin-only on purpose. Listing
a preset a school cannot choose would be a one-way door: the first switch to a
logo palette clears it, and nothing on the page could put it back.

### 2. "B-Form / CNIC" is now a document *and* a number

One free-text box was recording a thirteen-digit number that nobody could
attribute to a document — a child's B-Form is the same `42101-1234567-1` shape as
the CNIC they will hold at eighteen. So the form asks which document first
(`components/admissions/NationalIdField.tsx`), and:

- **CNIC / Smart Card** is masked to digits only and reformatted as typed —
  5, then 7, then 1. Anything else is refused, at the field *and* in
  `parseStudentInput`, because the form is one caller of that route.
- **B-Form** is free text. Numbering has varied across issuing offices and older
  certificates do not all fit one pattern; a school must be able to record the
  number on the paper in front of them.
- **Both are hidden by default** behind an eye toggle
  (`components/ui/SecretInput.tsx`), on the enrolment form, on the review step,
  and on the student profile. Deliberately not `type="password"`: the last four
  characters stay readable so a clerk can confirm the record, and the field still
  reformats as it is typed. The consequence is that while hidden the input shows
  a derived string, so it is read-only until revealed.

The document type is stored, not inferred. Inferring it from the digits is
exactly the ambiguity the column exists to end — and the bulk import therefore
writes `null` rather than guessing, because a spreadsheet column headed
"B-Form / CNIC" does not say which was written in it.

### 3. Religion and nationality are dropdowns

`lib/student-reference-data.ts`. Both were free text, and free text made the
board's own headcount a reconciliation rather than a query. `Other` is last on
both lists — a closed list that cannot express a real child is worse than free
text, because the clerk picks the nearest wrong answer and the record lies.

The columns stay `text`. `optionsWithCurrent()` keeps any stored value that
predates the list as its own option; without it, opening an older record would
silently re-point their religion at the first option the moment anything else on
the form was saved.

### 4. The enrolment error — a school that imported its roll could never enrol again

Reproduced in the browser against Rehearsal Academy. The message the user saw is
`enrollment_failed` — *"Could not complete the enrolment. Please check the
details and try again."* — and the details had nothing to do with it. The
database was rejecting:

```
duplicate key value violates unique constraint
  "student_profiles_location_id_student_id_idx"
Key (location_id, student_id) = (66a9f0c6…, RHA-2026-0001) already exists.
```

**Two correct decisions collided.** A bulk import keeps the school's own
admission numbers and deliberately does *not* advance `school_id_sequences` —
renumbering a migrated roll breaks every receipt and certificate already filed
under the old numbers, so that is right. It is only safe while the two
sequences never meet. They meet the moment a school's own numbering *is* our
numbering: Rehearsal Academy imported 409 children as
`RHA-2026-0001`…`RHA-2026-0409` and left the counter at zero, so the next direct
enrolment minted `RHA-2026-0001` and hit the unique index.

And it did not fail once. Each attempt spends a number, so the school would have
had to fail **409 times** before an enrolment could land. Sample Test School was
never affected — its seeded roll is `STS-S00x`, which shares no space with ours
— which is why enrolling there worked throughout and why this looked
intermittent.

`generateStudentId` now checks its candidate against the roll and, on a
collision, reconciles once: it reads the highest sequence actually in use for
that school and year (`LIKE 'RHA-2026-%'`, ignoring anything not in the exact
printed form) and pushes the counter past it with `GREATEST`, so a concurrent
enrolment that has already gone further is never wound back. After that one
reconciliation the ordinary path resumes. A number still taken at that point is
a genuine race, and is reported as one rather than retried in a loop that would
burn a number per turn. `previewNextStudentId` asks the same question, so the
review step no longer shows a number that is on another child's file.

**Verified against the live database**: the same request that returned
`enrollment_failed` returned `RHA-2026-0410` after the fix.

---

## 5u. Super Admin 401 on the live deployment — 2026-08-11

**Symptom.** `POST https://schoolhub.codexmill.com/api/super-admin/auth/login`
returns **401**, with credentials that work locally. The panel displayed it as
"Session expired.", which sent two sessions after cookies, `Secure` flags and
HTTPS. None of those were involved.

### Where the 401 can come from — there is only one place

Middleware computes `isAuthEndpoint` for `/api/super-admin/auth/*` and returns
`NextResponse.next()` **before** its session check, so it cannot 401 this
route. `readJsonBody` failure is 400; the throttle is 429; a missing
`SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD_HASH` / `SUPER_ADMIN_JWT_SECRET` is
**500** `server_misconfigured`. That leaves `invalid_credentials` in
`app/api/super-admin/auth/login/route.ts`, reached only when
`verifySuperAdminCredentials` returns `invalid`.

**So the variables are present on the host.** Either the email did not match,
or bcrypt returned false.

### Why it left no trace

`compare()` in bcryptjs 3.0.3 begins:

```js
if (hash.length !== 60) return false;
```

Probed against the installed version — a hash damaged in transit does **not**
throw:

| Form | Length | `compare` |
| --- | --- | --- |
| raw `$2b$12$…` | 60 | `true` |
| escaped `\$2b\$12\$…` | 63 | `false` |
| `$2b$`/`$12$` expanded away | 53 | `false` |
| wrapped in quotes | 62 | `false` |
| trailing newline | 61 | `false` |

Every failure mode answers "wrong password" silently. Hence a bare 401 with an
empty log.

### The trap: the correct escaping is opposite in the two places

`.env.local` needs `"\$2b\$12\$…"` because `@next/env` runs dotenv-expand over
it. Hostinger's panel needs the **raw** `$2b$12$…`. Copying the working local
line into the panel breaks it; so does a host that materialises panel variables
into a file something later expands. Both give the identical silent 401, which
is why this must be **measured, not guessed** — the fix points in opposite
directions depending on the mechanism.

### What was changed

- `lib/super-admin-credentials.ts` logs every refusal: which half failed, and
  the hash's *shape* (length, prefix, backslashes). Never the hash — it is
  offline-crackable. The client response is unchanged and still
  indistinguishable, so non-enumeration holds.
- `scripts/check-super-admin-env.mjs` (`npm run check-super-admin`) prints what
  the running process sees, names the mangling, lists any `.env` file
  overriding the panel, and optionally confirms the password against the hash.
  Only the files Next actually loads are flagged — an earlier version flagged
  `.env.example` and would have sent someone to delete the documentation.
- `lib/super-admin-client.ts` no longer converts the login route's own 401 into
  "Session expired." That interception is what hid the real error for two
  sessions.

### CONFIRMED against the live host, 2026-08-11

The user redeployed and the new log line answered it outright:

```
[super-admin] sign-in refused. email matched: true; password matched: false;
SUPER_ADMIN_PASSWORD_HASH is MALFORMED: 63 chars, expected 60,
contains a backslash, starts "\$2b".
```

**The email was never wrong.** The hash reaching the process is the escaped
`\$2b\$12\$…` form — 63 characters, three backslashes. Exactly the failure
predicted above, and the reason two earlier sessions chased cookies instead.

The user had already corrected the *panel* to the raw form before this log was
produced, which first suggested a `.env` file beside `server.js` was overriding
it. **Measured, and it cannot be**: `@next/env` 15.5.22 does not replace a
variable that already exists in the environment.

| Panel sets | File sets | Process gets |
| --- | --- | --- |
| `from-the-panel` | `from-the-file` | **`from-the-panel`** |
| `from-the-panel` | *(empty key)* | **`from-the-panel`** |
| *(nothing)* | `from-the-file` | `from-the-file` |

So a wrong value in the running process **came from the panel**, full stop.
`DEPLOYMENT.md` §3 asserted the opposite — that a file overwrites panel values
and that empty keys blank every secret — and has been corrected. That claim
sent this session's first answer to the wrong place, and would have sent the
next one there too.

### Second round: the panel was corrected and it still failed

The user regenerated the hash, verified it as exactly 60 characters in the
Hostinger panel, and sign-in still returned `invalid_credentials`. They were
also right to object that local testing proves nothing about their deployment.

**The gap that mattered: nothing had ever inspected the deployed process.** The
boot log, the `.mjs` script and every local run read some *other* process. So
`POST /api/internal/super-admin-check` now reports from inside the live one —
pid and uptime, the configured email, the hash's length/prefix/**fingerprint**,
the `.env` files beside it, and a bcrypt comparison performed there. Guarded by
`SUPER_ADMIN_DIAGNOSTICS_SECRET`, disabled (503) whenever that is unset, and
returning only shapes and booleans.

The fingerprint is the part that earns its place: length and prefix cannot
distinguish two different well-formed hashes, so "the panel says 60 characters"
was never evidence that the process holds *that* hash. `npm run fingerprint`
computes the same digest locally to compare.

**A third mangling mode, found by accident while testing this:** dotenv strips
single quotes and *then* expands, so `SUPER_ADMIN_PASSWORD_HASH='$2b$12$…'` in
a `.env` file resolves to **36 characters** with the prefix gone. Only `\$`
escaping works in those files. The general lesson, and the reason the endpoint
exists: **the value a panel displays is not necessarily the value the process
receives.**

### ROOT CAUSE FOUND — `scripts/hash-password.mjs` printed the backslashes

The user reported a **fresh** deployment still receiving 63 characters with
backslashes after entering a raw 60-character value, and asked for the exact
place the `\` is introduced. It was in this repository, at
`scripts/hash-password.mjs:94`:

```js
console.log(`SUPER_ADMIN_PASSWORD_HASH="${hash.replaceAll('$', '\\$')}"`);
```

That was the script's **only** output. It never printed the raw hash, and
nothing in it said the value was escaped or that a hosting panel needs the
opposite. `DEPLOYMENT.md` and `.env.example` both told the operator to run it.
Measured: its output is 63 characters with 3 backslashes — byte-for-byte what
the live process reported.

So the chain was: run `npm run hash-password` → copy the only line it prints →
paste into Hostinger → process holds 63 chars → `compare()` returns false on
length → 401. The panel was never "wrong"; it faithfully stored what this
repository told the operator to paste.

Nothing else transforms it. Confirmed by inspection: `ci.yml` sets no
environment, `next.config.mjs` only reads `SUPABASE_URL`, there is no
Dockerfile, no PM2 config, no deploy script, and nothing anywhere writes a
`.env` file.

**Fixed:** the script now prints both forms, labelled, with character counts
and a note that they are not interchangeable. Anyone who generated a hash
before 2026-08-11 must regenerate it.

The three hypotheses below were the ranked guesses before the cause was found.
Two of them were wrong; keeping them is a reminder that the diagnostics
endpoint was built to distinguish them and the answer turned out to be in the
repo all along:

1. **The process is not holding what the panel shows** — something between them
   expands `$`, or the process was never restarted after the edit. The
   fingerprint settles it.
2. **More than one instance is serving.** The runtime log prints two Next.js
   banners and two `Ready` lines per boot; if the proxy round-robins, one may
   hold pre-edit environment. Repeated calls showing a changing `process.pid`
   would confirm it.
3. **The password typed differs from the one hashed** — `comparison.passwordMatches`
   answers this inside the live process.

### QA against the production artifact — 2026-08-11

The fix was verified on the **standalone build running as `node server.js` with
`NODE_ENV=production`** and the environment injected the way a panel does, not
on a dev server. A controlled A/B on the same artifact:

| `SUPER_ADMIN_PASSWORD_HASH` | Result |
| --- | --- |
| raw, 60 chars | login **200** + `Secure; HttpOnly; SameSite=lax` cookie |
| escaped, 63 chars | login **401 `invalid_credentials`** — the live symptom exactly |

Full flow on the raw-hash instance: wrong password → 401; correct → 200 with
the cookie; `/super-admin` without a cookie → 307 to the login page; with the
cookie → layout renders the operator's email (session verified server-side);
`/api/super-admin/schools` without a cookie → 401 from middleware, with one →
past the gate; logout → 200 and `Max-Age=0`.

Two limits of this QA, stated plainly: it ran on the build machine, not on
Hostinger, and `DATABASE_URL` was deliberately unset, so pages that query the
database answered 500. Neither touches the authentication path.

`bcryptjs` is **not** in `.next/standalone/node_modules` — webpack inlines it
into the server chunks. The artifact is self-contained; its absence there is
not a missing dependency.

### Two other things this log showed

1. **The app appears to start twice.** Every boot prints two `▲ Next.js`
   banners and two `Ready in …` lines, and shutdown reports `Error: Server is
   not running.` twice. Two processes on one port means the email-outbox
   drainer runs twice — a duplicate-send risk — and makes "which process holds
   which env" ambiguous. Not diagnosed yet; worth settling before the pilot.
2. **The host runs Node 20**, which `@supabase/supabase-js` now warns is
   deprecated. Not related to this bug. `DEPLOYMENT.md` says Node 20+; that
   floor should move to 22 before the warning becomes a break.

---

## 5v. Super Admin login WORKS on the live deployment — 2026-08-11

**Resolved.** The user signed in successfully at `schoolhub.codexmill.com`
after the fix below. This closes the 401 that ran from 2026-08-10 through
five sessions.

### What actually fixed it: repair on read, instead of guessing the form

`normalizeBcryptHash()` in `lib/super-admin-hash-shape.ts` strips wrapping
quotes and backslashes escaping a `$`, and `lib/super-admin-credentials.ts`
compares against the repaired value. Measured against real bcrypt before
shipping — escaped (63), double-quoted (62), single-quoted (62),
quoted+escaped (65), trailing newline (61) and leading space (61) **all repair
to 60 and verify**; the shell-expanded case (53) is deliberately **not**
repaired and still fails, because those bytes are gone rather than hidden.

Why this was the right move rather than one more attempt to determine the
stored form: the correct form differs per host, the operator cannot observe
what the process received, and bcryptjs reports every failure identically as
"wrong password". The ambiguity was the bug. Removing the ambiguity ends it
permanently, on this host and any future one.

Shipped as `18b939a` on `main`; Hostinger auto-built it as `019ff28b`.

### ⚠️ TWO PLATFORM FACTS THAT INVALIDATE EARLIER SECTIONS

**1. The hPanel Environment screen and the `.env` file are ONE store.**
Deleting `.env` in File Manager wiped every panel entry. §5u's precedence
table (panel beats file) describes `@next/env` correctly but **cannot be
applied to this host** — there is no second store. Add and remove variables
only through the Environment UI. Note the delay in symptoms: a running process
keeps its environment in memory, so the site stays up until the next restart,
which makes the damage look unrelated to its cause.

**2. Pushing to `main` deploys to production automatically.** A push at
20:37:11 started a build within seconds. There is no manual gate;
`deploy.yml` is an additional path, not the only one. `NEXT_PUBLIC_*` are
inlined at build time, so they must be in the panel *before* any push.

### Still unknown, and worth settling

- **Why the process reported 63 characters** while the panel and file both
  showed 60. Not diagnosed — the fix made it moot for sign-in, but if the host
  really does escape `$`, the same damage silently affects
  `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_PASS` and `DATABASE_URL`, where it
  presents as an auth error or a bad connection string. The diagnostics
  endpoint now reports `repairedOnRead`, which answers it in one call.
- **The double-start** (§5u) is still unconfirmed. Hostinger exposes no runtime
  logs at all — hPanel showed none, and the deployment log ends at the build
  output — so the *only* way to see `process.pid` is the diagnostics endpoint.
- Node 20 → 22, still outstanding.

### Note: this host has no runtime logs

Both log-based diagnostics this project built (`instrumentation.ts`'s boot
check and the refusal log in `lib/super-admin-credentials.ts`) are
**unreadable on Hostinger**. Do not plan a diagnosis around them here. The
diagnostics endpoint is the only instrument that works.

---

## 5w. Automatic subdomain provisioning — built 2026-08-11

**The gap:** creating a school never created its subdomain. Not broken —
never built. `POST /api/super-admin/schools` inserted a row and created an
admin, and nothing else; there was no Hostinger client anywhere in the repo.
§3 and `DEPLOYMENT.md` §5 had both recorded this as a manual step.

### The discovery that made it possible

**Hostinger "subdomain" ≠ "parked domain", and the difference is everything.**
A subdomain creates a separate LiteSpeed/PHP vhost with its own document root —
it resolves, gets its own certificate, and **never reaches the Node process**.
A parked domain is an alias of the parent website: same root, same process,
original `Host` header, which is what `subdomainFromHost` needs.

Proven with an A/B on the live host: `credo.schoolhub.codexmill.com` parked
against `schoolhub.codexmill.com` answered `/login` with the tenant sign-in page
(`X-Powered-By: Next.js`), while the platform host answered the same path with
"School not found". TLS auto-issued ~3 minutes after creation. **No wildcard
DNS and no Cloudflare needed.**

Also established: the edge routes unknown hostnames to a Hostinger parking page,
so an unprovisioned tenant host never reaches the app at all — and
`PLATFORM_BASE_DOMAIN` is confirmed as `schoolhub.codexmill.com`. It **must** be
the full host: with the apex, `credo.schoolhub…` yields the label
`credo.schoolhub`, which contains a dot, and every tenant silently 404s.

### What was built

`lib/hostinger.ts` (parked-domain client, never throws), `lib/subdomain-status.ts`
(one descriptor so badge/label/retryability cannot drift), migration `0021`
(applied and verified: 3 columns + CHECK, 22 recorded, 4 schools on `pending`),
provisioning wired into school creation as a **non-fatal** step, a retry route,
and a Provision / Re-check control on the schools list.

Idempotent in three layers: list-then-create, "already exists" counts as
success, and the delete endpoint is deliberately never wrapped.

### Settled while here: the double-start is NOT a duplicate-send risk

`drainOutbox` claims with `FOR UPDATE SKIP LOCKED`, which is precisely the
cross-process guard, on top of the per-process `drainTimer` and `draining`
flags. Two processes cannot double-send. The double-start itself is still
unconfirmed (no runtime logs on this host) but is no longer urgent.

### ⚠ Node 22 did not take

`engines` is now `>=22`, but the git deployment pins `node_version: 20` in its
own configuration and does **not** read package.json. The build now warns that
the app itself is unsupported. Harmless today (npm warns, does not fail), but
**the Node version must be changed in hPanel** — there is no MCP tool for it,
and the only API that accepts `node_version` is archive-based, which would
break the git deployment.

---

## 5x. Competitor gap review, and ten product decisions — 2026-08-12

*(Numbered 5x, not 5u: §5u–§5w on `main` are the Hostinger deployment
investigation. This session landed alongside them.)*

The user supplied the **full transcript** of the OurSchoolSoftware demo video
(`E:\SMS details from OurSchoolSoftware.hi.en.docx`) and asked what we do not
have. No code changed this session; `SPRINTS.md`, `ROADMAP.md` and this file did.

**Findings** are in `ROADMAP.md` §2a — the sections the earlier §2b review had
missed, chiefly the entire accounting surface, the printed-document suite, the
inquiry register and subject-wise attendance. It also corrects §2b's claim that
ID cards and certificates are "already covered by us": **they are not built at
all**, only the framework they would sit on.

**Decisions** are in `SPRINTS.md` §0.9. The five that change the most:

1. **No SMS gateway, ever.** Chat + email carry everything; WhatsApp for schools
   that subscribe. The competitor's SMS-triggered *events* still get built, on
   our channels. This question is closed — do not re-open it.
2. **Accounting is mandatory**, at Sprint 13.5, *before* payments and POS,
   because all three post to one append-only ledger and retrofitting a ledger
   under live money is the expensive version of that work.
3. **Biometric and native apps are now in scope**, reversing `SPRINTS.md` §6.
   Biometric works from the cloud because ZKTeco-family devices push logs
   outbound to a URL — no local agent. The app is a **Capacitor wrapper around
   the existing PWA**, not React Native, so there is no second UI to maintain.
4. **Self-hosted Jitsi for online classes.** Per-participant-minute vendors cost
   ~$400/school/month at ordinary usage against flat subscription revenue; a VPS
   is ~$50/month for the whole platform. The platform now operates a box.
5. **Per-school language in Super Admin, all languages.** The app *shell* and
   every print template get real i18n; browser translation handles long-form
   content only. It must never touch labels, names or amounts — a machine
   -translated fee challan at a bank counter is a real failure. **RTL is the
   expensive half**, and it is sequenced at 13.6 because the cost grows with
   every screen R2 adds.

**Six new sprints:** 13.5 accounting · 13.6 i18n · 16.5 documents ·
19.5 e-learning · 19.6 biometric · 19.7 mobile app + gate attendance. Smaller
items were folded into existing sprints — the table is `SPRINTS.md` §2.9.

**Also confirmed by the user:** payment-gateway merchant onboarding has begun;
push-notification reach is understood and accepted as a risk, so stop flagging
it; ID cards and certificates must work end to end including print fidelity.

**The release dates are gone.** They were auto-generated, never agreed, and are
deleted from `SPRINTS.md` §0.7, §0.8 #1, §1, §1.1 and §7. See the banner at the
top of this file.

### Both of these are now settled

- ~~**Video vendor**~~ — **decided by the user 2026-08-12: self-hosted Jitsi**,
  module-gated on `online_classes` like every other paid feature. The VPS is
  accepted as platform infrastructure. Do not re-propose a per-minute vendor.
- **App store accounts** — Apple Developer ($99/yr) and Google Play ($25). The
  user is registering them and **will confirm when they are ready**; that
  confirmation is the trigger for Sprint 19.7's store work, not for the build
  itself, which can proceed without them.

### Two things to verify before their sprints start

- **Biometric**: the first school's device model, and whether its firmware
  exposes push/ADMS rather than poll-only. Same protocol family, different
  firmware capability.
- **Online-class pricing**: the per-minute figures in §0.9 are approximate. The
  *ratio* is what drove the decision and is stable, but re-check the numbers at
  purchase.

---

## 5y. The next sprint is a UI overhaul — set 2026-08-12

**The user's instruction: the CRM is "flat and boring", has no icons or
graphics, and no charts on any dashboard. Sprint 10.5 is the next thing built,
and it is run with the `/impeccable` skill.** Planning only this session — no
component was touched, and the user said explicitly not to start.

Full plan in `SPRINTS.md` Sprint 10.5; the commercial argument in `ROADMAP.md`
§2 item 7b.

### What was measured, because it is worse than "needs polish"

- **8 UI primitives** in `components/ui/` (Badge, Button, Card, Input,
  SecretInput, Select, Textarea, Toggle) serving **105 components**. No Table,
  Modal, Tabs, Tooltip, Toast, EmptyState, Skeleton, Avatar, Breadcrumb or
  Pagination — every screen has been improvising them.
- **Exactly one of 105 component files contains an `<svg>`.** There is no icon
  library in `package.json`.
- **No charting library, and no chart anywhere in the product.**
- The token layer is genuinely good and is kept: `tailwind.config.ts` exposes
  per-tenant `brand.*` colours plus three computed `on*` foregrounds as CSS
  variables, with `shadow-card` and `rounded-card`.

### The two constraints whoever runs it must not discover the hard way

**1. There is no single palette to design against.** Each school picks its own
at runtime and it can be anything. A design that reads well in slate-and-indigo
and is illegible in a school's maroon is a regression. This is why the `on*`
foregrounds are computed, and §5p is the precedent — the branding template that
reached one colour of five. **Verify against three hostile palettes** — very
dark, very light, saturated mid-tone.

**2. Print must not move.** `PrintSheet` renders challans, report cards, admit
cards and payslips. A global stylesheet change already shipped blank vouchers
once (§5e). **Re-check every print template at the end of the sprint.**

### The charting decision, settled here rather than in Sprint 12

**Server-rendered SVG components on the brand tokens — not a charting library.**
Sprint 12 had deferred this and was blocked by it. Three reasons specific to
this codebase: a chart on a report card has to print and `PrintSheet` already
handles static SVG; `recharts` is ~100 kB gzipped against a <200 kB first-load
target, and there is currently no client-rendering library in the 14-package
dependency list; and the needed chart types (bar, line, donut, heatmap grid)
inherit per-tenant colour for free when written as our own SVG. Add a library
later for a genuinely interactive chart, for that chart only.

**Sprint 12 keeps the nine report types; Sprint 10.5 takes the dashboards.**
Reports are documents, dashboards are visualisation, and §2.9 had them tangled.

**One dependency to expect:** the dashboard's income/expense tiles need the
ledger from Sprint 13.5, which comes later. They land empty and must say so
rather than rendering a zero that reads as "you collected nothing".

**Scope discipline:** this is not a rewrite and adds no features or routes. If a
screen's *behaviour* changes, that is a defect in this sprint. The data,
permission and tenancy paths are QA'd and must come through untouched.

---

## 5z. Sprint 10.5 — design system and application shell, built 2026-08-13

Run with `/impeccable` as the user instructed. Eleven commits on
`claude/crm-ui-design-colors-2fe2d4`, branched from `main` at `d1c0338`.
**Not merged.** `typecheck`, `lint`, `build` and `check-theme` all green.

### What is done, and what is not

| Deliverable (SPRINTS.md §10.5) | Status |
| --- | --- |
| A — design system: icons, tokens, primitives | ✅ done |
| B — the application shell (sidebar, headers, states) | ✅ done |
| C — dashboard visualisation | ⚠️ **all but one surface** — seven wired (exams added 2026-08-15); only the report card's printed bar is left, and it is gated on a print check |
| D — the charting decision | ✅ settled and implemented |
| E — verification | ✅ done for components and the shell; not for real screens |

**Individual screens are still untouched.** All five shells are rebuilt, so
every page now sits inside the new frame with icons, a page-header slot,
skeletons and error boundaries — but the *content* of the 105 components is
unchanged. `PageHeader` exists and almost nothing uses it yet; that is the
cheapest remaining win.

### The shell, and the defect that turned out to matter most

`PortalSidebar` was `hidden … md:flex` **with nothing behind it**. Below 768px
the school-admin, teacher, student and parent portals had *no navigation at
all* — once on a page, the only way to another was the browser's back button.
Parents and students are the audiences most likely to be on a phone and least
likely to own a desktop, so this was the worst-placed gap in the product. The
Super Admin panel had the mirror fault: a permanently visible 240px column
eating a third of a phone screen.

`components/school/PortalFrame.tsx` now renders **one nav definition twice** —
inline on desktop, in a drawer on mobile. Keep it that way; two lists drift,
and an item present on one form factor and absent on the other is worse than
either.

**The sidebars became data, not components** (`school-nav.ts`,
`teacher-nav.ts`, `student-nav.ts`, `parent-nav.ts`). They had to: a component
can only be in one place, and the list is now in two. **Icons therefore cross
the boundary as string names** — the lists are assembled on the server from
permissions and module flags, and a React component is a function, which cannot
be passed from a server component to a client one. `components/school/nav-icons.ts`
is that lookup, keyed by *destination* (`'fees'`) rather than by glyph
(`'banknote'`), so changing which icon fees uses is one edit.

Other shell decisions worth not re-litigating:

- **`h-dvh`, not `h-screen`.** `100vh` on mobile Safari is the viewport with the
  browser chrome *hidden*, which put the bottom of every page under the address
  bar.
- **The collapse preference is read after mount**, not during render. Reading
  `localStorage` while rendering swaps the markup out from under hydration.
- **The active nav item has an edge marker as well as a tint.** On a school
  whose accent is close to its secondary the tint alone is nearly invisible, and
  "which page am I on" is the one question a sidebar exists to answer.
- **`RouteError` shows the digest and never the message.** Next.js masks server
  errors in production precisely because they leak column and constraint names,
  and this is a multi-tenant product.
- **The Super Admin shell stays visually unlike a tenant portal.** It uses the
  platform tokens, not a school palette, so an operator returning from inside a
  school knows it before switching Fee Management off for forty schools.

**Two pre-existing contrast failures were found and fixed while verifying it**:
sidebar section headings were 50% opacity (3.47:1 — live labels, no exemption,
now 70%) and disabled placeholders 40% (2.69:1 — WCAG 1.4.3 exempts inactive
components, but not to the point of illegibility; now 55%).

### The two user decisions taken this session

1. **Icons: `lucide-react`.** Recorded in `components/ui/Icon.tsx`. Tree-shakes
   (shared first-load JS is 102 kB against the <200 kB budget), and its ~500
   icons cover the domain vocabulary Heroicons' ~300 does not.
2. **Status colours are fully brand-derived** — the user chose this over fixed
   red/amber/green, having been shown that the naive form inverts meaning.
   Implemented as a *banded* derivation: each status leans toward the school's
   hue as far as it can while staying inside the range where it still means
   what it means. See below; do not "simplify" this back to a plain rotation.

### `lib/brand-derive.ts` — the load-bearing file

Five stored colours reached the shell and stopped; everything below it was
hardcoded `slate-*`, `white` and `red-600`, so a school picked maroon and got a
maroon frame around a grey CRM. This computes the other ~44 values — surfaces,
borders, inks, four statuses in five forms each, six chart series — from the
five, per request, with no migration.

**Three things it does that look like over-engineering and are not:**

- **`ensureAgainstAll`.** Every travelling token is pushed until it clears
  contrast against *every* surface it can be painted on, not just the page.
  Checking against the page and the card only left 18 real failures — muted
  text on table headers, on neutral badges, and inside selected rows.
- **Status hue bands.** Rotation alone passed every contrast and distinctness
  check and still gave the default blue a magenta danger beside a red warning:
  the warning colour looked more alarming than the danger colour. Bands cap the
  rotation. This is a *meaning* failure that no contrast metric can see.
- **`chooseBlend` evaluates finished colours, not hues.** Hue separation is a
  proxy and it is wrong in the orange-yellow band, where the contrast push
  converges two hues 31° apart into two indistinguishable browns. Forest Linen
  — a shipped preset — was the case that exposed it.

### ⚠️ The rule for everything built from here on

**No `slate-*`, no `text-white`, no `bg-white`, no `red-600` in application
code.** Use `surface`, `ink`, `line`, `status` and `brand` (see
`tailwind.config.ts`, which documents each). Anything else is invisible to a
school's palette and re-creates the bug this sprint exists to fix.

### Verification, and how to re-run it

```bash
npm run check-theme          # 7 palettes, every derived token vs every surface
npm run check-theme -- --css # regenerate the :root defaults in app/globals.css
```

`app/(public)/design-system` renders every primitive and chart once per palette
— the four real ones plus three hostile (very dark, pale gold, saturated
maroon). `app/(public)/design-system/shell` assembles the *real* `PortalFrame`,
`SchoolNavbar` and `schoolNav()` against a fixture with every permission and
every module on, so the widest sidebar and the mobile drawer can be exercised
without a session. **Both 404 outside development** (verified: `status: 404` in
the prerender meta), so they ship in nothing a school can reach. It exists because
every real screen is behind a session and a tenant, which makes the
hostile-palette check otherwise a check nobody runs.

Live-DOM contrast audit at the end: **994 rendered text elements across 7
palettes, 0 failures.** At 375px: no sideways page scroll, no uncontained
overflow, every table scrolling inside its own box.

### Print — checked, and one regression found and fixed

`PrintSheet`, `PrintNow` and the `@media print` block are **byte-identical to
`main`**. But `body` moved from `bg-white` to `bg-surface`, which would have
printed a dark sheet for a dark-palette school on any machine with "background
graphics" on. `@media print { body { background: #fff } }` restores the
previous behaviour exactly. §5e is why this was looked for.

**Still not verified against a real printer** — unchanged from §5n, and it
needs an authenticated session plus a person with paper.

### Two smaller things worth knowing

- **`DEFAULT_PALETTE` moved** to `lib/palette-presets.ts`, re-exported from
  `lib/branding.ts`, so no call site changed. It had to leave `branding.ts`
  because that module opens a Postgres connection and the audit script needs
  the default without one.
- **The worktree now has its own `node_modules`** (from installing
  `lucide-react`). ~~This incidentally kills the §5f build hazard.~~
  **Wrong — corrected 2026-08-15.** The hazard is alive and it bit again: the
  stub `.claude/worktrees/node_modules` (only `next` and `styled-jsx`) was
  present, and the build failed with the same
  `Can't resolve '../lib/is-error'`. A worktree-local `node_modules` does not
  prevent the stub, because the stub is written by `outputFileTracingRoot`
  relative to the worktree, not resolved from it. **The §5f rule stands
  unchanged: delete the stub, then rebuild.** The earlier claim was drawn from
  one build that happened to pass; two consecutive builds are what test this.
- **`esbuild` added as an explicit devDependency.** It was already present
  transitively; `npm run check-theme` bundles the TS audit through it rather
  than depending on a transitive resolution.

### The screen-level pass — done 2026-08-14

**`PageHeader`: 49 screens.** The survey found something worse than
inconsistent headings — **only 7 of 91 pages had an `<h1>` at all**. The house
idiom was an `<h2>` in a hand-rolled flex wrapper, so every portal was a
document whose top-level heading was the navbar. `SuperAdminTopBar`'s
"Platform Administration" is now a `<p>` for the same reason: it names the
surface, not the page.

Detail pages got the better half: the ad-hoc `← Back to users` link only ever
went up one level, so three pages deep the reader was lost. Those are
breadcrumb trails now.

Eight pages remain on the old idiom (listed by
`grep -rl 'text-xl font-semibold text-slate-900' app --include=page.tsx`).
Each was refused by the transform for a real reason — a description carrying
two separate expressions or a `<span>` — and is a five-minute hand conversion.

**The token migration — 1155 occurrences across 145 files.** This is the one
that matters most for the user's original ask. The token layer existed and the
primitives were retrofitted, but everything *above* those primitives still
painted itself `slate-*`, `bg-white` and `red-600`, so a school picked maroon
and got a maroon shell around a grey CRM. Two real bugs surfaced rather than
being migrated: the timetable cell hardcoded `text-white` on an arbitrary
user-chosen subject colour (white-on-pale-yellow), and `text-white` sat on a
brand fill in 17 more places.

**`Table`: every table in the product.** Zero raw `<table>` markup remains
outside the four print documents and the charts' visually-hidden data
fallbacks. The eight files held back on 2026-08-13 for carrying selection,
sorting or inline form controls were converted on 2026-08-14, `ChallanTable`
and `UserTable` first.

### How the table conversion was verified, and why that mattered

These tables carry behaviour, and this sprint says a behaviour change is a
defect. Eyeballing 27 diffs would not have been evidence, so the conversion was
checked mechanically, twice:

- **Every behaviour-carrying attribute counted before and after** — `onChange`,
  `ref`, `checked`, `value`, `disabled`, `colSpan`, `aria-label`, `key`,
  `href`, `type="checkbox"` and nine more, across all 27 files. Identical.
- **Every file's JSX content compared** with tags stripped and imports
  excluded. Identical. Only markup changed.

**Reuse those two checks for any future bulk rewrite.** They are what made a
27-file mechanical change to QA'd screens defensible.

Four bugs the converter hit on itself, all caught by the build:

- `<th scope="row">` is the cell that *names* a row; through `TableHeaderCell`
  it would have told a screen reader that every period in a timetable is a
  column heading. It maps to `TableCell rowHeader`.
- `text-ink-muted` contains the substring `text-ink`, so a substring test
  promoted every muted cell to a row header. Token equality, not substring.
- A self-closing `<th className="…" />` lost its slash and was never closed.
- Removing the wrapper `<div>` matched open and close with two independent
  regexes, so on `max-h-96 overflow-auto` — a real scroll cap, not a redundant
  scroller — it deleted the close and left the open. **The wrappers stay.**

`ChallanTable` and `UserTable` also take `selected` rather than a background
class, so `aria-selected` is emitted on the rows about to be printed or
deleted, and a `maxHeight`: without a capped height the sticky header and
sticky totals row have nothing to stick to.

### Deliverable C — charts wired 2026-08-14

`lib/dashboard-queries.ts` holds the aggregates. Charted on **five** surfaces:
the school-admin dashboard (collection trend, attendance trend, class
strength), the fees overview (status donut, aging buckets, collection by
month), the attendance reports screen (rate by class), the parent portal (their
child's attendance ring) and the Super Admin panel (module adoption).

*(Two more surfaces were added 2026-08-15 — the exam detail page and the exams
overview. See the Task 1 section below.)*

**`npm run check-dashboard` executes every aggregate against the real
schema** — eight then, eleven now — using a location id that belongs to no tenant — so nothing real is
read, but the hand-written SQL still has to parse and resolve every column.
That is the only thing between a typo in a `filter (where …)` fragment and the
dashboard a head teacher opens, because the portals cannot be signed into from
a development machine. Run it after touching any aggregate.

Definitions that are load-bearing and must not be "simplified":

- **Attendance rate** is `(present + late) / (present + absent + late +
  excused)`; `holiday` is excluded from both sides. Counting a term break as
  absence would make the worst-looking months the ones where nothing happened.
  This is the definition the parent portal's own copy already stated, so the
  two cannot disagree.
- **Outstanding and overdue never overlap.** A donut whose slices double-count
  sums to more than the whole it claims to divide.
- **A month with no payments is a zero, not a gap**, or a closed month looks
  like it never happened.
- **Attendance today is `null`, not `0`**, when no register has been taken.
- **Profit uses `StatTile`'s `unavailable`** and names the Sprint 13.5 ledger
  it waits for.

### ⚠️ What deliverable C still does not cover

- ~~**Exams**~~ — **built 2026-08-15**, see the Task 1 section below.
- **The report card's per-subject bar** — deliberately not built. It is the
  emblematic case for the SVG charting decision *because it prints*, and that
  is exactly why it should not be added blind: it would change a print template
  that has never been checked against a real printer (§5n), which is the
  failure §5e records. **Build it in the same session as a print check, not
  before.**

### ✅ Task 1 — the exams charts, done 2026-08-15

Built on `claude/exams-charts-grade-bands-5f7dc0`. `typecheck`, `lint`,
`build`, `check-theme` and `check-dashboard` all green. Deliverable C now
covers **seven** surfaces.

Two aggregates in `lib/dashboard-queries.ts`, both registered in
`scripts/check-dashboard-queries.ts`:

- **`getExamPerformance(locationId, examId)`** — grade distribution, subject
  averages and pass rate for one exam. Drawn on `/dashboard/exams/[examId]`.
- **`getRecentExamOutcomes(locationId)`** — the last six exams with published
  marks, as pass rate against mean percentage. Drawn on the exams overview.

**The decisions that are load-bearing, and must not be "simplified":**

- **The distribution is bucketed by the school's own bands**, resolved through
  `resolveBand` — the same helper the report card calls — against
  `bandsForTerm`. Not fixed percentages. Two schools with identical marks draw
  different charts, which is correct, and it is the only way this chart can
  agree with the document printed from the same marks.
- **No distribution on the overview, deliberately.** Each exam is graded
  against its own term's scheme, so an "A" column spanning several terms could
  stack two different meanings of A. Percentages survive that comparison;
  letters do not.
- **An absent student is in no band and in no pass-rate denominator**, the way
  `holiday` is in neither side of the attendance rate. They are counted and
  returned separately (`absent`, `unmarked`, `ungraded`), and every chart
  states who it left out rather than quietly drawing a smaller class.
- **Subject averages are decided per paper, not per student.** A child who
  missed Physics still belongs in the Mathematics average.
- **Only published papers.** The tabulation sheet shows unpublished marks
  *flagged*, because reviewing them is its purpose; a bar cannot be flagged. So
  these read what the report card reads, and the card says how many papers that
  leaves out.
- **Passing means passing every published paper.** A rate built from per-paper
  passes is a different and much kinder number wearing the same label.

**`resultPicker` in `lib/exam-queries.ts` is new and shared.** Which sitting
counts — a published re-sit replaces the original, anything else falls back —
was written out three times once these charts existed. It is now one indexed
implementation, used by the tabulation sheet, the report card and the charts.
Pure extraction, no behaviour change; it also makes the two existing folds
linear rather than a scan per cell.

**`npm run check-dashboard` now checks two things.** The aggregates still
execute against the real schema, and **before that, eleven assertions about the
fold run with no database at all** — because the exam aggregates are the only
ones Postgres does not answer alone. A pass rate that counted absentees, or a
distribution quietly bucketed by fixed percentages, compiles and executes
perfectly and disagrees with the report card. The pivotal assertion runs the
same marks through a Matric ladder and a stricter one and requires the two
distributions to differ.

**Not verified in a browser** — the exam screens are behind a session, which
still cannot be signed into from a development machine (§5d item 2). The charts
are the already-audited `BarChart` and `DonutChart` primitives with new data,
they add no client JS (the exam routes' first-load figures are unchanged), and
no banned colour class appears in either page.

### ▶ The one Sprint 10.5 task still open

**Task 2 — the report card's per-subject bar. Build this ONLY in a session that
also does the print check.** It is the emblematic case for the whole
server-rendered-SVG charting decision *because it prints* — and that is exactly
why it must not be added to a template nobody has ever put on paper. §5e is the
precedent: `PrintSheet` shipped blank challans for two days because a print
change went unverified. The chart goes into `ReportCardDocument`, which means:

1. Print one of each document on real A4 first, so there is a known-good
   baseline (this is the standing item from §5n).
2. Add the bar, static SVG only, no client hydration.
3. Print the report card again and compare.

**Do not do step 2 without steps 1 and 3 in the same session.**

### What else to do next

1. **Print one of each document on real A4** — the standing item from §5n, now
   also the gate on Task 2 above.
2. **Finish the eight remaining `PageHeader` pages** — trivial, listed above.
3. Re-run `npm run check-theme` after any change to the derivation, and
   regenerate the `globals.css` defaults with `-- --css` when it moves.

### ⚠️ Still not verified inside a real session

Everything above was checked against fixtures on the two `/design-system`
routes, because sign-in has never worked from a development machine (§5d item
2). **No portal has been seen with a real school's data in it.** The shell is
the same code either way, but "the sidebar renders" and "the sidebar renders
the right things for a branch admin at a school with three modules on" are
different claims, and only the first one has been tested.

---

## 5aa. Sprint 11 — Communications, built 2026-08-15

Built on `claude/sprint-11-communications`. `typecheck`, `lint`, `build`,
`check-theme` and `check-dashboard` all green.

### The migration — applied 2026-08-15, and the two traps in doing it

`db/migrations/0022_sprint11_comms.sql` is applied and verified: 23 of 23,
three tables, 12 indexes, and the permission CHECK widened to accept
`comms.read`, `comms.write` and `comms.send`. Note that last part — the
migration is **not purely additive**. It drops and recreates
`role_permissions_permission_check`, because that constraint is generated from
the `PERMISSIONS` array in `lib/permissions.ts`. Any future sprint that adds a
permission key will do the same, and a school could not be granted the new
permission without it.

**Applying it took three attempts, all of them avoidable, and both traps are
already written down in `drizzle.config.ts` — read that file before running a
migration:**

1. **`npm run db:migrate` does not load `.env.local`.** Drizzle Kit reads
   `DATABASE_URL` straight from the environment. From a worktree *or* from the
   main checkout, the script fails with "DATABASE_URL is not set" — which reads
   like a missing file and is not one.
2. **Migrations need port 5432, not the 6543 the application uses.** `.env.local`
   holds the transaction-pooler URL, which is correct for the app and cannot
   serve DDL and advisory locks. Same host, different port. The direct
   `db.<ref>.supabase.co` endpoint is *not* the answer either — it is IPv6-only
   without a paid add-on (§5c).

What works, from the main checkout, in PowerShell:

```powershell
$raw = (Select-String -Path .env.local -Pattern '^DATABASE_URL=' | Select-Object -First 1).Line
$env:DATABASE_URL = ($raw -replace '^DATABASE_URL=','' -replace '"','' -replace ":6543/", ":5432/").Trim()
npx drizzle-kit migrate
```

**To check whether a migration is really applied**, count `drizzle.__drizzle_migrations`
against `db/migrations/meta/_journal.json` and then look for the tables
themselves — the bookkeeping row and the schema can disagree, and only the
second question is the one that matters.

### What is built

| Piece | Where |
| --- | --- |
| Three tables | `db/schema/announcements.ts`, migration `0022` |
| Three permissions | `comms.read` / `comms.write` / `comms.send` |
| The audience rule | `lib/announcement-audience.ts` |
| Reads, writes, the send, the board | `lib/announcement-queries.ts` |
| Four API routes | `app/api/school/announcements/**`, `app/api/school/notices/read` |
| The composer | `/dashboard/communications` |
| The notice board | parent, student and teacher portals, with an unread badge |
| The scheduler | `lib/announcement-scheduler.ts`, started in `instrumentation.ts` |

### The decisions that are load-bearing

- **The default delivery path is ours.** The original plan built this entirely
  on GHL Conversations; GHL is opt-in per school now. The notice board always
  happens, email over the Sprint 0 outbox happens when the sender asks, and
  WhatsApp is reached only where the paid add-on is on — through
  `lib/channels.ts`, so this and the fee reminders cannot reach different
  conclusions about the same school.
- **The audience is one tagged jsonb object**, not three nullable id columns.
  Three columns would make every combination representable, including the ones
  that mean nothing, and every query would have to invent a reading for a row
  carrying both a grade and a role.
- **A class audience means the children *and* their guardians.** A Class 5 trip
  notice that reached only the ten-year-olds is a defect nobody reports as one:
  it went out, it simply did not work. Staff are reached by addressing a role.
- **The delivery log is written once, at send, and never recomputed.** It holds
  the audience as it was at that moment. **The notice board reads from it**, so
  a child who changed section in May still sees April's notice and never sees
  one addressed to a class they were not in. Recomputing would make a board
  that rewrites its own history.
- **`unreachable` is not `failed`.** A failure is the platform's to retry; a
  parent with no email address is the school's to fix. Collapsing them buries
  the one number an office can act on inside one it cannot.
- **A sent announcement cannot be edited or deleted.** People have read it, some
  in an email with no recall, and the log is what answers "did we tell the
  parents". Send a follow-up.
- **Every screen says "queued", never "sent"**, for email. §5k.
- **The scheduler reads "due at or before now"**, never a window, so a process
  that was down for an hour sends the backlog rather than silently dropping
  exactly what was scheduled while it restarted.

### What Sprint 11 does *not* cover

- **The delivery report has a query and no screen.** `getDeliveryReport` is
  written and tenant-scoped; nothing renders it yet. The composer shows a
  recipient count, which is the headline, but "which twelve parents have no
  email address" — the thing an office acts on — is one screen away.
- **Editing from the UI.** `PATCH` exists and is tested by nothing; the composer
  only creates, sends and discards.
- **WhatsApp delivery.** The channel is modelled in `delivery_channels` and
  gated, and nothing writes a `whatsapp` row yet. Deliberate: §3.3 and the chat
  decision mean email plus the board is the path, and the add-on can be wired
  when a school actually buys it.
- **GHL Social Planner** — already deferred to Sprint 22 by `SPRINTS.md`.
- **Not seen in a browser.** Same standing reason as everything else: sign-in
  has never worked from a development machine (§5d item 2).

---

## 5ab. Sprint 12 — Reports & analytics, built 2026-08-15

Built on `claude/next-sprint-completion-47250e`. `typecheck`, `lint`, `build`,
`check-theme`, `check-dashboard` and a new `check-reports` all green.

**No migration, and that was a decision rather than luck.** `SPRINTS.md` says
Sprint 12 has none, and the obvious way to break that would be a `reports.read`
permission key — which would mean dropping and recreating
`role_permissions_permission_check` (§5aa). It would also be the wrong shape:
one key would let anybody who may read the register read the salary bill.
**Each report is gated on the permission that already governs the screen its
data comes from**, so an accountant is offered the four financial reports and a
coordinator the academic ones, with nothing for a school to configure.

### One definition, three renderers

This is the whole architecture and it is worth keeping.

| Piece | Where |
| --- | --- |
| The declaration — title, permission, filters, columns, caveat | `lib/report-catalogue.ts` |
| The nine runners | `lib/report-queries.ts`, one entry point `runReport()` |
| Filter dropdown contents, and the names the sheet prints | `lib/report-options.ts` |
| The table, screen and paper | `components/reports/ReportTable.tsx` |
| The filters, as a plain `GET` form with no JS | `components/reports/ReportFilterBar.tsx` |
| The screen | `/dashboard/reports`, `/dashboard/reports/[reportKey]` |
| The sheet | `…/[reportKey]/print`, inside `PrintSheet` |
| The file | `GET /api/school/reports/[reportKey]`, `text/csv` |

The screen, the sheet and the file all read the same declaration, call the same
runner with the same parsed parameters, and render the same column list.
Whoever adds a tenth report writes a definition and a runner and gets all three.
The defect this prevents is one already made twice here — a cap that drifted
between a list and its print page, a strength meter that drifted from the check
that accepted the password. A column added to the screen and forgotten in the
export is the same defect, found by an accountant reconciling a printout
against a spreadsheet.

### `lib/csv-export.ts` is new, and two things in it look like bugs

`lib/csv.ts` only ever read. Nothing in the repo could write a delimited file.
The writer is dependency-free for the same reason the reader is (`SPRINTS.md`
§0.1 pins the dependency list), and it does two non-obvious things:

1. **It writes a UTF-8 BOM.** Excel on Windows — which is what a school office
   runs — reads a BOM-less UTF-8 CSV in the system ANSI codepage, and "Ayesha
   Khān" arrives as "Ayesha KhÄn". The reader strips a BOM on the way in for
   exactly the same reason.
2. **It prefixes an apostrophe to any cell starting `=`, `+`, `-`, `@`, tab or
   CR.** Spreadsheets execute those as formulas. A student's name is user input
   and reaches every export the office opens;
   `=HYPERLINK("http://…"&A1)` typed into a name field is otherwise a live
   exfiltration link. The apostrophe is the spreadsheet's own "this is text"
   marker, so the cell still reads correctly.

Both are asserted in `scripts/check-reports.ts` **because both look like litter
to whoever next tidies the file.** Numbers are written bare, never formatted —
`12,500` is text to a spreadsheet and will not sum, which is the first thing an
accountant does to an exported fee report.

### Subject-wise attendance is derived, and the report says so

`SPRINTS.md` asks for a subject-wise attendance report. **There is no
per-subject attendance to read**: `attendance_records` is one row per student
per day, deliberately (a per-period register multiplies a teacher's work by
seven for a number no board asks for), and inventing a table for it would be a
migration in a sprint with none.

What exists is the timetable. So a day a child was away is charged against
whichever subjects their section had on the timetable that weekday —
`day_of_week = extract(isodow from date)::int - 1`, verified against real
attendance dates (`0` = Monday, matching the schema). It measures **teaching
time lost per subject**, which is a real number, and it is not the number a
per-period register would give. The report states that on screen and prints it
on the sheet, because a head comparing it against a teacher's own count needs
to know why they differ.

**A section with no timetable contributes nothing to it**, and no school in the
database has a timetable — so this is the one report whose join has never seen
a row. See below.

### Verified against real data, and the reports cross-check

`npm run check-reports` runs the writer, the rate helper and the parameter
parser with no database (30 assertions), then executes all nine runners against
the real schema with a location id belonging to nobody. Then, separately, every
runner was executed against the seeded Rehearsal Academy:

- attendance summary — 10 sections, 410 students, 94.1%
- fee collection — 1,227 challans, PKR 6,629,100 billed, 68.2% collected
- aged debt — 319 students, PKR 2,105,531 owed
- academic results — 10 exams, 365 graded, 70.4% pass, 44 not graded
- monthly revenue — PKR 4,523,569 collected over 909 receipts

**Three independent queries agree**: fee collection's outstanding total and the
aging report's total are both PKR 2,105,531, and monthly revenue's billed total
matches fee collection's while its cash + bank split sums exactly to its
collected. Those are separately written SQL statements arriving at the same
figure, which is the strongest check available without a browser.

### Deployed and confirmed live 2026-08-15 — and how, without credentials

Pushed to `main` (`dc58d37`), Hostinger auto-built it, and the new build was
**confirmed serving within ~2 minutes**. The smoke test then passed against it:
401 `invalid_credentials` on a deliberately wrong password, which proves the
environment reached the process and bcrypt ran.

**The confirmation technique is worth reusing, because the two obvious ways are
both closed.** `HOSTINGER_API_TOKEN` is still unset, so the MCP deployment API
answers 401; and the apex domain has no tenant, so middleware rewrites *every*
path — including one that matches no route at all — to `/school-not-found` with
a 200. Neither a route probe nor a 404 can tell one build from another there.

What does: **the hashed CSS filename in the page source.**

```bash
curl -s https://schoolhub.codexmill.com/super-admin/login \
  | grep -o '/_next/static/css/[a-f0-9]*\.css' | head -1
```

Compare it against `ls .next/static/css/` from a local build of the same commit.
Here the live hash went `9d443579706594ae` → `00cc342637c5a6ae`, and `00cc…` is
what this commit builds locally — so the running build is *this* commit, not
merely a newer one. The hash digests the generated Tailwind output, so any
change to the classes used anywhere in the app moves it. It will **not** move
for a change that alters no styling, which is the one case this cannot detect.

### What Sprint 12 does *not* cover

- **Not seen in a browser.** Standing reason: sign-in has never worked from a
  development machine (§5d item 2). No screen and no printed sheet has been
  looked at — only the data behind them.
- **Subject-wise attendance has never run against real rows** (no school has a
  timetable). Payroll, leave and enrollment-funnel likewise return correctly
  empty because the seeded school has no staff and no applications. All four
  queries parse and execute; three of them have had nothing to count.
- **No charts.** Deliberate, and `SPRINTS.md` is explicit: reports are
  documents, dashboards are visualisation, and 10.5 owns the second.
- **No scheduled or emailed reports, and no saved presets.** The URL is the
  preset.
- **Nothing rebuilt.** The three report screens that predate this —
  `/dashboard/fees/reports`, `/dashboard/fees/defaulters`,
  `/dashboard/academics/attendance/reports` — are untouched and still reachable
  from their own sections. They answer narrower operational questions (the
  chase list feeds the reminder sender; the aged-debt page puts a student in
  one bucket). Folding them in would have been a rewrite of working screens in
  a sprint that had nine new ones to build; the new Outstanding & aging report
  splits each student across all five buckets, which is the question those two
  cannot answer.

---

## 5ac. Sprint 13 — Portals, the PWA shell, and BR4, built 2026-08-16

Built on `claude/next-sprint-completion-cbc8ca`. `typecheck`, `lint`, `build`,
`check-theme`, `check-reports`, `check-dashboard` and a new `check-portals` all
green. **Migration `0023` written, applied and verified** — see the header.

### What the sprint actually was

Three thin portals sharing one data model, plus two things that are not screens
at all. `SPRINTS.md` merges the document's Sprints 13/14/15 into one for that
reason: splitting parent, teacher and student polish triples the review overhead
for no benefit, and this sprint is the evidence — nine of the fourteen new
screens are the same four queries pointed at a different reader.

| Piece | Where |
| --- | --- |
| BR4's resolver | `lib/principal-resolver.ts` |
| Assignments CRUD | `app/api/school/principals/**`, `components/school/PrincipalAssignments.tsx` |
| The calendar arithmetic | `lib/attendance-calendar.ts` (pure) |
| A student's own results | `lib/portal-results.ts` |
| A teacher's own record | `lib/staff-self-queries.ts` |
| Lesson plans | `lib/lesson-plan-queries.ts`, `app/api/school/lesson-plans/**` |
| Email preferences | `lib/notification-preferences.ts` |
| The app shell | `app/manifest.webmanifest/`, `app/icon/[size]/`, `app/sw.js/`, `app/offline/` |
| The gate | `scripts/check-portals.ts` — `npm run check-portals` |

### The decisions that are load-bearing

- **BR4 adds no role.** The source document proposed a dynamic
  `principal_${divisionSlug}` role; `SPRINTS.md` refuses it and this
  implementation honours that. `school_users.role` is a CHECK-constrained text
  column, and every permission default, `allowedRoles` list and the whole Sprint
  8 matrix is keyed on a *closed* set — a role invented per division would make
  `DEFAULT_ROLE_PERMISSIONS` unable to name its own keys. The role stays
  `principal`; a `principal_assignments` row scopes what they see.
- **The scope narrows sight, never permission — and that distinction has a
  consequence worth stating.** It is a *visibility* boundary applied by the
  queries that read it, not an authorization one. A route that forgets to read
  it shows a head the whole school, which is what they saw before Sprint 13 and
  is **not** a cross-tenant leak: `location_id` still comes from the verified
  session. Treat a missed narrowing as a defect, not a breach. Wired into the
  students list today (`lib/admissions-queries.ts` `scope` filter, applied in
  `app/api/school/students/route.ts`); everything else is unnarrowed and
  correctly so until somebody decides otherwise.
- **`null` means everything, `[]` means nothing, and they are different.** An
  unassigned head at a `multiple` school gets empty arrays and sees an empty
  school — with `describeScope()` telling them to ask their administrator.
  Several assignments **union**: adding one must widen, never narrow, or a
  second assignment would quietly halve a head's school. `check-portals`
  asserts this specifically, because that regression compiles and executes
  perfectly and produces a merely shorter list.
- **Nothing authenticated is ever put in the service-worker cache.** This is the
  single most consequential decision in the sprint. Navigations are
  network-only with a static `/offline` fallback; only build-hashed
  `/_next/static/*` is cached. A cached `/parent/fees` is one family's bill in a
  store that outlives the session, on a handset that in this market is
  frequently shared, and signing out does not clear it. Anything better needs a
  cache keyed on the session and purged on sign-out — a Sprint 15 conversation
  alongside Web Push, not something to bolt on. `/offline` itself carries no
  school name, no colours and no user, for the same reason; it looks
  unbranded because it must be.
- **The manifest and the icons are per-tenant, generated, and need no operator
  step.** Next's static `app/manifest.ts` would have installed every school's
  parents an app called "SMS Platform" in somebody else's colours. The manifest
  is a route that reads the tenant middleware already stamped; the icon is drawn
  as an SVG from the school's own palette and rasterised by `sharp`, which is
  already a dependency. A missing icon is one of the few things that makes a
  PWA **silently** non-installable — no error, the prompt simply never appears —
  so generating one means every school is installable the day it is created.
  `/icon/[size]` validates against a fixed `{192, 512}` set rather than parsing
  a number: `/icon/100000` would otherwise be an unauthenticated request to
  allocate a ten-gigapixel raster.
- **Notification preferences are opt-*out*, with no back-fill.** An absent row
  means every category is on — exactly the rule `role_permissions` follows, and
  for the same reason: every account that exists today has no row, and a table
  that had to be back-filled would silently mute whoever it missed. They govern
  **email only**; the notice board is never suppressed, because letting a parent
  switch off the board would give a school a way to have told somebody something
  they had no way of seeing. The screen says that in those words.
- **`optedOut` is kept apart from `unreachable`**, which is kept apart from
  `failed` — the same reasoning Sprint 11 recorded, extended by one. A failure
  is the platform's to retry, a missing address is the school's to fix, and a
  preference is nobody's problem at all. Collapsing them would put a parent who
  chose not to be emailed onto an office's chase list.
- **A parent's report card is the school's report card.** `ReportCardSummary`
  (screen) and `ReportCardDocument` (A4) both take the same `ReportCard` from
  the same query. No total is re-added and no grade re-resolved anywhere — that
  is the Sprint 12 "one definition, several renderers" rule, and what it
  prevents here is a percentage on a phone disagreeing with the one on the paper.
- **A blank school day on the calendar means the register was not taken.**
  Never "absent". Schools miss registers, and drawing a missing one as an
  absence would put a mark against a child who was in class — the worst thing
  this screen could get wrong.
- **A teacher's own record has no id in it.** `lib/staff-self-queries.ts` is
  deliberately *not* `lib/hr-queries.ts`: every function there takes a `staffId`
  an administrator is entitled to choose, and one shared helper would be a
  single forgotten check away from letting a teacher read a colleague's salary.
  Here the staff record is derived from the session and there is no id to check.
  Payslips come only from **paid** runs.

### One found defect, fixed in passing

`AnnouncementManager` **discarded the send outcome**. Sprint 11 computed
`recipients`, `queued` and `unreachable`, stored them, and returned them to a
client that threw them away — so the one number an office can act on ("twelve
parents have no email address") was never shown to anybody. It is now reported
after every send, with `optedOut` alongside.

### Deployed and confirmed live 2026-08-16

Merged to `main` (`562065a`), pushed, and Hostinger auto-built it. Confirmed by
the §5ab CSS-hash technique: the live hash went `00cc342637c5a6ae` →
`5d866dad442f04f4`, and `5d86…` is what this commit builds locally — so the
running build is *this* commit, not merely a newer one. It took about three
minutes, five polls at thirty seconds.

`node scripts/smoke-test-live.mjs https://schoolhub.codexmill.com` reports
**DEPLOYMENT HEALTHY**: 401 `invalid_credentials` on a deliberately wrong
password, which proves the environment reached the process and bcrypt ran.

The four new unauthenticated routes were checked directly, because they are the
ones a mistake would make silently useless rather than broken:

| Probe | Result |
| --- | --- |
| `GET /sw.js` | 200, `text/javascript`, **`Service-Worker-Allowed: /`** present |
| `GET /manifest.webmanifest` | 200, `application/manifest+json` |
| `GET /icon/192` | 200, `image/png`, 2,888 bytes |
| `GET /icon/100000` | **404** — the fixed-size allowlist holds |

The `Service-Worker-Allowed` header is the one worth re-checking after any
hosting change: without it the worker may only control `/sw.js`, and the app
would be non-installable with nothing in any log to say why.

### What Sprint 13 does *not* cover

- **No assignment tracker for students.** `SPRINTS.md` gives the homework diary
  to Sprint 19.5, there is no assignments table, and inventing one here would
  mean building it twice. Deliberately absent from the student nav rather than
  left as a placeholder.
- **No leave *application*** from the teacher portal, only the record. Who
  approves a head's leave, and what happens to an application for a day already
  marked on the register, are product questions — a form that half-answered them
  would fill a queue nobody had agreed how to work.
- **No Web Push.** The shell is the substrate Sprint 15 needs. Shipping it now
  means parents are installed before push arrives, which is the whole reason
  `SPRINTS.md` puts it here.
- **The principal scope reaches one list.** Students. Fees, exams, HR and the
  dashboards are unnarrowed; see the second bullet above for why that is safe
  and what it costs.
- **The lesson-plan school-wide read has no screen.** `listSharedPlans` is
  written, tenant-scoped and reachable at
  `GET /api/school/lesson-plans?scope=school`; nothing renders it. The same
  shape as Sprint 11's delivery report, and it should be built with that one.
- **Not seen in a browser.** Standing reason: sign-in has never worked from a
  development machine (§5d item 2). Every query was executed against the real
  schema and the two pure modules are asserted with no database, but no page and
  no printed sheet has been looked at.

---

## 5ad. Why new schools are unreachable — diagnosed 2026-08-16

The user added a wildcard DNS record (`*.schoolhub` → `195.35.33.221`,
TTL 14400) and reported that a new school's subdomain still does not work.

**The application is not at fault, and no application change can fix this.**
That is the conclusion, and the evidence is below because it is the kind of
thing that gets re-litigated.

### What was measured

**1. The wildcard record is not in the zone.** Asked the authoritative
nameservers directly (`pixel.dns-parking.com`), so no cache is involved:

| Name | Answer |
| --- | --- |
| `anything-random-1234.schoolhub.codexmill.com` | **NXDOMAIN** |
| `usman-public.schoolhub.codexmill.com` | **NXDOMAIN** |
| `credo.schoolhub.codexmill.com` | `195.35.33.221` |
| `schoolhub.codexmill.com` | `145.79.29.64`, `145.79.24.147` |

A wildcard answers *every* label by definition. A random one returning NXDOMAIN
from the authoritative server proves the record is not there — saved in the
wrong zone, not saved, or entered under a different name. Note also that the
apex resolves to a **different pair of addresses** than the wildcard's target,
and that public resolvers returned a third pair (`2.57.91.141`,
`88.222.222.246`) — the account's addresses rotate, so a hand-typed A record is
guesswork even when it is entered correctly.

**2. A wildcard record would not have been enough anyway.** This is the part
worth keeping. Pinning the *same* IP with `curl --resolve`, so DNS is removed
from the experiment entirely:

```bash
# parked domain exists  -> 200, and it is the Next app
curl -sk --resolve credo.schoolhub.codexmill.com:443:195.35.33.221 \
  https://credo.schoolhub.codexmill.com/

# never parked          -> curl (35), TLS handshake fails
curl -sk --resolve zzz-not-provisioned.schoolhub.codexmill.com:443:195.35.33.221 \
  https://zzz-not-provisioned.schoolhub.codexmill.com/
```

Same address, same request, opposite outcomes. **Hostname matching and
certificate issuance are per-host on this hosting**, so a name that was never
parked is refused at the TLS layer before any request reaches Node. Pointing
DNS at the server is necessary and nowhere near sufficient. §3 already recorded
"per-subdomain issuance, not a wildcard cert"; this is that caveat biting.

**3. The application resolves tenants correctly, end to end.** On a subdomain
that *was* provisioned:

- `credo.schoolhub.codexmill.com/login` → the school's sign-in page
- `schoolhub.codexmill.com/login` → "School not found" (correct — the apex has
  no tenant)

So `subdomainFromHost`, the Edge lookup and the middleware rewrite all work.

**4. The provisioning code was already written and already correct.**
`app/api/super-admin/schools/route.ts` calls `provisionSchoolSubdomain()` on
every create, `lib/hostinger.ts` creates a **parked domain** (not a subdomain —
its docblock explains why that distinction is load-bearing), and
`…/[schoolId]/provision-subdomain` exists for retries. It returns `unmanaged`
and does nothing solely because `HOSTINGER_API_TOKEN` and `HOSTINGER_USERNAME`
are unset — outstanding since 2026-08-11 and still the only blocker.

### The one real defect this found, now fixed

`lib/subdomain-status.ts` marked `unmanaged` as **`retryable: false`**, so the
Super Admin table hid the Provision button for it. The reasoning was sound about
a single request — with no token, a retry returns `unmanaged` again — and wrong
about the lifetime of a deployment: `unmanaged` records the state at the *last
attempt*, not a property of the platform. The moment the token is set, the four
schools already sitting at `unmanaged` (`credo`, `check`, `usman-public`,
`rehearsal-academy`) had **no control on any screen** that could provision them;
the only ways out were hPanel or a hand-edited row. Now retryable, with a hint
naming the two variables.

Also added `components/super-admin/SubdomainProvisioningNotice.tsx` above the
schools table: it says whether provisioning is on, and when it is off it names
the two variables and states that a wildcard record does not replace them. The
old signal was a "Manual" badge in a table column, which reads as a category
rather than as a warning — and that is exactly how a session was lost to
"the platform is broken" when nothing was broken.

### What the user has to do — none of it is code

1. **Set `HOSTINGER_API_TOKEN` and `HOSTINGER_USERNAME`** in the hosting panel's
   Environment section and restart. This alone makes every *new* school
   provision itself on creation.
2. **Press Provision** on each existing school that is not Ready. Idempotent and
   never deletes.
3. **The wildcard A record can be deleted.** It is not doing anything, its
   target address is not one the apex resolves to, and leaving it invites the
   belief that subdomains are handled.

**Untested and worth one attempt before accepting per-school provisioning
forever:** whether hPanel accepts `*.schoolhub.codexmill.com` as a *parked
domain*. If it does, and if a wildcard certificate is issued with it, one entry
would cover every school. This could not be tested from here — the Hostinger MCP
tools answer `Unauthenticated`, so there is no API access in this environment
either. Do not assume it works; a parked wildcard that resolves without a
matching certificate fails exactly the way §5ad's second measurement did.

> ⚠️ **§5ad's conclusion — "the application is complete" — was wrong.** It was
> reached from one misleading data point. Read §5ae, which corrects it. hPanel
> has since also confirmed that a wildcard **cannot** be added as a parked
> domain ("Value must be a valid domain or IP address"), closing that route at
> both ends.

---

## 5ae. The missing half: a parked domain is not a DNS record — 2026-08-16

§5ad said the application side was complete and only needed the hosting token.
**That was wrong, and this is the correction.** The token was set, provisioning
ran, the parked domains appeared in hPanel — and every one read **"Not
connected"**, with the browser returning `DNS_PROBE_FINISHED_NXDOMAIN`.

### The root cause

**A parked domain is a vhost alias. It creates no DNS whatsoever.** It tells
LiteSpeed "serve this hostname from this site"; it does not put the name in any
zone. Hostinger's "Not connected" label means exactly "this name's DNS does not
point at us" — a statement about DNS, not a failed alias.

`lib/hostinger.ts` was doing half the job and reporting success for it. The two
halves live behind two different APIs:

| Half | API | Was it done? |
| --- | --- | --- |
| vhost alias | `POST /api/hosting/v1/accounts/{u}/websites/{d}/parked-domains` | ✅ since §5w |
| DNS record | `PUT /api/dns/v1/zones/{zone}` | ❌ **never written** |

`credo` was the one working subdomain and looked like proof the mechanism
worked. It was not — its DNS record had been made by hand. **That single
misleading data point is why §5ad concluded the app was complete**, and it is a
good argument for distrusting a lone positive case.

The wildcard record also still does not exist: re-measured against the
authoritative nameservers, `random-probe-9911.schoolhub…` returns NXDOMAIN, and
a wildcard answers every label by definition.

### What was built

`ensureDnsRecord()`, called by `provisionSchoolSubdomain()` once the alias
succeeds. Contract taken from Hostinger's own PHP SDK models
(`DNSV1ZoneUpdateRequest` → `zone[].{name,type,ttl,records[].content}`).

- **A CNAME to the parent website, not an A record.** The account's addresses
  move: within one session this deployment served `145.79.29.64`/`145.79.24.147`,
  then `145.79.24.95`/`145.79.29.210`, while public resolvers gave
  `2.57.91.141`/`88.222.222.246`, and the hand-made `credo` record pointed at
  `195.35.33.221`. **Any A record this code wrote would be a snapshot of a
  rotating set** — right on the day, silently wrong later, surfacing as one
  school being unreachable long after anybody would connect it with
  provisioning. A CNAME delegates that forever. The target carries a **trailing
  dot**; a relative target would resolve against the zone to `<website>.<zone>`,
  which is the classic silent break. `HOSTINGER_DNS_TARGET_IP` forces an A
  record for a host that refuses CNAMEs, and is an escape hatch.
- **`overwrite: false`, and an existing record is never edited.** The flag's
  documented meaning is that matching records are "deleted and new RRs created",
  and how wide "matching" reaches is not stated precisely. If it means the zone,
  the blast radius is every record on `codexmill.com` — the apex, mail, every
  other school. So the zone is read first, an existing name is reported and left
  **untouched whatever its content**, and only a genuinely absent name is
  appended. Anyone tempted to set this `true` should establish its scope against
  a throwaway zone first.
- **A failed DNS half now fails the whole provision**, naming both halves. Alias
  succeeded + DNS failed is precisely the state that looks fine in the panel and
  NXDOMAINs in a browser, and it previously had no representation at all.

`SchoolTable` also **discarded the provision response** — the same defect found
in the announcement composer during Sprint 13. Pressing Provision reported
itself only as a badge changing colour, so "a record was created" and "a record
already existed" were indistinguishable. Shown verbatim now.

New gate: **`npm run check-provisioning`** — 14 assertions, no network, no
database, on the two pure functions that decide *where* a record is written.
`registrableDomain()` picks the zone, `recordNameWithinZone()` the name inside
it; an off-by-one-label writes `abc-demo` instead of `abc-demo.schoolhub`, which
is a valid record for a hostname nobody will visit, and the API, the panel and
the code all report success. It pins the known `.co.uk` limitation deliberately,
so fixing it properly will fail that line and point at the reasoning.

### ⚠ Not verified against the real API, and that matters

**No Hostinger call in this section has ever been executed.** There is no token
in this environment — `.env.local` has none, the Hostinger MCP tools answer
`Unauthenticated` — so the DNS request shape is taken from the published SDK
models and reasoned about, not observed. The pure arithmetic is asserted; the
network half is not. Do not read the green gates as proof that provisioning
works end to end.

**Likeliest failure, and the first thing to check: the API token needs DNS scope
as well as hosting scope.** Generated with hosting scope only, the zone read
returns 403 and the message says so in those words. Next likeliest is the
request shape, in which case the exact HTTP status and body now appear on the
school's row.

### What to do next

1. Press **Provision** on `abc-demo` and read the blue notice — it states what
   happened to both halves.
2. If it names a DNS failure, regenerate the token with **DNS scope**, then retry.
3. `nslookup abc-demo.schoolhub.codexmill.com` should return a CNAME to
   `schoolhub.codexmill.com` within ~5 minutes (TTL is deliberately 300s).
4. The wildcard A record can be deleted — it is not in the zone anyway, and its
   target is not an address the platform answers on.

> ⚠️ Step 1 was run and **failed with HTTP 422**. The token's DNS scope was
> fine — this section's prime suspect was wrong. The *zone* was wrong.
> **§5af is the resolution.**

---

## 5af. The zone was wrong: `schoolhub.codexmill.com` is its own zone — 2026-08-16

§5ae added the DNS half and wrote it into the **parent** zone. Provisioning
`abc-demo` returned, from the real API at last:

```
HTTP 422 {"message":"[DNS:4008] DNS resource record is not valid or
                     conflicts with another resource record"}
```

That reply is also the good news: a 422 means the request was authenticated,
authorised and *validated*. The token's DNS scope — §5ae's prime suspect — was
never the problem, and neither was the request shape.

### The measurement that settles it

```
SOA schoolhub.codexmill.com → pixel.dns-parking.com / dns.hostinger.com
NS  schoolhub.codexmill.com → pixel.dns-parking.com, byte.dns-parking.com
```

**`schoolhub.codexmill.com` is its own DNS zone**, delegated out of
`codexmill.com`. So `abc-demo.schoolhub.codexmill.com` is a *direct child* of
that zone and its record belongs there under the bare name `abc-demo`.

Writing it into `codexmill.com` as `abc-demo.schoolhub` is invalid DNS:
**nothing may live below a delegation point in the parent zone.** A resolver
follows the NS delegation and never looks at the parent's records. Hostinger's
validator is correct; "conflicts with another resource record" is the delegation.

### One fact, three symptoms

This also explains the original complaint, retroactively. The operator's
wildcard `*.schoolhub` was added to the **parent** zone: accepted by the panel,
still listed there, and invisible to every resolver — which is why
`random-probe.schoolhub.codexmill.com` returned NXDOMAIN throughout while the
record sat there looking correct. §5ad spent its effort proving the record "was
not in the zone". It was in *a* zone, just not the one that answers. And `credo`
worked because its record was made in the right one.

**Before assuming a panel entry is live, check which zone actually holds the
name.** That is the reusable lesson.

### The fix

`resolveDnsZone()` probes rather than computes — only the API knows which zones
exist. `PLATFORM_BASE_DOMAIN` first, then its registrable domain:

| Topology | Zone | Record name |
| --- | --- | --- |
| base `schoolhub.codexmill.com` is a zone *(here)* | `schoolhub.codexmill.com` | `abc-demo` |
| base `platform.com` is a zone | `platform.com` | `abc-demo` |
| base `app.example.com`, only `example.com` is a zone | `example.com` | `abc-demo.app` |

The first two collapse to one rule, which is the point: when the platform's own
domain is a managed zone — the normal case — the record name is just the slug
and no suffix arithmetic happens at all. Two cheap GETs on an operation that
already creates a domain, deliberately not memoised: a cached wrong answer here
is a school that never resolves.

A 4008/conflict reply now appends the likely cause and names the zone it tried,
so the next reader is pointed at the delegation rather than at an error code.
And `zoneAlreadyHasName` accepts both a bare array and a `{ data: [...] }`
wrapper — the SDK documents the former, Hostinger's other endpoints use the
latter, and an unrecognised shape would read as "no records", send the write
anyway, and collide: the very 422 this is meant to avoid.

### Still not executed end to end

The zone is now probed from the live API rather than guessed, and the endpoint,
auth and request shape are all confirmed accepted by the real service. **The
corrected write itself has still not run from here** — there is no token in this
environment. The remaining unknown is much smaller than §5ae carried, but it is
not zero.

---

## 5ag. It works, except the certificate — 2026-08-16

The zone fix (§5af) **succeeded**. `abc-demo` was provisioned and its record
written correctly. The `Failed` the panel then showed was this platform's own
bug, not Hostinger's.

### Measured state of `abc-demo.schoolhub.codexmill.com`

| Layer | State |
| --- | --- |
| DNS | ✅ `CNAME → schoolhub.codexmill.com` → `145.79.24.36`, written by our automation |
| Parked domain (vhost alias) | ✅ HTTP 200 |
| Tenant resolution | ✅ serves **"Sign in"**, not "School not found" |
| **TLS certificate** | ❌ `no peer certificate available`, handshake alert 80 |

Everything the application controls is done and correct. The only missing piece
is a certificate, and **`openssl s_client` is what proves it** — Windows
`schannel` reports this as `SEC_E_INTERNAL_ERROR / The Local Security Authority
cannot be contacted`, which reads like a broken local machine and is not.
`Verification: OK` in the same output is meaningless when the line above says
`no peer certificate available`: there was nothing to verify. Use `openssl`, and
read the whole handshake rather than a grep of it.

### Two defects this exposed, both fixed

**1. A working subdomain was reported `Failed`.** `zoneAlreadyHasName` did not
recognise the record in Hostinger's zone response, so a retry wrote it again and
the duplicate was refused with the 4008 conflict — reported as failure for a
subdomain that was serving. **DNS is now asked first, and gets the casting
vote**: `ensureDnsRecord` short-circuits when the name already resolves, and a
write conflict re-checks DNS before being called a failure. An API response body
has a shape that can be misparsed; "does this name resolve" cannot be wrong in
the same way, and it is the outcome being provisioned in the first place.

**2. "No DNS" and "no certificate" were indistinguishable.** Both were `false`
from `checkSubdomainReachable`, which is how a three-quarters-working subdomain
looked identical to one that did not exist. `diagnoseSubdomain()` now returns
`live` / `tls-pending` / `no-dns`, and the row says which — one is a wait, the
other is a fix.

### The hard limit: SSL cannot be automated

**Hostinger's public API exposes no SSL endpoint.** The published PHP SDK has
models for certificates and no methods to create or install one. So the platform
can report `tls-pending` and can never resolve it.

What is true of the certificate:

- It is issued **automatically** for a parked domain once the name resolves —
  which for these schools only became true after §5af landed.
- Hostinger's own documentation puts it at **up to 1–2 hours**.
- If it has not appeared by then it is one manual action: hPanel → the site's
  **Security → SSL → Install SSL**.
- `credo` carries a real Let's Encrypt certificate (`CN=credo.schoolhub.…`,
  issuer `Let's Encrypt YE2`), so issuance does happen on this account.

**Do not build a retry loop against this.** There is nothing to call.

### Where this leaves automatic provisioning

Creating a school now does everything that can be done from code: the alias, the
DNS record, and an honest status. The certificate is the one step that is
Hostinger's to perform on its own schedule, and the row says so in words instead
of reporting a failure.

Still not executed from this environment: nothing, now — the DNS write was
confirmed by the record it produced, which is the strongest evidence available
without a token.

---

## 5ah. Why the invitation email never arrived — 2026-08-18

**Subdomain provisioning is finished.** `abc-demo.schoolhub.codexmill.com` has
its certificate, serves the tenant over HTTPS, and the user signed into it. §5ag
closes.

The next report was two separate things reported as one: an invitation that sent
no email, and a `401 unauthenticated` on the Resend button.

### The email: SMTP authentication is failing in production

Read straight from `email_outbox`, which is what that table is for:

```
to_address : itzhasansiddiqui@gmail.com
subject    : You have been invited to ABC Demo
status     : queued        attempts : 2
last_error : Invalid login: 535 5.7.8 Error: authentication failed:
```

So **nothing is wrong with the invitation flow.** The row was created, the mail
was queued, the outbox tried twice, and the SMTP server rejected the
credentials. `SMTP_USER` / `SMTP_PASS` in the hosting panel are wrong.

Worth noting: **11 messages have status `sent` historically**, so these
credentials worked before. The likeliest cause is the recent editing of the
production environment to add `HOSTINGER_API_TOKEN` — and §5v is the standing
warning that on Hostinger the Environment panel and `.env` are **one store**, so
editing one disturbs the other.

The queue is on a deadline: `EMAIL_MAX_ATTEMPTS` is 5 with a 1/5/15/60/60-minute
backoff, so a message has roughly two hours before it is abandoned. Fix the
credentials inside that window and the queued mail goes out by itself.

### The 401: not the same problem, and probably not a bug

`withSchoolAuth` returned `unauthenticated`, which happens when
`readSchoolSession()` yields null — an expired or missing session cookie. The
page had rendered (it is behind `requireSchoolRole`), so a session existed then
and not at the click. Given that this tab had been open across the wait for the
TLS certificate, an ordinary expiry is the plain reading.

**It is not the cause of the missing email**, and that ordering matters: the
invitation and its outbox row were both written before anybody pressed Resend.
Signing in again and pressing Resend will requeue — against the same broken
SMTP, so fix the credentials first or the second message queues and fails too.

### What was built: `components/super-admin/EmailDeliveryHealth.tsx`

An SMTP misconfiguration was **invisible from every screen**. Sprint 0's outbox
was doing its job perfectly — accept, retry, record the reason — and nothing
rendered `last_error`. From the product this looks like "the system did not send
the invitation", which is exactly what a school reports and exactly what nobody
can act on. Diagnosing it required a database query.

The Super Admin dashboard now carries a card that stays quiet when mail is
flowing and, when it is not, prints the mail server's reply **verbatim**
(`535 … authentication failed` names the fix; "email could not be sent" does
not) plus which two variables to check and how long before the queue gives up.
It counts *queued with a failed attempt* rather than plain queued, because mail
waiting its turn is not a problem.

Same class of defect as the "Manual" subdomain badge (§5ad) and the discarded
send outcome (§5ac): the platform knew, stored it, and told nobody.

### For the next person

`email_outbox.last_error` is the first place to look for any "the system did not
email X" report — **before** suspecting the feature that was meant to send it.

---

## 5ai. School and branch creation, fixed — 2026-08-18

A batch of ten reported fixes against the Super Admin's creation surfaces, plus
the two Supabase defects the last of them turned out to be. Migration `0024`,
applied and verified. **Not a sprint** — Sprint 13.5 (accounting) is still next
and Sprint 14 is still internal chat. The migration was briefly named
`0024_sprint14_…` and was renamed before merge for exactly that reason.

`release-notes/RELEASE-NOTES-SCHOOL-BRANCH-CREATION-FIXES.md` is the
school-facing account. This section is the parts a future session needs.

### The chart: the failure was invisible to every automated check

Eleven module labels on an x axis with ~54 units each. Type-checked, built
green, rendered valid SVG, and was completely unreadable. `BarChart` gained
`orientation="horizontal"`; nothing else moved to it, because every other chart
in the product is a time series or a short-labelled comparison.

**The rule worth keeping:** a vertical bar label's budget is
`plotWidth / categories.length`. Past roughly a dozen categories, or any label
longer than about eight characters, go horizontal. Rotation and truncation both
look like fixes and are not — truncation renders "Academics & Timetable" and
"Accounts & Finance" identically.

### Two validators per field, deliberately not one

`lib/phone-formats.ts` ended up with two functions per format, and the split is
the point:

- `isValidMobile` — the **exact display shape**. What the form asks. The
  requirement said "any other format is not acceptable", so `0321-1234567` is
  refused: right digits, wrong format.
- `hasCompleteMobileDigits` — the **digits only**. What the server asks, in
  `lib/profile-fields.ts`, followed by normalisation.

The server is looser on purpose. Its callers are not only this application — a
bulk import sending `0213456789` is not making a mistake — and what matters is
that everything *stored* comes out in one canonical shape. QA caught the missing
strictness on the form side; do not collapse these two back into one function.

### `auth_user_id` means "has been through setup", and five things read it

This is the trap to avoid re-stepping on. The obvious fix for "Supabase holds no
real addresses" is to create the account and store `auth_user_id`. **Do not.**
That column gates the password-setup link, chooses which of two emails the panel
sends, drives the "Invite pending" badge, permits an emergency link, and is what
`membershipFor()` matches a session against. Filling it when an account is merely
*registered* makes all five claim the person is established when they have no
password and have never signed in.

So `lib/school-bootstrap.ts` registers the address with Supabase and leaves the
column null. The setup and OTP routes still write it, at the moment it becomes
true. `getOrCreateAuthUser` is idempotent, so the setup route finding a
pre-registered account is the normal path, not an edge case.

### Deleting a member now deletes the Supabase account — with one guard

`auth.users.email` is globally unique, so an orphaned account claimed the address
permanently and re-inviting the same person returned them to their old
credential, password included. `deleteSchoolMember` now calls
`releaseAuthAccount`.

**The guard is load-bearing:** one Supabase account is one *human*, not one
membership, which is what lets an address be a teacher at one school and a parent
at another. The account is deleted only once no other `school_users` row holds
that address — and the check is by **address, not `auth_user_id`**, because
somebody registered but never set up has the address and no id. Matching on the
id would leave behind exactly the accounts most likely to need clearing.

### The location picker degrades, and is currently degraded

`cyphercodes/location-picker` over the Google Maps JS API, wrapped in
`components/ui/LocationPicker.tsx`. **No working `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
exists**, so the address is presently the plain text field it always was, with
one line saying why. That is designed behaviour, not a bug to chase — see §6.

A key was supplied on 2026-08-18 and tested. It is a valid key on a project that
is **not billed**, and whose API restrictions **exclude Maps JavaScript API**.
Both were confirmed directly: the Geocoding REST call returns `REQUEST_DENIED`
with "You must enable Billing", and the browser logs `ApiTargetBlockedMapError`
while Google paints its own error panel into the map. It was **not** wired into
any environment, because a configured-but-broken key is worse than none — the
operator gets "the map could not be loaded" instead of "map picking is off".

**Three things this exposed, all now fixed, all measured rather than assumed:**

1. **A script that loads is not a map that works.** `maps/api/js` returns 200
   and a valid loader for *any* key. The rejection happens later, inside the
   library, and is never thrown — so the `catch` never fired and the component
   sat at `ready` showing a grey error box with two dead buttons.
2. **`gm_authFailure` only fires if registered before the first map is
   constructed.** It does not replay. Registered afterwards it is never called,
   which is a difference the documentation does not mention and which the first
   version of this fix got wrong.
3. **`Geocoder.geocode` never calls its callback when the API is blocked.** No
   error, no rejection, nothing — so the spinner ran forever and both buttons
   stayed disabled. There is now a ten-second ceiling.

Only the **first** map on a page receives Google's error panel; a second renders
an empty container. That is why `gm_authFailure` is the primary signal and the
panel check is the fallback, not the other way round.

### `npm run check-forms`

60 assertions over the form rules and the chart geometry. Same shape as
`check-theme` and the rest. It found two defects on its first run, one of them
real. Run it after touching `lib/phone-formats.ts`, `lib/email-validation.ts`,
`lib/branch-classes.ts`, `lib/cities.ts` or `components/charts/BarChart.tsx`.

### QA was done without signing in, and why

Only `SUPER_ADMIN_PASSWORD_HASH` exists — there is no plaintext password in any
environment, and a password should not be typed into a form by a session anyway.
So the panel screens behind the login were **not** click-tested. What was done
instead: the 60 assertions, the chart rendered through `react-dom/server` and its
geometry checked (labels at 26-unit intervals, none sharing a baseline), a green
build, `tsc`, `eslint`, and all five existing `check-*` scripts. **The forms have
not been driven by hand in a browser.** That is the honest gap in this batch.

### `max_grade` is still there, still populated, and read by nothing

Two branches have a value in it. It cannot be converted to `class_levels`
automatically because `Grade 10`, `10`, `O2` and `Matric` were all valid answers
to a free-text box. Ask before guessing.

---

## 5aj. Panel chooser, school deletion, address autocomplete — 2026-08-18

Three follow-ups to §5ai, same day, **no migration**. Release notes:
`release-notes/RELEASE-NOTES-PANEL-CHOOSER-AND-SCHOOL-DELETION.md`.

### Permanent school deletion, and the two things that make it safe

`DELETE /api/super-admin/schools/[schoolId]?permanent=true`. Deactivation stays
the default and the unmarked path; erasure is the opt-in.

**All 61 foreign keys to `schools.location_id` are `ON DELETE CASCADE`** — that
was checked against the schema, not assumed, and it is why one statement is
enough and leaves no orphan. Verified empirically on a throwaway school: after
the delete, `branches`, `school_users` and `school_modules` all returned zero
rows for that `location_id`.

**Supabase accounts must be released before the delete, not after.** The cascade
removes `school_users` without a line of application code running, so afterwards
nothing remains to say which addresses belonged to the tenant.
`releaseSchoolAuthAccounts` runs first and applies the same
one-account-per-*human* rule as `releaseAuthAccount`: an address is only deleted
when no membership of any **other** school holds it. Deleting one school must
not lock a parent out of a second.

`confirmName` is checked server-side and must equal the school's name exactly. A
yes/no dialog is muscle memory by the third use; a typed name cannot be entered
absent-mindedly and cannot be entered at all against the wrong row.

### The landing page asks which *school*, not which role

There are not eleven sign-in panels, and the chooser must not imply there are.
Every school role signs in at the same `/login` on their school's subdomain;
`ROLE_HOME_ROUTES` decides where they land from their `school_users` row. Roles
are therefore *listed* (so a visitor recognises their own) while the question
asked is the one that genuinely has an answer: which school. Super Admin is the
other card, because the operator has no tenant and cannot sign in on a subdomain.

The school is **typed, not chosen from a list** — a dropdown of every tenant
would serve the customer list to anyone loading the front page. A wrong guess
reaches `/school-not-found`, which is what a wrong guess at any URL already does.

Host handling mirrors `buildHandoffUrl`: `<slug>.<apex>/login` on the platform
domain, `/login?school=<slug>` anywhere else. Sending a localhost visitor to
`beaconhouse.localhost:3000` would resolve to nothing.

### The map became autocomplete

`cyphercodes/location-picker` is **removed** and `<gmpx-place-picker>` from
`@googlemaps/extended-component-library` replaces it. Entering an address is a
naming task, not a pointing task. Coordinates still arrive, and from the
selected place rather than a dropped pin, so they are more accurate.

Two implementation notes worth keeping:

* **React 19 resolves JSX through `React.JSX`, not the global `JSX` namespace.**
  Augmenting the global one compiles clean and does nothing — the only symptom
  is a `@ts-expect-error` that never becomes unused. `declare module 'react'` is
  the form that works. See `types/google-maps.d.ts`.
* **`key` is reserved in React**, so the API key goes on `<gmpx-api-loader>` as
  the `apiKey` *property* via a ref, not as a JSX prop. Non-string properties
  (`country`) are set the same way, because React passes unknown props to custom
  elements as attributes and would stringify an array.

This deletes the three map failure modes recorded in §5ai — there is no map to
paint an error panel into, no `gm_authFailure` ordering trap, and no geocode
callback to hang. `gmpx-requesterror` replaces all three.

### QA was driven by hand this time

An operator session already existed in the preview browser, so the screens
behind the Super Admin gate were exercised directly — no password was typed.
That partly discharges §6 item 12. Confirmed visually: **the module-adoption
chart now reads correctly**, every label in full with its value at the bar end.

The branch form was driven through Karachi → `KHI-MAIN`, Mixed → board name,
O-Levels re-filtering the ticked classes from Grade 9/10 to O1/O2/O3 while
keeping Pre-School, and `+92 321 1234567` masking to `(0321) 123-4567`.

**One correction worth carrying forward:** the accessibility-tree reader showed
no Delete button on any school row and the first conclusion was that it had not
rendered. A direct DOM query found all nine. The tool was eliding them. A UI
absence reported by one tool is worth confirming with a second before it is
called a defect.

---

## 5ak. The deploy is split across instances — 2026-08-18

**More than one Node process serves `schoolhub.codexmill.com`, a push to `main`
does not restart all of them, and the proxy load-balances between old and new
builds.** Measured immediately after the §5aj deploy: ten requests to `/`
returned the new landing page twice and the old one eight times; twenty minutes
later it was still split, roughly four to two. It does not converge on its own.

The CSS hash shows the same thing — `50b746b551d725aa.css` and
`e1f6917cc82279b4.css` alternating on consecutive requests to the same URL.

This is not new and is not a surprise: `DEPLOYMENT.md` already warns that
**"a changing pid means more than one instance is behind the proxy, and they
need not hold the same environment — one restarted after your edit and one did
not."** That was written about environment variables. It applies equally to the
built code, which is the part nobody had checked.

### What this invalidates

**A single observation of the new build is not evidence that the deploy
landed.** The earlier §5ai deploy was declared live on exactly that basis — one
poll saw the new CSS hash and the loop stopped. Given this behaviour, that
observation was consistent with one instance in five having updated. Whether
§5ai is fully live is therefore *unknown*, not confirmed.

**Sample repeatedly.** The honest check is N requests and a count, against a
string only the new build emits:

```bash
for i in $(seq 1 10); do curl -s https://schoolhub.codexmill.com/   | grep -q "Go to my school" && echo NEW || echo OLD; done | sort | uniq -c
```

The smoke test does not catch this and cannot: every instance is healthy, they
simply hold different code.

### What fixes it

Restarting the application in hPanel, so every instance reloads. No session can
do it — there is no API for it, and `.github/workflows/deploy.yml` has a
`HOSTINGER_RESTART_COMMAND` for exactly this purpose but is `workflow_dispatch`
only and needs secrets the repo does not carry. See §6.

---

## 5al. Dashboard, deletion UI, branch delete, email — 2026-08-19

No migration. Release notes:
`release-notes/RELEASE-NOTES-DASHBOARD-DELETION-AND-EMAIL.md`.

### The email fault is a panel credential, and that is now proven

`email_outbox`: **11 sent, the last on 2026-08-13; then 7 consecutive failures,
every one `Invalid login: 535 5.7.8 Error: authentication failed`.**

The same `SMTP_USER`/`SMTP_PASS` in `.env.local` were tested against
`smtp.titan.email` and **authenticate on both 465 and 587**. During QA a branch
invitation queued on the local server was delivered `status: 'sent',
attempts: 1` — the identical code path that returns 535 in production.

So the code is fine, the mailbox password is fine, and the copy in the Hostinger
panel is wrong. **No session can fix this.** Do not go looking for it in the
code again.

"Supabase returns 200 but no email arrives" conflates two systems:
`admin.createUser` returns 200 and **sends nothing** — it never has. The email
that matters is the platform's own, through `email_outbox`.

### Three real gaps around it, now closed

* **Creating an administrator sends the email.** `POST .../users` used to write
  the row and stop, with "Send sign-in email" a separate press. That was the
  whole of "I created an Admin and nothing arrived".
* **A branch email can be invited as `branch_admin`.** It was a contact field
  that was never mailed, so typing an address there was a silent no-op. It needs
  a mobile too — `school_users.phone` is NOT NULL and unique per school, so an
  email alone cannot produce a row.
* **Abandoned mail can be requeued** from the Email Delivery card. The drainer
  never touches a `failed` row again, and several flows have no resend of their
  own, so without this the backlog is lost the moment the panel is fixed.

Shared logic now lives in `lib/access-email.ts` with three callers.

### Two z-index/spacing traps worth not repeating

**This project has a named z-index scale** (`tailwind.config.ts`): dropdown 1000,
**sticky 1100**, backdrop 1200, modal 1300. A dialog written with a raw `z-50`
was painted over by the Table's own sticky header. Use the tokens.

**`space-y-*` on a `Card` does nothing.** Card renders its children into its own
`px-5 py-4` body div, so the outer element has one child and a class that styles
gaps *between siblings* has nothing to act on. Put it on a wrapper inside.

### Branch deletion is not school deletion

A school cascades cleanly through all 61 keys. A branch does not: most of the
thirteen keys to `branches.id` are **`ON DELETE SET NULL`** — `students`,
`staff`, `school_users`, `payroll_runs`, `payslips`. Deleting a busy campus
would silently detach its people from any campus at all, with no error and no
record of where they were.

So it is refused unless the branch is empty, and the refusal names the counts.
That is the honest behaviour and it should stay.

### The estate shrank, and not by this session

Six schools — `oneten`, `proton`, `ABC Demo`, `Usman Public`, `check`, `credo` —
were deleted between the 2026-08-18 session and this one, leaving three. This
session only created and removed its own probes and confirmed nine remained. The
new delete feature works; this is a note that it was used, and that it cannot be
undone.

---

## 5am. The 535 was transport, and the wildcard faked provisioning — 2026-08-19

No migration. Release notes:
`release-notes/RELEASE-NOTES-SMTP-AND-WILDCARD-SUBDOMAINS.md`.

### §5al's conclusion was wrong, and its instruction made it expensive

§5al ended with "the copy in the Hostinger panel is wrong. **No session can fix
this.** Do not go looking for it in the code again." Every word of the evidence
was accurate and the conclusion drawn from it was not.

The password contains `!`, `@` and `#`. **In a `.env` line an unquoted `#` opens
a comment**, so dotenv discards everything after it. Measured against this
repository's own `@next/env`:

    SMTP_PASS=fooBar!x@y#z      ->  "fooBar!x@y"     truncated, silently
    SMTP_PASS='fooBar!x@y#z'    ->  "fooBar!x@y#z"

`.env.local` survives only because an earlier session happened to quote it. And
per DEPLOYMENT.md §3, **on Hostinger the panel and the `.env` file are one
store** — so a correct password typed into the Environment UI is written into a
`.env` line and truncated there, while the panel keeps displaying all of it.

That is the whole fault. It explains every observation §5al made, including the
ones that pointed away from the code: local works (quoted), production fails
(unquoted), and the panel looks right (it is right; it is just not what arrives).

**Proven:** resolved through the new path the password is 17 characters,
fingerprint `3e92ffa00be4`, and `smtp.titan.email` accepts it on 465 **and** 587.

### What now exists so this cannot recur

* **`SMTP_PASS_B64`**, the same escape hatch `SUPER_ADMIN_PASSWORD_HASH_B64`
  already provides. Base64 has no `#`, `$`, `!`, quote or backslash — nothing
  for dotenv, a shell or a panel to act on. Wins when both are set.
* **`npm run smtp-encode`** prints the value and a fingerprint.
* **`lib/smtp-credentials.ts`** repairs what is reversible (wrapping quotes,
  stray whitespace) and refuses to touch a value where the quote could be data.
  Truncation is *not* repaired — those bytes are gone, and guessing them would
  be worse than failing loudly.
* **A `[smtp]` boot line**, so a damaged credential says so before anyone
  presses Invite.
* **`POST /api/internal/smtp-check`** — length, fingerprint, fragile characters,
  which variable it came from, and the SMTP server's own reply to a real AUTH.
  The only check that reads the process actually serving requests.
* **`npm run check-smtp`** — 28 assertions, half of them asserting what the
  repair must *not* do.

### The subdomain fault: a wildcard answers every name, including ones nobody made

`rehearsal-academy.schoolhub.codexmill.com` was parked, read **"Not connected"**
in hPanel, got no certificate — and the database agreed nothing was wrong:
`subdomain_status = 'provisioning'`, `subdomain_error` **null**.

`d087f29` made the resolver the authority on whether a tenant's DNS record
exists. That was a genuine improvement — it stopped a working subdomain being
re-written and refused with a 422 the UI showed as *Failed*. **A wildcard
inverts it.** A wildcard answers every label by definition, so a school created
seconds ago resolves at once, `ensureDnsRecord` decides its record is already
there, writes nothing, and reports success. The name becomes *reachable* while
staying *unprovisioned*, and this code could not tell those apart.

All three symptoms follow from that one fact: hPanel looks for a record for that
exact name and finds none; certificates are issued per hostname against a name
the panel can see pointed here, and a wildcard is not that; and the platform
recorded success because it believed it had succeeded.

`nameHasOwnRecord()` now probes a random `wildcard-probe-*` label first — a name
nobody created cannot have a record, so if it resolves, only a wildcard can be
answering, and the API decides instead. **With no wildcard the probe fails and
behaviour is exactly what it was**, so the topology `d087f29` protected cannot
regress. A fourth readiness state, `wildcard-only`, replaces the actively
misleading `tls-pending` ("wait for the certificate") for a certificate that is
never coming.

⚠️ **Not measured from here.** That the live zone contains a wildcard is the
best-supported explanation for the symptom, not a verified fact: the Hostinger
MCP tools still answer `Unauthenticated` and `node:dns` is sandboxed in this
environment. The fix is correct either way.

### Every background failure was printing the query and hiding the reason

    [announcements] sweep failed: Failed query: select "location_id", "id" ...

Drizzle wraps the statement and hangs the driver's real error off `cause`; every
background catch logged `error.message` and threw the cause away. Four unrelated
problems all print that block. `lib/describe-error.ts` walks the chain (bounded,
cycle-safe) and appends the Postgres code.

**That query was run against the live database during this work and succeeded** —
the table and all thirteen columns are present. So production's failure is the
*connection*, not schema drift, and the log will now name it. Note the host also
prints `Failed to resolve IPv4 addresses with current network`, which is not from
this codebase or any dependency (checked) and points the same way.

### The estate

Three schools: `Rehearsal Academy`, `My Second Home School`, `Sample Test
School` — all `provisioning`, all with a null `subdomain_error`. Outbox: 11
sent (none since 2026-08-13), 7 queued, 6 failed, every failure `535` or
`Unexpected socket close`.

---

---

## 5an. Address and phone, made one field each — 2026-08-19

No migration. Release notes:
`release-notes/RELEASE-NOTES-ADDRESS-AND-PHONE-FIELDS.md`.

The user supplied a Mapbox `pk.` token and asked for address autocomplete on
every address input, a Mobile/Landline dropdown on every field titled "Phone",
digits-only masks for both — and for the rule to hold "on all the pages,
existing and in future".

### The token was tested before anything was built, and the answer shaped the design

Nine queries against the live Search Box API, before a line of component code:

    Starbucks (near Seattle)      4 results, POI    -> the token works fully
    Model Town Lahore             1 result,  locality
    Gulberg                       2 results, locality
    PECHS Karachi                 5 results, all cities/districts
    Beaconhouse                   0 results
    Ferozepur Road (Lahore prox.) 0 results
    Johar Town                    1 result — "Johan", Balochistan, 800km away

**Mapbox has Pakistani cities, districts and localities and almost nothing
below that.** The token is not at fault — global POI search returns four
Starbucks — and Geocoding v6 was tried as an alternative and is no better.
Google Places was denser here, which is a real regression in coverage and is
recorded plainly in the release note rather than buried.

That finding is *why the component is shaped the way it is*: the text box is
always present, always editable, never replaced by the results list, and an
empty result list is worded as ordinary. This was already the old component's
principle ("the place is the assistance; the text is the record") — with Mapbox
it stops being a nicety and becomes the main path.

### What was built

| File | What |
| --- | --- |
| `lib/mapbox-search.ts` | `suggest` then `retrieve`, plain `fetch`, no SDK |
| `components/ui/AddressAutocomplete.tsx` | replaces `LocationPicker` (deleted) |
| `components/ui/PhoneField.tsx` | dropdown + the two masks |
| `lib/phone-formats.ts` | gained `PhoneKind`, `detectPhoneKind`, the `*OfKind` helpers |
| `scripts/check-address-phone.ts` | 32 assertions + a source scan |
| `app/(public)/design-system/ContactFields.tsx` | the only place either field can be *seen* |

Eleven fields across nine files were converted. Removed:
`@googlemaps/extended-component-library`, `@types/google.maps`,
`types/google-maps.d.ts`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. The
`/super-admin/schools/new` route dropped from 3.6 kB to 840 B of route JS.

### Three decisions worth not re-litigating

**No `phone_kind` column.** The format is self-describing — `(0321) 123-4567`
can only be a mobile — so the kind is derived on load by `detectPhoneKind` and
never stored. This kept 61 foreign keys, every import path and every existing
row untouched, and means a number written by an API client that never saw the
dropdown still displays under the right mask. The round trip (store, detect,
re-mask, identical) is asserted, because a failure there silently rewrites data
on load rather than throwing.

**Landline is offered on identity fields and then refused.** A guardian's phone
is the unique index on `student_guardians`, is what an invitation resolves, and
is where a passcode goes; `normalizePhone` accepts `+92` and ten digits and
nothing else. The user chose (asked directly) to keep the dropdown visible and
fail validation with an explanation rather than hide the option — an operator
holding a landline-only guardian needs to learn the platform cannot reach them,
and a missing dropdown teaches nothing. **The alternative — relaxing
`normalizePhone` and gating the OTP path on kind — was offered and declined.
Do not implement it without asking again.**

**School and Branch keep two separate fields.** "Landline" and "Mobile phone"
against two columns, unchanged. A campus has both numbers and a dropdown would
force a choice between them. `check-address-phone` exempts them *only while
their own props call* `formatMobile(`/`formatLandline(` — the exemption is for
a field that already enforces the mask, not for a filename.

### Two defects found by building it

**`hasCompleteMobileDigits` accepted any eleven digits starting `0`.** So
`042 35300000`, a Lahore landline, was a valid "mobile" and the new dropdown
re-masked it to `(0423) 530-0000` — a number that does not exist, derived from
one that does. Caught by the round-trip assertion, not by inspection. Every PK
mobile prefix is `03xx` and the check now requires it. This is a **pre-existing
bug in the Sprint-`0024` validator**, live since 2026-08-18.

**Coordinates outlived the address they belonged to.** Pick "Model Town", then
type a different address over it, and the pin `31.48511, 74.32620` stayed
attached — so Save would file the new address at the old place's location,
silently, with nothing on screen contradicting it. The old Google component had
the same behaviour and it was carried across unnoticed. Found by driving the
field in a real browser, which is the only way it *could* have been found. The
retrieved text is now remembered and the pin dropped the moment the text
diverges.

### How it was verified — and this time in a browser

§5ai could not click-test because there is no plaintext Super Admin password,
and §5aj only got as far as an already-open operator session. Both address and
phone fields are behind a session *and* a tenant on every real screen, so
`ContactFields` was added to `/design-system` — the dev-only workbench route
that already exists for exactly this reason, and which 404s outside
development. Driven directly:

- `03ab00+12*34#567xyz` typed into the mobile field gives `(0300) 123-4567`.
  Letters, `+`, `*` and `#` discarded as typed; eleven digits; 4-3-4.
- `(042) 35300000` pre-filled: the dropdown reads **Landline**. The fix,
  observed rather than asserted.
- Switching the guardian field to Landline gives `aria-invalid="true"` and the
  identity refusal. The digits survived the switch.
- "Model Town Lahore", listbox, click: `Model Town, Lahore, لاہور, Punjab,
  Pakistan` and `31.48511, 74.32620`. **Latitude then longitude** — GeoJSON is
  `[lng, lat]` and reversing it puts every school in the sea off Somalia.
- Retyping the address afterwards: pin dropped.
- **Billing:** two full address entries (46 characters typed) produced
  **2 suggest calls and 1 retrieve**, across 2 session tokens. The debounce
  collapses keystrokes and the session rotates after a retrieve, which is the
  documented Search Box model; a token minted per keystroke would bill each one
  separately and would be invisible until the invoice arrived.
- Zero console errors.

### The part that answers "and in future"

`npm run check-address-phone`. Half of it asserts the mask behaviour; the other
half walks every `.tsx` under `app/` and `components/` and fails on any raw
`<Input>`/`<Textarea>` whose literal label names a phone or an address. 280
components, 155 labelled fields, 0 violations.

Writing the scan surfaced two false positives worth keeping in mind: "Email
address", and the panel chooser's "Your school’s address", which is a *web*
address taking a slug. Both are excluded by a `NOT_POSTAL` pattern matched
against the label **and** the props — the second needs the props, because its
label alone is indistinguishable from a postal one and `value={slug}` is not.

Gates: typecheck, lint, build, `check-forms` (60), `check-address-phone` (32),
`check-portals`, `check-reports`, `check-dashboard`, `check-theme`,
`check-provisioning` — all green. The §5f worktree `node_modules` stub
reappeared and was deleted before each build, as always.


---

## 5ao. The committed Mapbox token was refused, and rightly — 2026-08-19

No migration. Amends §5an the same day.

§5an committed the `pk.` Mapbox token into `lib/env.ts` as a fallback, on a
decision taken with the user: it meant address search worked on a fresh
checkout and on the live host with **no panel action**, and two panel actions
were already outstanding (§5w).

**`git push` was refused by GitHub push protection** — *Mapbox Secret Access
Token, `lib/env.ts:35`*. Two things about that are worth recording, because
they point in opposite directions:

- **The label is wrong.** The token is `pk.`, whose payload decodes to
  `{"u":"hasnainrehman","a":"cmszuk9w803ef2zqy9hxg71ii"}`. A Mapbox *secret*
  token is `sk.`. GitHub's detector does not distinguish them.
- **The block is right anyway.** `Haznain666/School-Managment` is a **public**
  repository. A live token in it is scraped regardless of whether the scanner
  classified it correctly.

**The decision reversed because its premise did.** The whole argument for
committing it was "then nobody has to open a panel". Unblocking the push is
itself an action — through GitHub's allow-secret URL — so it was one action
either way, and the safer action wins. The user chose to remove the fallback.

`lib/env.ts` now reads `process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''` with no
literal. The absent-token path was already built and tested (`UC-APF-19`):
every address field degrades to the plain text input and says in one line why
there is no search.

**The token had to come out of the unpushed history, not just the tip.** Push
protection scans every commit in the push, and the literal was in `c4aa30a` and
in all five commits after it. `git filter-branch` over `origin/main..main`
rewrote `lib/env.ts` in all six; `backup-before-token-scrub` tags the
pre-rewrite tip. Nothing was pushed at any point, so no published history moved.

**Consequence to act on:** `NEXT_PUBLIC_MAPBOX_TOKEN` is now a real panel
action, recorded in §6 item 11. Address autocomplete is off on live until it is
set — degraded, not broken.


## 5ap. Three onboarding faults, and one of them was never reproduced — 2026-08-19

No migration. Reported by the user as three numbered defects on the school
onboarding path. **Pushed to `main` and live, 2026-08-19 — verified, not
assumed.**

The deploy was confirmed by a probe that can only answer one way per build:
`POST /api/school/branches` returns **405** on the old code (the route had no
POST export) and **401** on the new one. Live answered 401 on **16 of 16**
samples, which also says every process behind the proxy is on this build — the
§5ak split is not present right now. `/login` 200, `/dashboard`,
`/dashboard/branches` and `/dashboard/users` all 307 to login, Super Admin login
200.

⚠️ **Do not use the `/login` chunk hash to detect a deploy.** It was polled for
five minutes after the push and never moved, because the shared webpack runtime
chunk is content-identical across these builds. It looked exactly like a deploy
that had not happened. Probe a route whose *behaviour* changed instead.

Written up for a reader who is not an engineer in
`release-notes/RELEASE-NOTES-SCHOOL-ONBOARDING-FIXES.md`, with 27 cases in
`test-cases/TEST-CASES-SCHOOL-ONBOARDING-FIXES.md`. **UC-SOF-01 to UC-SOF-05 are
marked UNTESTED and mean it** — verifying the school-creation email end to end
requires creating a real school, which provisions a subdomain at the host, and
that was not done unasked.

### 1. Creating a school created an administrator and told them nothing

**Proven from the data, not inferred.** `password_setup_tokens` held exactly one
row for LGS — the branch administrator, created at 12:30 from the branch form.
The *school* administrator, created at 11:31 by school creation itself, had
none. `email_outbox` said the same thing from the other side: the only message
that address ever received was an `/invite/<token>` link queued at 11:40, which
is the school portal's own invite flow, sent by hand nine minutes later by
somebody working around the silence.

The cause is a one-line omission with three witnesses. Every path that mints a
member queues `queueAccessEmail` — `POST .../schools/[schoolId]/users` does it,
and so does the branch form — and `lib/access-email.ts` opens by explaining that
it exists as a module precisely so those callers cannot drift. `POST
/api/super-admin/schools` called `createFirstSchoolAdmin` and then went straight
on to provisioning the subdomain. The one route that provisions the *first*
person into a school was the only one that never told them.

**What the user actually received, and why it looked like verification.** The
invite flow (`InviteOTPForm`) is deliberately password-less: it emails a
six-digit code, and its own accept route says "Signs them in on this response.
They set a password from the portal." So the mail that did arrive was a code,
not a link — which is exactly what "only being sent an email verification email"
describes. The user's assumption was correct.

Fixed by queueing the access email at school creation, with `authUserId: null`
passed deliberately rather than read back — the row is seconds old and has never
been through setup, so this is always the `/set-password/<token>` mail. The
outcome is returned as `adminEmail: { queued, problem }`, and `SchoolForm` now
lands the operator on the school's **Users** tab whenever the administrator was
not created *or* the mail did not queue. Previously only the first of those two
was visible.

### 2. "School portal unavailable" on /dashboard/users — not reproduced

**Say this plainly: the reported page was never made to happen again.** What was
established instead:

- The live site answers `/dashboard/users` correctly. Anonymous: 307 to
  `/login?next=/dashboard/users`, 14 samples, no exceptions. With a garbage
  session cookie: 307 to `/login?school=lgs` — which is the *layout* redirecting
  after reading the tenant headers, so middleware stamped them.
- Locally, against the real production database, `/dashboard/users` renders for
  all three session kinds — `school_admin`, `branch_admin`, and a platform
  operator hand-off account with no `school_users` row at all.
- The school itself is fine: `lgs` exists, `is_active` is true, and
  `role_permissions` is empty, so the defaults apply and `school_admin` holds
  every key.

Only three things in the codebase can produce that page at that URL, and two are
ruled out by the above. The third is `resolveSchoolBySlug` **throwing**.

`fetchSchoolBySlug` is careful to distinguish "no such school" (returns null)
from "the lookup failed" (throws) — its docblock says so — and middleware then
collapsed the distinction, sending both to `/school-not-found`. So one slow or
refused HTTPS call to Supabase told a signed-in administrator their school does
not exist, on whichever page they happened to click next. Reloading fixed it.
That is precisely the shape of a fault that is real, unreproducible, and blames
the wrong thing.

**Hardened rather than "fixed", and the difference is worth keeping.** The
lookup cache now serves its expired entry when a refresh cannot be made. A
school that resolved 61 seconds ago has not stopped existing because one request
failed; only a *first* lookup, with nothing cached at all, can still fail. The
60-second TTL keeps the meaning it was written for — a deactivated school stops
being reachable within a minute — because that answer arrives as a *successful*
lookup and replaces the entry. Every fallback is logged, so an outage is still
visible rather than absorbed.

⚠️ **If the user sees it again, this did not fix it** — and the next place to
look is §5ak, the two Node processes behind the proxy. Header casing still
differed between two consecutive responses to the same URL during this session
(`X-Powered-By` vs `x-powered-by`), which is more than one process answering.
The `/login` chunk hash was identical across 12 samples, so they are not
currently serving different *builds*.

### 3. Invite Staff asked for a branch it would not let you create

Every role worth inviting from that screen requires a branch. A school that had
never had one entered saw the form render, the Branch select stand empty, and
the only feedback be "this role must be assigned to a branch" against a dropdown
holding nothing. Branches were creatable **only** from the Super Admin panel —
`app/api/school/branches/route.ts` was GET-only and said so in its docblock — so
the school administrator's actual next step was to email the platform operator
and wait.

Four changes, in the order they matter:

- **`POST /api/school/branches`**, gated on `settings.write` (school-level
  configuration, the same key as the profile and the palette; by default
  `school_admin` only). It **never creates a member** — that is the user's
  second sentence and it is now a property of the route, not a checkbox somebody
  can tick. The first campus is forced to be the main one, counted from the
  table after the insert: a school with one branch and no main branch is a state
  nobody chooses and it quietly breaks every challan header.
- **Invite Staff redirects** to `/dashboard/branches/new?next=/dashboard/users/invite`
  when the school has no branches and the caller can create one. Somebody who
  holds `users.write` but not `settings.write` is not bounced into a screen that
  would refuse them — they get an empty state naming who can help.
- **The branch form is the Super Admin's**, given no `schoolId`. That absence is
  the whole switch: which endpoint, where to go afterwards, and the two controls
  an operator holds and a school does not. **The invite toggle is one of them**,
  which is what makes "no user will be invited during Branch creation" true by
  construction. The **Active** toggle is the other — inside the portal an
  inactive branch is invisible, so a school administrator switching it off would
  hide a campus with no screen left that shows it again.
- **`/dashboard/branches` exists.** It has been a `placeholder: true` link in the
  sidebar since Sprint 10.5, which in practice meant it 404d — there was no such
  route. It now lists the campuses and offers Add.

**Two pieces of copy were lying and were corrected while here.** The invite page
said "goes out over WhatsApp, with email as a fallback"; `lib/invite-sender.ts`
reversed that at Stage 4 and its docblock explains why — email is what the
account is keyed by, WhatsApp is a per-school add-on. The page now asks
`isWhatsAppEnabled` and says what will actually happen. `InviteForm`s phone
validation said "invitations are sent over WhatsApp"; the number is required
because `school_users.phone` is NOT NULL and unique per school, whether or not
anything is ever sent to it.

### How it was verified

Sessions were minted server-side for real accounts through `mintSessionForEmail`
— the same call the operator hand-off uses — behind a temporary route that
refused to exist outside `NODE_ENV=development` and was deleted before commit.
No password was set and no live row was written.

- All three new/changed pages render as `school_admin`; the branch form appears
  inside the school's own palette with no invite toggle and no Active toggle
  (screenshotted).
- The no-branches path was exercised by making `listBranchOptions` return `[]`
  behind a local-only env flag, reverted after. The redirect fires: the RSC
  payload carries `dashboard/branches/new?next=/dashboard/users/invite;307;`.
  Both destination screens show their first-branch copy.
- `POST /api/school/branches` was driven six ways — duplicate code, unknown
  city, MIXED without a board, bad curriculum, missing name, malformed mobile —
  each returning the right code and message. The duplicate case runs the real
  INSERT and hits `onConflictDoNothing`, so the statement is proven against the
  live table **without leaving a row behind**. A `branch_admin` gets 403 on POST
  and 200 on GET.
- An attempt to test the empty case by deactivating the live branch was blocked
  by the sandbox, and that was the right call — it would have been a write to
  the user's production data for a test. The env-flag route above is what
  replaced it.

`tsc --noEmit` clean, `eslint` clean, build green with `/dashboard/branches` and
`/dashboard/branches/new` both present.

⚠️ **The Super Admin branch form still offers `inviteAsBranchAdmin`, on
purpose.** An operator setting a school up over the phone has no other chance to
give a new campus somebody, and a branch email typed there used to go nowhere at
all (§5aj). Only the school-side form drops it.


## 5aq. Response time: it was never the code — 2026-08-19

The user reported that response time had deteriorated, and attached Hostinger's
own diagnostics panel scoring the site 0 on "Document request latency", "Reduce
unused CSS", "Network dependency tree", "Render-blocking requests" and "Avoid
multiple page redirects", and 50 on "Legacy JavaScript" and "Reduce unused
JavaScript".

**Nothing was assumed. 34 timed requests were taken against the live origin
before a single line was read.**

### What the measurement said

`curl` against `https://schoolhub.codexmill.com`, taking `time_starttransfer`
minus `time_appconnect` so the figure is the server's and not the handshake's:

| Path | Fast | Slow | Server time |
| --- | --- | --- | --- |
| `/` | 19/22 | 3/22 | ~85 ms vs ~1.02 s |
| `/school-not-found` | 9/12 | 3/12 | ~85 ms vs ~1.01 s |
| `/super-admin/login` | **0/12** | **12/12** | 0.82 – 1.23 s |

Every response carries `Server: hcdn` and `x-hcdn-request-id: …-kul-edge1/3`,
and the domain resolves to `145.79.24.125` / `145.79.29.161` — Hostinger CDN
anycast, edge in Kuala Lumpur. So the bimodality is not noise: **~85 ms is a
CDN cache hit and ~1 s is the trip to the origin.**

### The experiment that settled it

The same production build, `next start` on the laptop:

| | Live origin | Same build, local |
| --- | --- | --- |
| `/super-admin/login` | 0.82 – 1.23 s | **10 ms** |
| `/` | ~1.02 s on a miss | **4 ms** |

A hundredfold, on the same bytes. And `/school-not-found` — prerendered, runs no
code — took the *same* ~1 s on a cache miss as the pages that query.

**Therefore essentially the whole second is transport between the CDN edge and
the origin, not compute.** This is worth stating flatly because it is the exact
shape of the mistake §5am cost three sessions: a thing that is fast in one
environment and slow in another is a statement about *transport*.

What was checked and found already correct, so that no future session re-derives
it: `dashboard/page.tsx` already batches with `Promise.all`; `readSchoolSession`
and `loadOverrides` are already wrapped in React `cache()`, so auth is one
indexed query per request; ~150 indexes cover every tenant-filtered table; the
outbox drainer is `FOR UPDATE SKIP LOCKED` with an age-guarded reclaim and its
only query is index-served.

### What was changed

**1. `/super-admin/login` is prerendered.** It read `searchParams.next`, which
made it `force-dynamic` and therefore uncacheable, for a page with no query and
no session. The parameter is now read by `useSearchParams` in the form.

Making the page static was **not sufficient** — the build still marked it `ƒ`.
`app/(super-admin)/layout.tsx` is `force-dynamic` and reads the session cookie,
and a dynamic layout drags every route beneath it dynamic. The route was moved
to a new `app/(platform-public)/` group with a copy of the error boundary. It
renders identically: that layout returns `<>{children}</>` when there is no
session, which on that route is always. Now `○ (Static)`.

**2. Middleware serves an expired school record and refreshes behind it.** The
lookup ran before anything else on every request, so the whole response waited
for it. Measured against the real Supabase project: **3.5 s cold, 10 ms warm**,
and under the old code the first request after each 60 s expiry paid it in full
— always a person's click, never a background job's. `event.waitUntil` keeps
the refresh alive past the response; a `refreshing` set prevents a stampede.

Proven across the TTL, on the built app:

```
T+0   cold                    ttfb=1.510
T+1   warm                    ttfb=0.010
T+66  first after expiry      ttfb=0.012   <- previously ~1.5s
T+67  next                    ttfb=0.010
```

The cost is stated in the code: deactivation now takes effect within 60 s **plus
one request**. That is not the security boundary — `withSchoolAuth` and
`requireSchoolRole` re-check the tenant against verified claims on every
protected route.

**3. The Hostinger diagnostics items that are code.** A modern `browserslist`
(kills the legacy-JS polyfills), `compress: true` stated rather than defaulted,
`productionBrowserSourceMaps: false`, `poweredByHeader: false`,
`optimizePackageImports` for `lucide-react`, and immutable cache headers on
`/_next/static`.

### A loader on every screen, and a check that keeps it that way

The rest of the second cannot be removed from the code — authenticated HTML is
per-session and can never be edge-cached. So the work went into not making
anyone stare at nothing during it.

- **108 `loading.tsx` files**, one per data-fetching segment, each matched to
  the shape of its page. Five new page-shaped skeletons in
  `components/ui/Skeleton.tsx`: `SkeletonPageHeader`, `SkeletonForm`,
  `SkeletonDetail`, `SkeletonChart`, `SkeletonDocument`.
- **`components/ui/RouteProgress.tsx`** — a bar across the top of the window for
  the gap before the skeleton, i.e. the click and the wait for the first byte.
- **`npm run check-loaders`** — fails the build on a missing loader, on a loader
  where there is nothing to wait for, on one that renders no skeleton, and on
  one placed above a section rather than on a screen. **The rule is written in
  the new `CLAUDE.md`** and added to `sprint-developer`'s definition of green.

Measured effect, on `/login?school=lgs` with the build running locally:
**first byte at 10 ms, all data in place at 1.27 s.** Previously that was 1.27 s
of blank page.

### Two bugs found by looking in the browser rather than at the build

**The group-level loaders had to go.** Five existed, one per portal group. They
were fine while every route under them was dynamic. The moment
`/super-admin/login` became static, `(super-admin)/loading.tsx` rendered its
stat tiles and six-row table **permanently above the sign-in form** — in the
server HTML, so hydration was never going to clear it. All five are deleted
(every segment now has its own) and `check-loaders` refuses a loader that has
no `page.tsx` beside it.

**The first `RouteProgress` watched anchor clicks, and that was wrong.** The
landing page navigates with `router.push` from a `<button>`, and so do the
panel chooser and every redirect-after-save. It now counts in-flight `RSC: 1`
fetches, excluding `Next-Router-Prefetch`, which catches `<Link>`,
`router.push`, `router.replace` and `router.refresh` alike and nothing else.
Verified in the browser: clicking "Super Admin sign in" on the landing page
raised the bar and landed on the form.

### Verified on the live site after the deploy

Measured against `https://schoolhub.codexmill.com` once the git-connected build
had landed, so these are the authoritative "after" numbers.

**`/super-admin/login`, the page that was changed:**

| | Before | After |
| --- | --- | --- |
| Fast samples | **0 of 12** | **10 of 10** |
| Server time | 820 – 1230 ms | **86 – 91 ms**, median 90 |
| Payload | 42,920 B | **9,910 B** |

**A tenant page that can never be cached** (`lgs.schoolhub.codexmill.com/login`,
8 samples after warm-up): first byte at **840 – 1030 ms**, complete at
**2.0 – 2.2 s**.

Those two rows together give the cost model, and it is worth writing down
because every future performance question here resolves against it:

    CDN cache hit .............   ~85 ms
    CDN edge -> origin hop ....  ~800-900 ms   <-- fixed, transport
    application compute .......   ~10 ms

The tenant page's ~900 ms to first byte is **the hop and essentially nothing
else** — the shell flushes instantly at the origin, then spends 900 ms in
transit. Which means the skeleton work is doing exactly what it was meant to:
the reader sees the page's shape at 900 ms instead of a blank screen until
2.2 s, and no further code change can improve the 900 ms.

The samples cluster in two bands (~845 ms and ~1025 ms) rather than scattering,
which is consistent with **§5ak's two Node processes still being in place**.

CI is green on `aa618b6` including the new loader gate, on Node 22.

### One intermittent seen in passing, and cleared as not-mine

Once, on a locally-running build, the announcement sweep printed:

    [announcements] sweep failed: ... The "string" argument must be of type
    string or an instance of Buffer or ArrayBuffer. Received an instance of
    Date [ERR_INVALID_ARG_TYPE]

The `sweep failed:` shape is the known one from §5am; the cause line is new,
and it names a real postgres-js parameter-serialisation failure rather than a
connection refusal.

**It is not from this work, and that was checked rather than assumed.** The
same `new Date()` parameter succeeds against the live database through the raw
driver on this machine (postgres 3.4.9, Node v24.18.0). A build of `main` with
every change stashed was run for ~2.5 minutes and did not produce it; a build
*with* the changes was then run for longer, plus six concurrent requests, and
did not produce it either. It fired once and has not been reproducible since.

Left as an open intermittent. No code was changed for it — a background worker
that logs its cause and retries on the next sweep is already behaving
correctly, and the wrong move would be to "fix" a failure nobody can summon.

### Left for the user, because no code reaches it

🔴 **The ~1 s edge→origin hop.** Proven to be transport. Three things worth
doing in hPanel, in order: check **where the origin datacenter is** relative to
the Kuala Lumpur edge; test whether **the CDN helps Pakistani traffic at all**
(Lahore → KL → origin may be slower than Lahore → origin); and confirm
**whether two Node processes are still running** (§5ak — still open).

The Hostinger MCP server is connected but **unauthenticated** in this session,
so none of the three could be read or changed from here.

⚠️ **The CDN's WAF returned 403 to this IP after ~34 requests in ~3 minutes.**
A school office behind one NAT'd connection could plausibly trip the same rule.
Not investigated further.

## 5au. Sprint 13.5 — Accounting: the ledger, expenses and per-staff cash — 2026-08-21

**The sprint `STATE.md` has pointed at for six sessions.** Six tables, one
column, seven reports and one rule that everything else in the module exists to
serve.

### The rule

`ledger_transactions` and `ledger_entries` are **append-only**. Nothing in this
application updates or deletes a row in either. A correction is
`reverseTransaction` — a second transaction whose lines are the mirror of the
first, carrying `reverses_transaction_id`, with both left in the book.

That is not purity. A parent disputing a figure in March is asking about a
payment made in October, and the only answer a school can give is the entry as
it was written plus everything that has happened to it since. Sprint 16's parent
wallet and Sprint 20's POS both post here, so the rule had to hold before real
money arrives rather than be retrofitted underneath it — which is the whole
reason `SPRINTS.md` §0.9 put accounting at 13.5 and not after payments.

`postTransaction` in `lib/ledger.ts` is the only door. Every posting in the
product goes through it, which is what makes the balance check true of the whole
book rather than of the paths somebody remembered to check.

### The column is the point of the sprint

`fee_payments.ledger_transaction_id`. Money the school has already taken is now
part of the same books as the money it spends, and the posting commits **in the
same database transaction** as the payment — not fired-and-forgotten like the
WhatsApp confirmation three lines below it. A payment recorded without its
posting understates income *silently*, and nothing on any screen would ever say
so.

Migration `0027` backfills every fee payment ever recorded, dated to the payment
rather than to the day the migration ran. Without that, the ledger opens empty
at a school that has been taking money for a year, Cash in Hand reads zero, and
the first person to look at a balance sheet concludes the module does not work.

### Per-staff cash accounts, and the number they produce

A cash payment does not land in the office safe. It lands in the drawer of
whoever took it, and those are different facts — a school where they are the
same number is a school where nobody can be short.

Each person who takes money can be given their own asset account
(`ledger_accounts.owner_user_id`). `cashAccountForStaff` answers with their
drawer if they have one and the office drawer if they do not, so **a school that
never opens one behaves exactly as it did before this sprint.** Their balance in
between is what they owe the school right now, which is the number the
competitor demonstrates and the number this design exists to produce.

Settling stores two figures: what the drawer *should* have held and what was
actually counted onto the desk. The difference is **not written off.** It stays
in the clerk's account as a balance they are still carrying, and the form says
so — writing it off is a decision a head teacher makes with a journal entry, not
something a form does quietly at four in the afternoon.

`accounting.settle` is a third permission for the same reason, and the
`accountant` role deliberately does not hold it by default: a person who both
takes money across a desk and accepts their own count is a control with nobody
in it.

### Two decisions taken against the sprint document, both deliberate

1. **`ledger_entries` got a header table.** §13.5 names one table. A transaction
   has exactly one date, one memo and one cause, and two or more sides;
   repeating the date per line lets the two halves of one transaction fall on
   different days. Splits are real here, not hypothetical — payroll is one
   transaction with a line per deduction head.

2. **The module flag is the existing `accounts`, not a new `accounting`.**
   `lib/platform-modules.ts` has carried "Accounts & Finance" since Sprint 2.
   A second key would be two switches for one thing plus a `school_modules`
   CHECK change, and a school with the old flag on and the new one off would
   watch the module disappear on deploy.

### Income is recognised on receipt, not on billing

A fee payment posts; raising a challan posts nothing. The accrual alternative —
debit `1100 Fees Receivable` on issue, clear it on payment — would put eight
hundred transactions in the day book every time a school bulk-generates a
month's challans, and would give the school **two answers** to "how much is
outstanding": the ledger's and the fee module's. The fee module's has a challan
number attached to every rupee of it, so it stays authoritative and the
aged-debt report still reads it. `1100` is seeded for opening balances entered
by hand.

This is written out at length in `0027`'s header, because it is the decision
somebody will otherwise reverse in a later sprint without knowing it was one.

### Seven statements, for the price of seven declarations

Balance sheet, profit and loss, day book, day-by-day account summary,
month-by-month, expenses by category, and the income/expense summary for tax.
All seven are `lib/report-catalogue.ts` definitions plus runners, which is what
Sprint 12's architecture buys: each gets the screen, the `PrintSheet` and the
CSV with no third renderer written. A balance sheet that could be read on screen
and not printed would be worth very little to a school taking one to a board
meeting.

Every one reads `ledger_entries` and nothing else. A balance sheet assembled
from the fee module, the payroll module and a spreadsheet is three modules'
opinions, and the first thing anybody asks of it is why it does not balance.

### The dashboard tile that said it could not answer, now answers

`StatTile`'s `unavailable` state has carried "Needs the accounting ledger" since
Sprint 10.5. It shows a figure now — but only where the module is on, the caller
holds `accounting.read`, **and** the school has actually set up a chart. Under
any of those being false it goes back to saying so, because the original
reasoning has not changed: a tile reading `PKR 0` for a school that collected
three lakh this morning is confidently wrong with no way for the reader to tell.

### `npm run check-accounting` — 121 assertions, in CI

Every failure this module can have is **silent**. An unbalanced ledger does not
throw, it stops balancing. A sign convention inverted in one place produces a
profit and loss on which salaries appear to earn the school money, and every
number on it is a plausible-looking number. There is nothing for a type-checker
or a passing build to object to.

So the rules are asserted: debits equal credits; a mirrored entry nets every
account it touched to zero; income reads `+1,000` and not `−1,000`; a cheque
lands in `1020` and not the bank; the balance-sheet identity holds and breaks
when one paisa is added to one side. **The check was verified by breaking two
rules on purpose** — `normalBalanceOf` for expenses and the cheque landing
account — which produced five failures across four sections, and by restoring
them.

It also asserts that `0027`'s hand-written seed and `DEFAULT_CHART` describe the
same fifteen accounts and eleven categories, which is the strongest thing a
credential-free check can say about two copies of one list.

### What has not been done

**Migration `0027` has not been applied to the live database.** No session here
holds the credentials. It is written, generated from the schema files so the
snapshot cannot disagree with it, and its hand-written half is asserted by
`check-accounting` — but the schools' books do not exist until somebody runs it,
and until then every fee payment taken is a payment with a null
`ledger_transaction_id` that no backfill will pick up retrospectively unless
`0027` is run **before** enough of them accumulate to matter. (It will pick them
up: the backfill is guarded on that column being null, not on a date. Run it
whenever.)

**Nothing has been looked at in a browser** — the third sprint running. Six new
screens exist and none has been seen.


## 5av. Sprint 13.5, driven end to end — and the day book that never worked — 2026-08-21

The sprint was merged (PR #22, `eec668f`) and then actually run. Both halves of
that sentence matter: everything below was found **after** a green build, ten
passing gates and a merge.

### What was possible here that has not been possible before

This container has **PostgreSQL 16 and Chromium**. Four sprints of "nothing was
looked at" were not a discipline problem — no session had a database to look at
anything *with*. It does now, and the recipe is worth keeping:

```
initdb under /var/lib/postgresql   (not the scratchpad — postgres cannot
                                    traverse it, and pg_ctl fails on permissions)
a self-signed cert in $PGDATA      (lib/postgres.ts hardcodes ssl: 'require';
                                    postgres-js does not verify, so a
                                    self-signed cert is enough)
apply db/migrations/0*.sql in order with psql -v ON_ERROR_STOP=1
```

All 28 applied clean. That is the first time any session has proven a migration
before shipping it.

### 🐛 The day book threw on every call

`/dashboard/reports/day-book` — the screen, the print sheet and the CSV —
failed with `column reference "id" is ambiguous`.

**The rule nobody had written down:** Drizzle renders a column interpolated
into a `sql` template **unqualified** when the outer query has a single table
in its `FROM`, and **qualified** once a join is present.

The day-book runner read its amount and its two account names with five
correlated sub-selects on a single-table query. They came out as bare `"id"`,
`"debit"`, `"transaction_id"`. The near-identical sub-selects in
`lib/accounting-queries.ts` — `listExpenses`, `listSettlements`,
`listStaffCashAccounts`, `listExpenseCategories` — came out fully qualified and
correct, because each sits beside a join. **The same construct, right in one
file and wrong in the other, and neither file said why.** All four were checked
against real data and all four are correct.

One sub-select was ambiguous and Postgres refused it. The one beside it was
worse and is the part to remember: `where "transaction_id" = "id"` is a legal
comparison of two `ledger_entries` columns that is never true. **Had the query
not thrown, the day book would have printed a column of zeroes and reported
nothing wrong.**

Fixed as two queries and a regroup — the shape `listDayBook` already used, in
which no interpolated column ever leaves the query it belongs to.

### 🐛 And the check that exists to catch this was itself red

`scripts/check-reports.ts` executes every runner against a real schema. It is
the only thing in this repository that could ever have found the above.

It also asserted `REPORT_KEYS.length === 9`. Sprint 13.5 added seven and did not
update it — so the check was failing for a reason that had nothing to do with
the bug it was standing in front of, and the bug walked past it into a merge.

It now asserts sixteen and names the seven statements. **It needs a database, so
it is not in CI.** Run it after touching any runner. `check-dashboard` and
`check-portals` were run too, and both pass.

### What the run established

Two schools were seeded: one carrying three fee payments — cash, bank transfer,
cheque — recorded **before** `0027`, so the backfill was tested on data that
predated it; and one with the module on and no chart.

| | |
| --- | --- |
| The backfill | cash → `1000`, transfer → `1010`, **cheque → `1020` and not the bank**; each entry dated to the payment, not to the migration; all three payments linked |
| Idempotency | seed and backfill re-run — **0 rows** on all five statements |
| The book | debits = credits after every single operation |
| The poster | one paisa out refused; another school's account ids refused with the same sentence a mistyped id gets |
| Reversal | mirror written, original left standing and struck through, reversing twice refused, reversing a reversal refused |
| Per-staff cash | a payment landed in the clerk's drawer, **not** the office safe; with no drawer open it fell back to the office exactly as before this sprint |
| Settlement | 3,000 drawer settled at 2,500 — the 500 short named on screen *before* saving and still in the drawer after; over-settlement refused |
| Constraints | `ledger_entries_one_side_check` and `expenses_posting_check` both refuse what the code would not write |
| The statements | all seven ran, printed under `print` media, exported as CSV with `[reversed]` / `[reversal]` intact |
| The balance sheet | **16,800 = 16,800** |
| Permissions | an accountant: Cash Counters absent from the nav, direct URL bounced to `/dashboard`, `POST /settlements` **403** |
| Module gate | screen closed, nav section gone, dashboard tile back to naming what it needs |
| Empty state | one-click setup works; every screen then renders at zero |
| Browser | twelve routes, **no console errors and no failed requests** |

### The dashboard tile, in all three states

It has said "Needs the accounting ledger" since Sprint 10.5. All three states
were seen in a browser: a figure where the chart exists, "This school has no
chart of accounts yet." where it does not, and "Needs the Accounts & Finance
module." where the module is off. It renders an em-dash, never `PKR 0`.

### ⚠ What the browser run could NOT do, and what that costs

**Sign-in was stubbed.** Sign-in needs a Supabase project — GoTrue for the
session and PostgREST for middleware's Edge-side tenant lookup — and there is
none here. Three seams were stubbed locally: `getSchoolHeaders`,
`readSchoolSession`, and middleware's slug resolution and session-presence
check.

**The stubs were reverted and are not in the repository.** `git status` was
checked before committing and showed only the two real fixes.

What that costs: everything *behind* the session is genuinely verified.
**The sign-in path and middleware's real tenant resolution are not.**

### Not a bug, but it will waste somebody's afternoon

`DEV_FALLBACK_LOCATION_ID` is documented at length in `.env.example` and **no
code reads it.** Anybody trying to run a tenant locally will set it, watch
nothing happen, and go looking for the fault in their own setup. Pre-existing,
unrelated to this sprint, and the reason the seams above had to be stubbed by
hand.


## 5aw. WhatsApp leaves the platform, and three faults it was sitting on top of — 2026-08-22

Four reports in one session. Three of them turned out to be the same shape: a
thing that had been true once, was documented as still being true, and was not.

---

### 1. WhatsApp is gone. Every invitation and every notification is email.

The instruction was unambiguous — *"REMOVE WHATSAPP INVITE AND NOTIFICATION FROM
EVERYWHERE. ALL THE INVITES WILL GO ON EMAIL ONLY"* — and it does not reverse a
decision so much as finish one this file has been circling since GHL became
opt-in. Sprint 11 already made the notice board and email the default delivery
path. WhatsApp survived as a paid per-school add-on behind
`school_modules.whatsapp`, and the survival was costing more than the feature
was worth: **every send path in the codebase carried a branch for it**, every
screen carried a sentence about it, and no school on the platform had it on.

**What was deleted, not disabled:**

| Gone | Was |
| --- | --- |
| `lib/channels.ts` | the per-school gate, `isWhatsAppEnabled` |
| `components/super-admin/ChannelToggleList.tsx` | the switch on the school page |
| `sendWhatsAppMessage` in `lib/ghl-client.ts` | the only thing that posted to GHL Conversations |
| `PLATFORM_CHANNELS`, `PlatformChannelKey`, `toChannelFlags`, `emptyChannelFlags` | the channel-vs-module distinction, whose only member was WhatsApp |
| `lib/ghl-fees.ts` | rewritten as `lib/fee-notices.ts`, email only, no GHL import left in it |
| the Channels card on the bulk-modules page, and its `whatsappWithoutGhl` warning | |

`lib/channels.ts` opened with a docblock arguing that a gate beats a deletion,
because *"commented-out or deleted code cannot be switched back on by a Super
Admin at three in the afternoon"*. That argument was right while WhatsApp was a
product the platform sold. It is exactly wrong now: **a flag left behind is a
flag somebody turns on, against sending code that no longer exists.** So the
flag went with the code.

**What deliberately survived:**

- **GoHighLevel itself.** It is an opt-in CRM integration and it still does
  contact sync and workflow triggers. What a school's own GHL workflow does
  with a contact is decided inside GHL and is not this platform's business.
  `triggerAdmissionWelcomeWorkflow` used to carry a long note explaining why it
  alone was not behind the WhatsApp switch; it now simply says it is a trigger
  and not a send.
- **`school_users.phone` and `student_guardians.phone`**, both still `NOT NULL`
  and unique. A guardian's number is still an identity key — `lib/siblings.ts`
  unions on it — it is just no longer a *channel*. Every docblock claiming
  otherwise was corrected rather than deleted.
- **`announcement_recipients` rows with `channel = 'whatsapp'`.** Re-labelled to
  `'notice'` by `0028`, never deleted. A school answering *"did you tell us
  about the closure"* in March needs the October row whatever carried it. The
  unique index is `(announcement_id, school_user_id, channel)`, so a recipient
  holding both a `notice` row and a `whatsapp` row would have collided on the
  rewrite — those are deleted first, and the `notice` row, the one that was
  actually read, survives.

---

### 2. The invite form could not accept a landline. Nor anything else it produced.

Reported as *"I was getting invalid mobile number error"*, with a screenshot of
`(021) 444444` rejected under **"Enter a valid phone number."**

`POST /api/school/invitations` validated with a hand-rolled regex:

```ts
/^\+?[0-9\s-]{7,20}$/
```

There are no brackets in that character class. **Every number the application's
own form produces has brackets in it** — `components/ui/PhoneField.tsx` masks as
you type and writes `(021) 444444` — so the server refused the client's own
output, and there was no string an operator could type that both the mask would
produce and the regex would accept. The only reason any invitation had ever been
sent is that a mobile typed as `(0321) 123-4567` fails the same way, which
means **this route had been refusing every invitation with a formatted number**.

`PhoneField`'s own docblock had already written the rule this broke: *"the forms
import them in the browser and the API routes import them on the server, and the
two must agree exactly or the client accepts what the server refuses."* The
route now imports the same module — `normalisePhoneOfAnyKind` then
`hasCompletePhoneOfAnyKind`, both added to `lib/phone-formats.ts`, both
accepting either mask and normalising to display form so an API client that
never saw the mask can still post `0213456789`.

**The second half of the bug was upstream of that.** The form passed `identity`
to `PhoneField`, which refuses a landline outright with *"This number identifies
the person on the platform, so it has to be a mobile — invitations and sign-in
codes are sent to it."* Neither clause is true any more: the account is keyed by
the email address, and nothing is sent to this number at all. A school office
whose only number for a new bursar is the desk landline could not complete the
form. `identity` is gone from that field, and the hint now says what the number
is for — the school's own records.

> The phone is still required, because `school_users.phone` is `NOT NULL` and
> unique per school. That is a schema fact, not a channel: the column predates
> Supabase Auth and 60-odd rows depend on it. It stays unique per tenant because
> two staff sharing a number is still a data-entry mistake worth catching.

---

### 3. The dashboard was down because a migration had never been run — and one tile took the page with it

Reported as a screenshot: the school-admin nav rendered, the school name and the
signed-in user rendered, and the content area said **"Could not load the
dashboard"** with a digest.

Reproduced in twenty minutes by running the page's six reads against the live
database directly. Five returned. The sixth:

```
Failed query: select count(*)::int from "ledger_transactions"
              where "ledger_transactions"."location_id" = $1
```

`ledger_transactions` is created by `0027`, which had never been applied. The
banner at the top of this file said so in as many words and had said so since
2026-08-21 — what nobody had connected is that **the accounting tile is not
optional in the sense that matters.** `Promise.all` rejects on the first
rejection, so one missing table for one tile took the students count, the staff
count, three charts and every quick action down with it.

**Two fixes, and both were needed.**

`0027` is now applied (see the banner). That is the root cause and it is gone.

But `app/(school-admin)/dashboard/page.tsx` now also wraps each of the six
optional reads in `optional(label, locationId, read)` — a catch that logs with
the location id and returns `null`, so the tile falls back to `StatTile`'s
`unavailable` state and the other five still render. **A dashboard is assembled
from six independent reads that have nothing to do with each other, and it
should degrade one tile at a time.**

What is deliberately *not* wrapped: `getDashboardCounts`, `getModuleFlags` and
`permissionsForRole`. If those fail there is no page — no counts, no idea which
modules are on, no idea what the caller may see — and an empty frame would say
*"your school has nothing in it"*, which is worse than an error.

And the fallback is `unavailable`, never a zero. A zero here is
indistinguishable from a real zero, and is how a school comes to believe it
collected nothing today.

---

### 4. "Unexpected response." — the error that named nothing

Reported as a screenshot of the Super Admin sign-in with a plain
**"Unexpected response."** under the password box.

That string comes from one place in each client helper: the `catch` around
`response.json()`. It fires when the response is **not the JSON envelope at
all** — which, since every route in this application answers `{ ok, data |
error }`, means the request never reached a route. A 502 from the host while the
Node process restarts, a 504 on a slow first request, and a genuine crash all
presented identically, and the one difference that matters — *wait and try
again* versus *something is broken* — was the one it hid.

> **The live endpoint was not reproducibly broken.** Probed on 2026-08-22 with a
> deliberately wrong address: `POST /api/super-admin/auth/login` answered **401
> JSON**, `"Incorrect email or password."`, and the sign-in page rendered it
> correctly. Whatever produced the screenshot was transient — almost certainly
> the process restarting under it. Which is the point: **it should have said
> so.**

Two changes, so that the next occurrence diagnoses itself:

- `app/api/super-admin/auth/login/route.ts` had **no `try`/`catch` at all** —
  alone on this surface. Any throw in it (`signSuperAdminJWT`, the cookie write,
  a module-load failure) produced Next's HTML 500. It now returns the envelope
  through `handleApiError` like every other route.
- `lib/school-client.ts` and `lib/super-admin-client.ts` now report the status:
  502/503/504 become *"The server is not responding (502). It may be restarting
  — try again in a moment."*, a status of 0 becomes *"The server could not be
  reached."*, and anything else names the code and says nothing was changed.

---

---

### QA, and the five things it found

A QA agent audited the tree end to end against a running server and the real
database: all 14 gates re-run independently, **all 152 routes swept
unauthenticated across GET and POST — 304 requests, zero HTML error pages and
zero 500s**, tenancy grepped for a `locationId` read from any request (there is
none), and the migrations verified by querying `pg_constraint` directly.

It sent the work back, and it was right to. Two of the five were **my own
misses in this sprint's own subject matter**:

1. **`/apply/success` printed a phone number and said "by email" in one
   sentence** — *"will contact Ahmed Raza at (0321) 123-4567 by email"*. I had
   fixed the trailing clause and left the fragment before it. The number came
   through the query string on every real submission, so it was wrong every
   time, on the last screen a prospective parent sees. **Fixed by dropping the
   fragment and no longer putting the number in the URL at all** — it landed in
   browser history and in any referrer the page emitted, for no benefit.
2. **`ApplyForm`'s phone hint still read "We will contact you on this
   number"** — one field below the paragraph I had just changed to say email.
   Now: *"Used to find your application if you come back. We reply by email."*
   The field keeps `identity`, and for a reason that survives WhatsApp:
   `/api/admissions/check` looks an existing application up by the normalised
   number, so it has to be one that canonicalises.

The other three were pre-existing, and two of them were the new code not
following its own docblock:

3. **Two dashboard reads deleted their tile instead of showing `unavailable`.**
   `optional()`'s docblock states the rule; "Outstanding this month" and the
   fee-collection card did not follow it, so a failed read produced a dashboard
   that looked complete and was missing a number. Both now say so, and the two
   chart cards render a `ChartUnavailable` stand-in rather than vanishing —
   a missing card is indistinguishable from a module the school has not bought.
4. **The new phone check accepted `1234`**, stored as `(123) 4`.
   `hasCompleteLandlineDigits` required only `digits.length > 3`, where the
   regex it replaced required seven characters — so the fix had quietly
   loosened the floor on a column that is `NOT NULL` and unique per school.
   `LANDLINE_MIN_SUBSCRIBER_DIGITS = 4` restores it. **Six new assertions in
   `check-address-phone` now pin both the reported bug and this floor** (40, up
   from 32).
5. **Three routes still sent SMTP synchronously inside the request** — the
   public apply form, the application decision, and the invite setup code —
   while `lib/ghl-admissions.ts` asserted the opposite as current behaviour.
   `lib/email-sender.ts` allows 15s to connect, 15s to greet and 20s on the
   socket, so a slow host sat in front of a parent pressing "Submit
   application". The first two are now queued through `email_outbox`. **The
   third is deliberately still blocking and now says why**: somebody is
   waiting for that code, and queueing would trade a bounded ~20s for an
   unbounded-to-30s drain *and* discard the failure signal.

> **What QA could not do, and it is the same gap as last time:** everything
> behind a sign-in. It does not enter passwords either. The dashboard change,
> the invite form end to end, the modules page with its Channels section
> removed and `PendingInvitesTable` are all still unclicked.

### What this is worth knowing for

Three of the four faults were **documentation that had outlived its subject**.
The regex, the `identity` flag and the WhatsApp branches were all written when
the phone number *was* the identity and WhatsApp *was* the channel, and each one
was carrying a comment that confidently explained the world it was written in.
The comments are why nobody looked. A rule worth taking from it: when a
statement in a docblock is the reason not to check something, the docblock is
the thing to check.

---

## 5ax. The deploy was never blocked, and the probe that would have said so was gitignored — 2026-08-22

Reported as *"first lets resolve the Hostinger_SSH issue"*. There is no
Hostinger SSH issue. There has not been one since 2026-08-21, and the belief
that there was cost this session an hour and cost the previous one a wrong
statement to the user.

### What is actually true

hPanel shows this site **connected to GitHub with auto-deployment on**, branch
`main`, root directory `./`, framework Next.js, Node 22.x. The last deployment
reads: state **Completed**, commit **`17099d4`** — the WhatsApp-removal merge —
deployed **2026-08-22 16:52** in 2m29s. The live HTML opens with
`<!--17099d4dec24-->`, because `generateBuildId` makes the build id the commit
sha. **It had been live for hours before anybody looked.**

`.github/workflows/deploy.yml` was renamed *Verify the live deployment* by #24
and no longer deploys anything; the rsync-over-SSH steps were deleted with it.
The five `HOSTINGER_SSH_*` / `HOSTINGER_HOST` / `HOSTINGER_PORT` /
`HOSTINGER_PATH` / `HOSTINGER_USERNAME` secrets survive in the repository and
are read by nothing. The three the workflow does read are all set. The only
genuinely missing secrets are `SMOKE_SUPER_ADMIN_EMAIL` and
`SMOKE_SUPER_ADMIN_PASSWORD`, used by one step.

> **Why this file was wrong.** The banner was written on 2026-08-20, when it was
> accurate: the workflow *was* SSH-based and the secrets *were* absent. #24
> replaced the mechanism the next day and nothing updated the banner, so a
> statement that had been carefully verified became a statement that was
> confidently false — and it read exactly as authoritative either way. This is
> the same failure §5aw is about, one level up: **documentation that outlived
> its subject, believed because it was specific.**

### The real bug, found while disproving the false one

`GET /api/internal/build` — the route the verification workflow exists to
read — **404s on production**, on a build that is otherwise correct.

`.gitignore` line 13:

```
# production
build/
dist/
```

A bare directory pattern in gitignore matches **at any depth**. So `build/`
also matched `app/api/internal/build/`, which is an App Router segment and not
build output. The route was written on 2026-08-21 and **has never been
committed**. It existed on the machine that wrote it — `npm run build` compiled
it, every local check passed — and it did not exist in the repository, so
Hostinger, which builds from GitHub, never received it.

The consequence is the whole point of the workflow: **its "Confirm which commit
is live" step could never have passed on any deploy**, and the error it printed
on failure blamed the deployment rather than the missing file:

> *"/api/internal/build did not answer. The running build predates that route,
> so Hostinger has not deployed a commit from 2026-08-21 or later."*

That message is what a stale deploy looks like. It is also what a file that was
never committed looks like, and nothing distinguished them.

Both patterns are anchored to the repository root now — `/build/`, `/dist/` —
which is the only place either tool writes.

### The gate, and why CI structurally could not be it

An ignored file is **absent from a fresh checkout**, so CI cannot notice what
it never received. Every gate ran green against a tree that was missing a route
and had no way to know. The mistake is made on a developer's machine and can
only be caught there.

`npm run check-loaders` now walks every `route.ts` / `page.tsx` / `layout.tsx`
on disk and asks `git ls-files --error-unmatch` whether it is tracked. 237
assertions, up from 236. In CI everything present is tracked, so it costs one
process and passes; locally it fails and names the file and the command that
explains it. **Verified by planting a route in an ignored directory** — it
fails, and prints `git check-ignore -v <path>`.

> Only one file in the repository was affected. `git status --ignored` across
> the whole tree, minus the legitimate entries, returns exactly
> `app/api/internal/build/`.

---

## 5ay. Sprint 14 — exam terms, datesheets, descriptors and promotion — 2026-08-22

Built to `SPRINT-14-SPEC.md`, which was agreed with the product owner over three
rounds of questions. Migrations **`0029_sprint14_exam_terms_promotion.sql`** and
**`0030_schedule_marks_pairing.sql`** are **both APPLIED to the live database**
— bookkeeping 29 → 30 → 31, each verified against the real schema afterwards.
**Next free migration number is `0031`.**

Phases 1 and 2 (schema, migration, the rule layer) landed in `3e182ea`. Phases
3, 4 and 5 — the API, the admin screens and the portals — are `7953f99`,
`8d41d1c` and `341527f`.

**Then QA found fifteen defects, seven of them P1, and all fifteen are fixed** —
`892927c`, `8c2674e`, `c74c747`, `82f9262`, `5572da0`, `7a57c2f`, `b755a78`. Read
`release-notes/RELEASE-NOTES-SPRINT-14.md` §"What QA found" before touching this
module; `test-cases/TEST-CASES-SPRINT-14.md` marks the eleven cases that were
defects with 🔁, and those are the ones to re-run first.

Three of them are worth carrying forward as rules, because each is a *class* of
mistake this codebase can make again:

1. **A soft-delete column is only as good as its readers.** `archived_at` was
   written by three paths and read by four readers out of twelve, so "Delete"
   left a term's exams live *and writable* — a teacher could still save marks
   against a term the school had deleted. When you add an `archived_at`, grep
   every reader of that table in the same commit.
2. **A CHECK constraint is read in two-valued logic and evaluated in three.**
   `(a IS NULL AND b IS NULL) OR (a > 0 AND b >= 0 AND b <= a)` evaluates to
   NULL — not FALSE — when `a` is set and `b` is null, and Postgres passes a
   CHECK unless it is FALSE. The constraint permitted exactly the state it
   forbade. Use `num_nonnulls` for pairing rules. No review would have caught
   this; a 34-assertion suite run against the real schema caught it on the first
   run, and that suite is the thing to keep.
3. **Two figures for one fact will diverge, and only under conditions nobody
   tests.** The report card printed total-over-total while the history table and
   the promotion engine used the arithmetic mean. They are the same number when
   every paper is out of 100, which is why it survived review — and different the
   moment a school runs a 20-mark Art paper. A parent saw 48.3% · C on the
   document they keep and 65.0% · B three inches below it.

4. **Some defects exist only under one data shape, and you have to seed it.**
   Two of the fifteen lived exclusively where papers carry unequal maxima —
   Mathematics out of 100 beside Art out of 20. With every paper out of 100 the
   mean and the ratio are the same number, so a static read, a green build and a
   34-assertion database suite all passed over them. Rendering one real report
   card from a class seeded that way found both in a minute. **When a sprint
   introduces a second way of computing something, seed the case where the two
   answers differ, and look at the output.**

Also worth noting for the next sprint's planning: **the green build passed at
every point while all fifteen were present.** Nine gates, 251 loader
assertions, clean typecheck, clean lint. They prove the code compiles and obeys
the house rules; they say nothing about whether a report card prints the number
the decision was made on.

### What a term is now

A term stopped being a name and two dates. It is the thing a report card is
issued for, and the *dates moved down* onto `exam_schedules`, because they
differ per grade: an infant class finishes its First Term in three mornings and
the senior school takes a fortnight, and both are "First Term". A school keeps
as many datesheets per term as it has groups of classes sitting different
papers.

`exam_terms.start_date` and `end_date` are therefore nullable. Where they are
blank, `listExamTerms` reports `windowStart`/`windowEnd` derived from the term's
schedules, falling back to the academic year — so nothing downstream, including
the attendance summary on a report card, ever has to invent a date.

### The two mechanisms, and that they are alternatives

`grade_promotion_criteria.mechanism` is `marks_grades` or `descriptors`, per
grade, per year. **A descriptor class has no marks, no percentages and no letter
grades anywhere** — not on the marks sheet, not on screen, not on the printed
card — and a marks class has no sub-category column at all. Two sheets, not one
sheet with columns hidden. This was settled explicitly; the example in the
original brief showing marks, grades and a sub-category on one row is *not* the
target.

Decisions not to re-litigate:

- **A grade with no criteria row is not misconfigured.** It falls back to
  `DEFAULT_CRITERIA` — marks and grades, no thresholds — which is exactly how
  the product behaved before the table existed. A school that never opens the
  criteria screen sees no change at all.
- **A null threshold is not applied, not treated as zero.** A class with every
  field blank promotes everybody. The failure being avoided is a school pressing
  "recompute" and finding forty children held back by a default nobody chose.
- **`student_term_results.mechanism` is frozen at compute time.** A school that
  moves Grade 3 from descriptors to marks next year must not have last year's
  cards re-render as a marks sheet with every column empty.
- **One datesheet cannot carry two mechanisms.** The authoring routes refuse a
  schedule whose classes are judged differently, naming both — because the fix
  is on the criteria screen and not on that one, and because generate would
  otherwise have to write a marks paper and a descriptor paper from one row.
- **Descriptor papers store `max_marks = 1`, `passing_marks = 0`** and are never
  read. `exam_subjects.max_marks` is `NOT NULL` with a `> 0` CHECK that the
  marks path depends on, and this sprint deliberately does not relax it.

### Promotion is an academic judgement, not enrolment plumbing

`promotion_runs` / `promotion_decisions` (Sprint 10) answers *which section is
this child in next September*. `student_term_results.final_status` answers *did
this child pass*. **They are different facts and this sprint does not merge
them.** A school can promote a child who failed, and does.

`computed_status` and `final_status` are both stored. Storing only the second
would leave nobody able to answer "was this an override?" a year later; storing
only the first would make the override screen a lie.

**The override reason is a first-class output, not an audit note.** The product
owner: *"that change comment must be visible to all the relevant authorities on
their portals including parents."* It prints on the report card and shows on the
parent and student portals. Required at 10+ characters whenever `final_status`
differs from `computed_status`; setting the status back to equal clears the
reason, who set it and when — all three, because half an override left behind is
a comment on a parent's portal explaining a decision that was reversed.

`computeSectionTermResults` **keeps an existing override** while it is still a
departure from what the rules say, and drops it when the recomputation now
agrees with it. A head who decided in March must not be reversed by a clerk
pressing recompute in April.

### Who may decide a promotion

A holder of `results.promotion`, **or** the staff member named on
`sections.class_teacher_id` — checked per section. Nobody else, including a
subject teacher timetabled to the class.

`results.promotion` is granted to `school_admin`, `branch_admin` and `principal`
and **deliberately not to `teacher`**. A role key would hand every teacher in
the school every class in it. A class teacher's authority comes from being named
on the class, which is a per-section fact, which is why it is a per-section
check.

`staff.is_class_teacher` is one radio on the staff form — *Class Teacher (Home
Room)* or *None*, confirmed as one option, not two — and it only decides who
appears in a class's picker. Clearing it does not unseat somebody from a class
they already hold: that is a separate decision made on the class, and emptying
it silently would move a promotion screen out from under the person using it.

### Colour coding is read at render time and never stored

`school_exam_settings.color_coding_enabled` decides whether a descriptor is
painted. No row anywhere carries a copy of the styling, so switching it off is
retroactive across every sheet the school has ever issued, including reprints of
old ones. `components/exams/SubcategoryBadge.tsx` is the **one** implementation;
two would mean the switch is honoured on three screens out of five. Colour off
renders the plain label with no chip — not a grey pill, which would still be a
decoration a school asked not to have.

A missing `school_exam_settings` row is the ordinary case and means the defaults.
`getExamSettings` never joins and never assumes.

`teachers_can_view_legacy_results` defaults to **false**. When it is off the
History link on the teacher's promotion screen is **absent**, not disabled with
a tooltip.

### Sub-categories archive, they do not delete

`DELETE /api/school/result-subcategories/[id]` **refuses with a 409** when the
descriptor has been awarded, naming the count — "used on 412 subject results and
38 term results" is a decision a head can make; "this is in use" is not — and
the screen offers Archive, which hides it from every picker and leaves every
historical sheet rendering exactly as it was issued. An unused one is archived
rather than deleted, so there is one code path.

### Generate is idempotent, and never deletes a paper carrying marks

`POST /api/school/exam-schedules/[scheduleId]/generate` writes one `exams` row
per active section of every assigned grade and one `exam_subjects` row per
datesheet row. Re-running updates the papers that already came from this
schedule and creates only what is missing — schools press this again, after
adding a section in week two and after moving the Maths paper.

A subject dropped from the datesheet has its paper **archived**, and the response
reports how many of the archived papers carried marks, because the person who
dropped the subject is the only one who can decide whether that was intended.
Papers a clerk added by hand carry no `schedule_subject_id` and are left alone.

The schedule edit **reconciles rather than replaces**: a subject that stays keeps
its `exam_schedule_subjects` row and is updated in place. Archiving everything
and inserting fresh rows would break the `schedule_subject_id` link on every
subject nobody touched, and the next generate would create a second Maths paper
beside the one already carrying a morning's marking.

### Archiving a schedule must archive its grade rows

`exam_schedule_grades_term_grade_idx` is what makes "a class sits one datesheet
per term" a database guarantee rather than a check two concurrent requests both
pass. A live grade row under an archived schedule locks that class out of every
future schedule in the term **by an index nobody can see**, with an error naming
a schedule that appears on no screen. Both the term DELETE and the schedule
DELETE move the whole tree in one transaction.

### Files

- API: `app/api/school/exam-terms/reorder/`, `exam-terms/[termId]/schedules/`,
  `exam-schedules/[scheduleId]/` and `/generate/`, `result-subcategories/`
  (+ `[id]`, `reorder`), `exam-settings/`, `promotion-criteria/`,
  `terms/[termId]/sections/[sectionId]/results/`; and `exam-subjects/
  [examSubjectId]/results/` now carries `subcategoryId` and `remarks`.
- `lib/exam-schedule-input.ts` — one parse and one set of school-facing checks,
  shared by the two routes that author a datesheet.
- Admin: `dashboard/exams/terms`, `terms/[termId]`, `settings`, `criteria`, each
  with its `loading.tsx`. `TermManager` moved off the Exams overview onto its own
  screen.
- Teacher: `teacher/exams`, `teacher/promotions`; `MarksEntry` gained the
  descriptor sheet and a per-student comment in both modes.
- Portals: `ResultHistory` (shared by parent, student and the teacher's gated
  legacy view), `ReportCardSummary` and `ReportCardDocument` both render either
  mechanism plus the promotion status and its reason.

### Still open

- **Migration 0029 is unapplied.** Nothing in this sprint works against the live
  database until `sprint-devops` runs it, and the four seeded sub-categories for
  existing schools arrive with it.
- The criteria screen reads its year from `?academicYearId=`. The page was
  already dynamic — it reads grades, criteria and descriptors on every
  request — so the parameter costs nothing there; CLAUDE.md's rule is about not
  making a *prerendered* page dynamic.
- Re-sit handling in descriptor mode is out of scope by decision: a descriptor
  is not re-sat. The attempt toggle simply does not appear.
- Nothing has been exercised against real data. Every gate is green and no
  schedule has ever been generated at a school.

---

## 5az. The school creation wizard, the 429 that was recorded as a refusal, and the dropdown the card was eating — 2026-08-23

Three things that had nothing in common except that each one was invisible to
every gate this repository runs. Migration **`0031_subdomain_throttled_status.sql`**
is **written and NOT applied** — it widens one CHECK constraint and nothing
else. Next free migration number is `0032`.

### 1. Creating a school is one flow now, not one form and four tabs

`/super-admin/schools/new` was a single `SchoolForm`. Everything else a new
school needs — its first campus, its branding, its modules, its integrations —
lived on four tabs under `/super-admin/schools/[schoolId]/…` that nothing
pointed at and nothing said existed. The predictable outcome, and the one on the
live deployment, is a school with no branch on it.

`components/super-admin/SchoolWizard.tsx` is the five steps: School, Branch,
Branding, Modules, Integrations.

**The panels are the ones the tabs already render.** `BrandingManager`,
`ModuleToggleGrid`, `IntegrationsPanel` and `BranchForm` are imported into the
wizard exactly as the tab pages import them, and the tab pages are untouched.
Nothing was copied, because a wizard with its own branding panel is a second
place for the palette rules to live and the two would have diverged the first
time either was edited. The tabs remain where a school is *edited*; the wizard
is for the first ten minutes of its life.

**Do not add a Back button to steps 1 or 2.** They POST — a school and a branch
respectively — and a Back onto either is a control that offers to create a
second one. The stepper marks them done and closes them, and only steps 3–5,
which change settings on records that already exist and are idempotent, move in
both directions. This is also why step 1 saves immediately: a wizard abandoned
after it leaves a **valid school**, finishable later from its own tabs, rather
than a half-written draft the platform would have to model.

**Three of the five may be skipped, and the sentence under each says why.**
Branding, modules and integrations all have workable defaults — the platform
palette, the default module set, and no third-party account at all, which is the
normal state of a school and not an unfinished one. A school with no campus does
not run, so steps 1 and 2 have no skip. A skipped step is recorded as skipped in
the stepper rather than silently marked done.

### The field order on both forms is the product owner's, and it is not cosmetic

School: head office name, street address, city, owner/administrator, landline,
mobile, admin email, subdomain, school code. Branch: main branch, branch name,
street address, city, branch code, landline, mobile, email, curriculum, classes.

Two orderings changed for a stated reason and should not be reverted to
"consistency with the other form":

* **City no longer leads the school form.** It led because it leads the *branch*
  form, where choosing a city proposes the branch code. On the school form it
  proposes nothing, so it was asking an operator to answer a question about a
  school they had not yet named.
* **City still sits immediately before the branch code**, for exactly that
  reason. A proposal that arrives after the operator has typed over the field is
  worse than no proposal.

Both forms are labelled by what the field *is* — "School Owner / School
Administrator", not "Principal name". Only labels moved; no column, no payload
key and no API contract changed.

**There is no principal field on the branch form and none is to be added.**
Principals are assigned per campus in School Admin → Settings, where
`components/school/PrincipalAssignments.tsx` already handles both the single-
and multiple-principal models. A second place to type a principal's name is a
second answer to the same question. No `branches.principal_name` column exists
and none is needed.

### 2. A rate limit had been recorded as a permanent failure

The live deployment's only school read:

    subdomain_status = 'failed'
    subdomain_error  = 'Hostinger refused the request (HTTP 429). {
                         "message": "Too Many Attempts.",
                         "correlation_id": "a28cff8a-…" }'

Nothing about that request was wrong. Three defects, all in `lib/hostinger.ts`:

**(a) 429 fell through to `failed`.** Every non-ok status did. `throttled` is
now its own `ProvisionStatus` and its own `SubdomainStatus` — a *warning* badge
reading "Rate limited", retryable, with a hint saying the host is throttling and
to try again in a minute. Migration `0031` widens the CHECK to admit it.
`isProvisionSetback()` is what both writing routes ask, so a status added to one
and forgotten in the other cannot silently drop the recorded message.

**(b) `request()` discarded the response headers, `Retry-After` included.** It
now returns them and retries — at most twice, only on 429 and 5xx, honouring
`Retry-After` when present, against a **per-provision budget of 5 seconds**. A
wait longer than what is left of the budget is not slept through: the attempt is
abandoned and the row is marked `throttled`, because this code runs inside a
super-admin's create request and an operator must not be held on a form while a
limiter cools off. A 4xx that is not 429 is never retried, and neither is a
network error — that is the one case where the request may already have
succeeded at the far end.

**(c) The raw JSON body was being pasted into the table cell.** That is the red
braces-and-UUID text in the operator's screenshot. `summariseResponseBody()`
lifts `message`/`detail`/`error` out of a JSON body into one sentence and keeps
the correlation id behind it as `(ref …)` — support needs it, an operator does
not need it first. A body that is not JSON still falls back to truncation.

**And a provision now makes three API calls instead of four**, which is what
tripped the limiter in the first place. `ensureParkedDomain` used to list the
aliases and then create; it creates first and lists only to disprove a refusal
it does not recognise. `resolveDnsZone` probes the zone with a GET and now hands
that response body back, so `ensureDnsRecord` no longer re-reads the same zone
milliseconds later.

`npm run check-provisioning` grew 27 assertions covering all of it — the JSON
lift, the correlation id's position, `Retry-After` in both its legal forms,
which statuses are retryable, and that `throttled` is warning-coloured and
`failed` is not.

### 3. The Mapbox dropdown was being clipped by the card it sat in

`Card` sets `overflow-hidden`; `AddressAutocomplete` rendered its listbox as an
`absolute` child. An address field sits near the bottom of nearly every card in
this product, so the common case was a suggestion sliced in half at the card
border.

The listbox is now **portalled to `document.body`** with fixed coordinates taken
from the control's bounding rect. `overflow-hidden` stays on `Card` — it is what
clips table corners to the card radius, and no z-index can defeat it anyway,
which is the whole reason a portal was the only fix.

What the portal cost, and what pays it back:

* it repositions on `scroll` **in the capture phase** — a scroll inside a modal
  body or any other scrolling ancestor does not bubble to `window` — and on
  `resize`;
* it flips above the field when there is not room below, and matches the
  control's width;
* `aria-controls` and `aria-activedescendant` still name the list and the
  option, and `aria-owns` was added because the list is no longer a DOM
  descendant of the combobox;
* **the blur handling had to change.** It closed the list on a timeout, on the
  assumption that a click on an option was a click on a sibling. It now asks
  whether focus moved *into* the list, and a document-level `pointerdown` closes
  it when the press lands outside both. Neither is timing-dependent, which the
  old one was.

It renders at `z-modal`, not `z-dropdown`: portalled to `<body>` it is a sibling
of any dialog rather than a descendant, so at dropdown level it would sit behind
a modal that owns the field it belongs to.

### Files

- `components/super-admin/SchoolWizard.tsx` (new), and
  `app/(super-admin)/super-admin/schools/new/page.tsx` now renders it.
- `components/super-admin/SchoolForm.tsx`, `BranchForm.tsx` — reordered,
  relabelled, and each given `onCreated`/`onSaved`, `submitLabel` and
  `hideCancel` so the wizard and the standalone screens are the same component.
- `lib/hostinger.ts`, `lib/subdomain-status.ts`, `db/schema/schools.ts`,
  `db/migrations/0031_subdomain_throttled_status.sql`, and the two routes that
  write `subdomain_status`.
- `components/ui/AddressAutocomplete.tsx`, `scripts/check-provisioning.ts`.

### Still open

- **Migration `0031` is unapplied.** Until `sprint-devops` runs it, a provision
  that hits the limiter will try to write `throttled` and the CHECK will refuse
  it — the update throws inside the route's try/catch and the row keeps its
  previous status. Expand-only and safe to apply against the running build.
- **The recorded message still renders in `text-status-danger-ink` on the
  schools list**, so a throttled row shows an amber badge above red text.
  `components/super-admin/SchoolTable.tsx` was owned by another change in this
  session and was left alone; colouring that line by the badge's variant is a
  two-line fix for whoever is next in that file.
- The school already sitting at `failed` with a 429 recorded against it is left
  as it is. Nothing here can know which historical failures were really rate
  limits; pressing Provision on that row is what corrects it.
- Nothing in any of the three has been exercised against a browser or the live
  host. The wizard's step transitions, the flipped dropdown and the retry path
  are all reasoned and none is measured.

---

## 5ba. Sprint 15 §4 — dashboards on all five portals — 2026-08-23

Built to `SPRINT-15-DASHBOARDS.md`. **No migration.** Every number on all five
screens is derivable from the current schema, which is what the spec said and
what turned out to be true; nothing here took a migration number and `0031` is
somebody else's.

### The rule the whole sprint is built on

**A tile that cannot be computed says so. It never renders a zero.** `PKR 0` on
a school that collected three lakh this morning is confidently wrong and
*unfalsifiable by the reader* — they have no way to tell it from a real zero.

The enforcement is `settle()`, now exported from `lib/dashboard-queries.ts` and
used by all five pages. It was `optional()`, private to the school-admin page,
written after the 2026-08-22 outage in which one missing table (`0027`'s
`ledger_transactions`) took an entire dashboard down through a `Promise.all`.
Sprint 15 put the same nine-read assembly on four more portals, so the helper
that survived that outage had to move somewhere all five could reach.

**Do not re-litigate:** the reads that decide whether there is a page at all —
the caller's profile, the module flags, the permission list, the active year —
are deliberately *not* wrapped. An empty frame says "your school has nothing in
it", which is worse than an error.

### What each portal now shows

| Portal | Tiles | Panels |
| --- | --- | --- |
| Super Admin | Active schools, **Tenants needing attention**, Students, Email delivery — all four with a 30-day comparison or a stated state | Tenant growth (line), provisioning state (donut), students by school (bar), schools by city (bar), **the needs-attention table**, recent schools demoted below it |
| School Admin | Collected this month, Outstanding, Attendance today, Enrolled students, Net this month — **every one carries a benchmark** | Exceptions strip, collections (line), fee status (donut), ageing (bar), admissions funnel (bar), attendance (line), attendance by class worst-first (bar), class strength (bar), recent exam outcomes (bar) |
| Teacher | Periods today, Registers not taken, Marks outstanding | "Needs you", today's timetable with the current period marked, my classes, announcements |
| Parent | Children, Total outstanding, Lowest attendance | **One card per child** — attendance + sparkline, fees due, latest published result, next exam — then announcements |
| Student | Attendance this month, Next exam, Latest result, Fee balance | Today's timetable, results across terms (line), announcements |

### The five aggregates that already existed and were on no screen

`getFeeStatusSplit`, `getAgingBuckets`, `getAttendanceByClass`,
`getAdmissionsFunnel` and `getRecentExamOutcomes` were written, covered by
`npm run check-dashboard`, and rendered nowhere. All five are now on the
school-admin dashboard. That was the cheapest half of this sprint and it is
worth remembering the shape of it: **a green check script is not a shipped
feature.**

### BR4 — how principal scoping is applied

`resolveDashboardScope` in `lib/school-dashboard.ts` turns a `PrincipalScope`
into **one list of grade ids**, and every aggregate takes it as an optional
`AggregateScope`.

**Why grades and not both axes:** that is already how the product narrows a
head. `listStudents` filters campuses through `grades.branch_id`, so a branch
reaches its data through its grades and nothing is lost by collapsing them.
What is gained is that "is this query scoped" is answerable by reading one line
of it.

**Why sub-selects and not joins:** a scoped aggregate adds one condition —
`inArray(feeChallans.studentProfileId, studentsInScope(…))` — and keeps the
exact query shape it has unscoped. That is what makes the unscoped path
*provably* unchanged for every school administrator and every school on
`principal_model = 'single'`.

**The dangerous bug here is the inverse one.** Treating "no assignment" as "no
filter" hands a head the whole school's finances and the screen looks entirely
normal. `resolveDashboardScope` returns `[]` for an unassigned head, every
aggregate short-circuits on it, and `check-dashboard` asserts all three branches
with no database at all.

**The quick actions are gated on permissions, never on the role name.** A
principal holds none of `settings.write`, `permissions.manage` or
`principals.manage`, so those three actions disappear without this file knowing
what a principal is. `role === 'school_admin'` would have been a second list to
keep in step with the one the routes already enforce.

**The Net-this-month tile is `unavailable` for a scoped principal, with a
reason.** The ledger is kept for the whole school and has no grade on it, so
there is no honest scoped figure. Showing the school's net under a heading that
says "yours" would be a BR4 breach that reads as a feature.

### Decisions not to re-litigate

1. **Attendance-by-class is a 30-day window, not today.** The spec's table says
   "today"; a one-day version is empty at 08:00 and noise at 09:30, and the
   existing check-covered aggregate is 30 days. The panel exists to find the
   class that needs a phone call, and 30 days is the window that answers that.
2. **"Marks not entered past their deadline" is the exam date.** `exam_subjects`
   has no deadline column and this sprint adds no migration. A paper sat last
   Tuesday and still `draft` is late by anybody's reckoning. One line to change
   when a deadline column arrives — `papersAwaitingMarks`.
3. **The Super Admin attention tile links to the table below it, not to a
   filtered schools list.** `/super-admin/schools` has no status filter and
   adding one belongs to whoever owns that route. The table *is* the filtered
   list and it carries the reasons, which an index would not.
4. **`throttled` does not exist.** The spec names it as a subdomain status;
   `lib/subdomain-status.ts` has five values and that is not one of them. The
   tile counts `failed`, `pending` and `unmanaged`, plus no-branch and
   no-administrator. **No status was invented.**
5. **`provisioning` is not an exception.** It resolves itself in minutes, and a
   tile that went red for it would be red most of the day an operator onboards
   four schools.
6. **The parent dashboard dropped `?child=`.** It selected among children the
   page already had in hand, and a parent of three answered "is everyone fine"
   by loading the page three times — anything wrong with the two they did not
   click never appeared. Cards stack now.
7. **Dashboards preview notices; they do not mark them read.** `NoticeBoard`
   mounts `MarkNoticesRead`, which is right on the announcements screen and
   wrong on a screen landed on six times a day. `DashboardNotices` is a preview
   with a link, and the link is where the reading happens.
8. **`fillClasses` on `BarSeries` marks individual bars, and colour is never the
   only carrier.** The chart summary names every class it has marked and the
   hidden data table carries every figure.

### What the check scripts now cover

`npm run check-dashboard` went from 11 aggregates to **41**, and that is the
number that matters: **every aggregate is registered twice, unscoped and
scoped**, because the scoped path is *different SQL* that the unscoped path
never issues. It also runs the nine Super Admin reads, both exception passes,
and asserts the three scope short-circuits with no database.

`npm run check-portals` went from 14 queries to **22** — the three teacher
reads, the two family reads, the student day, and `weekdayIndex`/`monthToDate`
asserted purely. `MIDWEEK` is a fixed Wednesday on purpose: the timetable reads
short-circuit at the weekend, so two runs in seven would otherwise have passed
without executing them.

**`sectionsMarkedOn` and `sectionRegisterFacts` were lifted out of
`getTeacherClasses`/`getTeacherTasks` for exactly this reason.** They sat behind
an `if (sectionIds.length === 0) return`, which is necessary and which fired on
every run of a script that reads a school belonging to nobody — so those two
joins were the queries the script never executed. Exported, they can be handed a
section id and made to run.

### Still open

- **Nothing has been seen against real data.** Every gate is green and the check
  scripts read a tenant that does not exist. No dashboard in this sprint has
  been rendered for a school with students, challans and a timetable in it.
- The exceptions strip's email row counts `email_outbox` rows carrying this
  school's `location_id`. Rows written before that column was populated are not
  attributed to anybody and will not appear.
- `getEnrolmentComparison` counts "at year start" from `enrollment_date`, not
  `created_at`, so a school that back-dates its existing roll reports correctly
  and one that does not will show its whole roll as new admissions.

---

## 6. Open items for the user

1. ~~Install GitHub CLI~~ — **CLOSED 2026-08-26.** `gh` **is** on PATH at
   `/c/Program Files/GitHub CLI/gh`. The 2026-08-08 note that it was not is
   stale and cost Sprint 16 a check. Opening a PR still needs the branch
   pushed, so a session told not to push cannot open one — that is a
   permission, not a missing tool.
2. ~~Do students and parents have email addresses?~~ — moot. The internal chat
   decision (§3.3) removes the dependency on either email or phone reach.
3. ~~Create the Supabase database~~ — done, see §5c.
4. **The domain name** — it fills `PLATFORM_BASE_DOMAIN`,
   `NEXT_PUBLIC_APP_DOMAIN`, `INVITE_LINK_BASE_URL`, `GHL_REDIRECT_URI`.
5. **Which school is the pilot?** Still unanswered, and still the highest-value
   thing outstanding — everything in `ROADMAP.md` is guesswork until one real
   school uses it.
6. ~~Start JazzCash / Easypaisa merchant onboarding~~ — **begun** (user,
   2026-08-12). Still externally paced.
7. **Open product questions** blocking POS, the wallet and chat — `ROADMAP.md`
   §7. Uniform size/colour variants is the one that cannot be retrofitted.
8. **Register the Apple Developer ($99/yr) and Google Play ($25) accounts** —
   in progress; the user will confirm when they are ready. Needed to *ship*
   Sprint 19.7, not to build it.
9. **Confirm the first school's biometric device model** and that its firmware
   supports push/ADMS — needed before Sprint 19.6 (§5x).
10. ~~Decide the video vendor~~ — **self-hosted Jitsi, confirmed 2026-08-12.**
    A VPS is now platform infrastructure to provision and operate (§5x).
11. ~~**A *working* Google Maps API key**, if the address picker is wanted.~~
    **CLOSED 2026-08-19 (§5an) — nothing needs one.** The key supplied on
    2026-08-18 never worked (unbilled project, and its API restrictions excluded
    Maps JavaScript API), and three console steps were outstanding to fix it.
    Address autocomplete now runs on Mapbox instead, and **no Google account is
    needed at all**. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is read by nothing and can
    be deleted from the hosting panel.

    ⚠️ **One action replaced it, and it is smaller: set `NEXT_PUBLIC_MAPBOX_TOKEN`
    in the hosting panel.** A token was briefly committed as a fallback so this
    would need no panel action; GitHub push protection refused the push because
    this repository is public, and the fallback was removed (§5ao). Until the
    variable is set, every address field is the plain text box it always was and
    says so — nothing breaks. Restrict the token by URL in the Mapbox console.
    **Known limitation, not a configuration fault:** Mapbox finds Pakistani
    cities and localities but very few streets and almost no buildings, so most
    school addresses are typed rather than picked — the field is built for that.
12. **Set `SMTP_PASS_B64` in the hosting panel and DELETE `SMTP_PASS`**, then
    restart, then press *Retry abandoned messages* on the Super Admin dashboard.
    ~~Fix `SMTP_USER`/`SMTP_PASS`; only the panel's copy is wrong (§5al).~~
    **That was wrong — the credentials are correct and always were (§5am).** The
    password contains a `#`, and an unquoted `#` in a `.env` line silently
    truncates the value; on Hostinger the panel *is* a `.env` file. Re-typing it
    cannot help, which is why it never did. Get the value from
    `npm run smtp-encode` (it is already in `.env.local`). Thirteen messages are
    waiting — 7 queued, 6 failed — and the drainer never touches a `failed` row
    on its own.

    Confirm it landed, rather than assuming: `POST /api/internal/smtp-check`
    with `{"verify":true}` should report `password.length` **17**,
    `password.fingerprint` **`3e92ffa00be4`**, and `auth.accepted` **true**.
    Call it twice — more than one process serves this site (§5ak). Unset
    `SUPER_ADMIN_DIAGNOSTICS_SECRET` afterwards.

12b. **Press *Provision / Re-check* on all three schools** once this deploys.
    Each is stuck at "Not connected" with no certificate because a wildcard made
    provisioning skip writing their DNS record (§5am). The button is idempotent.
13. **Restart the application in hPanel.** Multiple instances serve the site and
    a git push does not restart all of them, so old and new code are being
    served side by side right now (§5ak). No session can do this — there is no
    API, and the Actions workflow that could is `workflow_dispatch` with secrets
    the repo does not hold.
14. **Drive the *school* form by hand, once** — the branch form was driven in a
    browser on 2026-08-18 (§5aj) and behaved correctly; the school creation form
    still has not been submitted end to end by a person. No plaintext Super
    Admin password exists — only `SUPER_ADMIN_PASSWORD_HASH` — so the 2026-08-18
    batch was verified by 60 scripted assertions and a rendered chart rather
    than by clicking. Someone who can sign in should create one school and one
    branch end to end. §5ai.
15. 🔴 **Close the ~1s edge→origin hop in hPanel (§5aq).** Proven to be
    transport, not code — the same build answers in 10ms locally and ~1s live,
    and a page that executes nothing pays the same ~1s. Three things, in order:
    (a) which **datacenter** the origin is in, relative to the Kuala Lumpur CDN
    edge; (b) whether the **CDN helps Pakistani traffic at all** — Lahore → KL →
    origin may be slower than Lahore → origin, and it is one toggle plus an
    afternoon of measurement; (c) whether §5ak's **two Node processes** are
    still running. **Authorise the Hostinger MCP server** and a session can read
    and change all three; it is connected but unauthenticated today.

---

---

## 5as. Sprint 13.8 — sibling identity — 2026-08-20

The user asked for six things. They are one thing.

### The gap, stated exactly

Nothing linked one student to another. There is no sibling table, no household
record, and there was no derivation of one outside `lib/family-challans.ts`,
which grouped **open fee challans** on the **primary guardian's phone number**.

Consequences, all of them real before today:

* the only screen that knew two children were related was Fees → Family
  Vouchers, and only for children with an open challan in the billed month;
* an admin on Ahmed's profile could not see that Fatima two classes up is his
  sister — the fact behind the sibling discount, the shared transport and the
  parent who comes once for two parents' evenings;
* an admissions clerk enrolling a second child **re-typed the father from
  scratch**, and any difference in spelling created a second person, after
  which the two children were related by nothing at all;
* the guardian CNIC was collected by four different raw `<Input>` boxes, none
  masked or validated. Production held a **32-character** value in that column.

### The rule, in one file

`lib/siblings.ts`. **Two enrolled students are siblings when they share a
guardian; two guardian rows are the same person when they share a CNIC or a
phone number.** Every sibling surface reads it from there.

CNIC is the honest key — issued once, to one person, for life. Phone stays
because every guardian recorded before today has one and most have no CNIC, and
a rule that ignored them would un-relate every family already on a roll.

**What it costs, stated plainly:** the phone half still reads two unrelated
guardians on one handset as one family. That is rare and it is *visible* — the
sibling card names the children and the guardian they are shared through, and
the voucher prints them. CNIC coverage grows with every admission.

### The enrolment form asks for the CNIC first

Fifth field → first field, spanning the card. A complete number hits
`GET /api/school/guardians/lookup`, and on a match the card fills itself in from
the record the school already holds — **never overwriting anything the clerk has
typed** — and names the children this person already guards, with admission
numbers.

Two details worth keeping:

* the fill reads the cards through a **ref**, not the render-time array, so a
  lookup resolving after the clerk starts typing cannot undo the name they just
  entered;
* it also runs **on mount** for a card that arrives already carrying a whole
  CNIC. That is the converted-application path — the parent typed the number on
  the public form weeks ago and the clerk never touches the field, so a
  keystroke-triggered lookup would never fire. It is the case most likely to be
  a returning family.

The lookup is gated on `admissions.write`, refuses anything shorter than a whole
CNIC (so it cannot be walked to enumerate a school's guardians), and returns a
phone number, an email and children's names — which is why both of those are
true.

### Three guardian rules, enforced twice

The form removes impossible options from the dropdown; `parseGuardians` and both
guardian routes refuse them. The dropdown is a courtesy, the server is the rule.

1. **First guardian must be Father, Mother or Sibling.** "Other" is the absence
   of an answer to who the school holds responsible.
2. **Father and Mother are each available once per student.** A duplicate is
   what splits one family in two on the sibling lookup and the voucher.
3. **"Other" carries `relationship_other`** — the relation in the school's own
   words, required by the API.

⚠ **One documented exception:** `POST /api/school/applications/[id]/convert`
carries what the *applicant* wrote on the public form. A one-click conversion
must not fail because a parent called themselves a guardian rather than a
father; the relationship is corrected on the profile in one click, and refusing
would lose the admission. Do not "fix" this by tightening it.

### Where siblings are shown

| Portal | Screen | What |
| --- | --- | --- |
| School / Branch Admin | student profile | **Siblings at this school** — name, admission number, class, and which guardian they are shared through. Withdrawn siblings appear with a badge. |
| School / Branch Admin | application review | **This family is already at this school** — before the offer goes out, the only moment it can change the decision. |
| School / Branch Admin | challan detail | the family, pointing at Family Vouchers. |
| School / Branch Admin | enrolment + Add guardian | the live CNIC lookup. |
| Parents / Guardians | **portal header, every screen** | `ChildSwitcher` — a native `<select>` naming every child on this login. One child renders as text. |
| Super Admin | — | nothing, deliberately. A platform operator has no business reading a family's composition. |

⚠ The Family Vouchers screen is **not branch-scoped** — it reads by
`location_id` only, so a `branch_admin` with `fees.read` sees every family in
the school, not only their campus. That predates this sprint and was not
changed; it is recorded here because it was found while working.

### The standing rule this leaves behind

**Every CNIC field is `components/ui/CnicField.tsx`; every stored CNIC goes
through `normalizeCnic`.** Four raw inputs replaced — enrolment guardians,
guardian panel, public application, staff record. `NationalIdField` (student's
own CNIC *or* B-Form) is the one exemption, and only while it goes on calling
`formatCnic(` and `isValidCnic(` itself — asserted, not assumed.

New `npm run check-cnic`: 36 assertions across the mask, canonicalisation,
masking and a source scan of 396 components. **In CI.** `CLAUDE.md` carries this
rule and the guardian rules.

This is not cosmetic. A column holding `4210112345671` beside `42101-1234567-1`
holds two people as far as every query is concerned, and the two are
indistinguishable on screen because both render masked. An unmasked field does
not produce an ugly value — it produces a family that silently stops being one.

### The migration

`0026_sibling_identity.sql`: `relationship_other` (nullable, no CHECK — old rows
are history and a constraint would refuse the next unrelated write to them), two
indexes on `(location_id, cnic)` and `(location_id, phone)`, and a back-fill.

⚠ **The back-fill canonicalises only values carrying exactly thirteen digits.**
Anything else is left exactly as it is. Guessing at a malformed identity number
is how you invent a relationship between two unrelated children, and the
migration must not be capable of it. Those rows simply do not participate:
`lib/siblings.ts` re-normalises on read and drops what it cannot canonicalise,
so a partial number can never match another partial by string equality. Empty
strings were cleared to null — as an identity key, `''` matches every other
blank.

### What was NOT done

* ⛔ **It was not deployed at the time.** ~~The deploy workflow's three SSH
  secrets are absent and there is no auto-deploy on push.~~ **Superseded
  2026-08-22 — see §5ax.** Hostinger auto-deploys from GitHub on every push to
  `main` and has done throughout; the SSH secrets belong to a workflow that no
  longer exists. What was actually true on the day is the second sentence: the
  live build id did not move, and nobody established why.
* **Nothing was looked at in a browser.** Same as §5ar: no screenshot of the
  sibling card, the CNIC lookup or the header switcher exists. The layouts are
  unseen. This is the next thing worth doing.
* The **student import** writes `relationship_other: null` and no CNIC — a
  spreadsheet has no column for either and inventing one would put words in the
  school's mouth.
* **Announcements still do not de-duplicate by family**: a parent of three gets
  whatever the audience rules produce per child.
* The **sibling discount is still manual** — `student_concessions` is a generic
  per-student discount that a school happens to name "Sibling discount".
  Nothing auto-applies it now that second children are detectable. That is the
  obvious next sprint.

---

## 5at. The announcement sweep had never worked — 2026-08-20

Reported as ~420 lines of one repeating error in the production log.

### The defect, in one line

```ts
or(isNull(announcements.scheduledAt), sql`${announcements.scheduledAt} <= ${now}`)
```

A raw `` sql`` `` template is the only construct where Drizzle has no column to
map a value against, so the JavaScript `Date` was handed to postgres-js as-is
and the driver failed to serialise it. `lte(announcements.scheduledAt, now)`
routes the same value through `PgTimestamp.mapToDriverValue`, which produces
`"2026-08-20T18:42:48.447Z"`. Same SQL text, same plan, different parameter.

### Proven, not reasoned

Both forms were built with the real query builder and run against the live
database:

| Form | Parameter sent | 3 runs |
| --- | --- | --- |
| `` sql`${col} <= ${now}` `` | `Date` | **FAILS 3/3**, the log's exact message |
| `lte(col, now)` | `"2026-…Z"` string | OK 3/3 |

The generated SQL was byte-identical to the string in the production log, which
is what makes this the reported fault rather than something resembling it.

The three hypotheses in the report were each checked and each ruled out: the
line is unchanged since Sprint 11 (`c0f510a`, 2026-08-15); `postgres@3.4.9` and
`drizzle-orm@0.44.7` are the versions it has always run against; and the
`scheduled_at` filter is not new. **It never worked.** Invisible in development
because nothing there schedules an announcement, total in production.

### The second defect, which the fix would have activated

The log's timestamps repeat at **seven** distinct offsets every minute — seven
Node processes, each running `instrumentation.ts`. `sendAnnouncement` guarded
with a read-then-check (`if (announcement.status === 'sent') return null`),
which all seven would have passed simultaneously.

`announcement_recipients` de-duplicates on a unique key, so the notice board
would have survived. `email_outbox` has none — an announcement email is an
insert, not an upsert — so **every parent would have received seven copies of
every scheduled notice.**

The send now claims its row first:

```sql
UPDATE announcements SET status='sent' … WHERE id=$1 AND status <> 'sent' RETURNING id
```

Postgres decides that on one row under one lock. Seven simultaneous claims were
run against the live table: exactly one returned a row, the other six got
nothing, and the row ended `sent` once. The probe row was `draft` with no
`scheduled_at` — invisible to every sweeper, so the test could not release
anything to anybody — and was deleted afterwards.

⚠ **Claiming moves the row before the work is done**, so `sendAnnouncement`
reverts the status in a `catch` and re-throws. Without that, one transient
failure becomes an announcement the school believes went out and nobody
received. The scheduler's "left as `scheduled`, so the next sweep tries again"
comment depends on this revert; do not remove it.

### Two rules added to CLAUDE.md

* **A value never reaches the driver through a raw `` sql`` `` template** — use
  the operator (`eq`, `lte`, `gte`, `inArray`). Reserve the template for
  expressions that have no operator: `count(*) filter (…)`, a cast, `extract`.
* **Background work is claimed, not checked** — anything a timer picks up takes
  a conditional `UPDATE … RETURNING`, because there are seven of them.

`lib/principal-resolver.ts` held the only other raw comparison against a column.
It was safe — a `date` column against a `YYYY-MM-DD` string — and was converted
to `gte` anyway, so the pattern is no longer in the codebase to be copied.

### What was NOT done

* **No scheduled announcement was released end to end.** The fix is proven at
  the query and at the claim; the rest of the send path (audience → outbox →
  SMTP) was not exercised, because doing that on the live database means mailing
  a real school's parents.
* This ships in the same undeployed state as §5as — see the banner at the top.

## 7. Session log

| Date | Session did | Next |
| --- | --- | --- |
| 2026-08-26 | **Sprint 16 — feedback, global search, and three dashboard fixes** (§5bd). Four new tables in `0032`, applied and verified with the CHECKs made to fire inside a rolled-back transaction. A school sends a bug or a suggestion with up to five PNG/JPEG/PDF files; the platform is notified in-app and by email, reads a four-section queue with filters, sorting, pagination and a counter toggle, and replies, decides or deletes — each of which notifies the school both ways. Driven end to end against the live database with two real schools: a real PNG and PDF round-tripped byte-exact, tenancy isolation gave 404 on both the attachment and the reply, and every notification and email row was read back out of Postgres. Global search on all five portals, five scoped functions rather than one with a role parameter. **The second scrollbar was `sr-only`** — `position: absolute` with no positioned ancestor escapes `<main>`'s `overflow-y` and grows the root; the bottom-most hidden `<figcaption>` sat at document y = 1185, which was `scrollHeight` exactly. Five QA defects found and fixed, one of them only findable against real data: *Teachers 0* at a school with a teacher on the HR register and no portal account. **Merged to `main` locally, `--no-ff`, nothing pushed.** | **Pushed, merged (PR #32) and live as `47e072c1f058`** the same day; the cache purge and commit confirmation both ran green. Left on the live deployment: press **Provision** on both schools (outstanding from §5bc). Still nobody has signed in as a teacher, parent or student — that is now three sprints of scoping asserted in code and never held in a hand, and it is the next thing worth an hour. |
| 2026-08-22 | **The deploy was never blocked, and the probe that would have said so was gitignored** (§5ax). Asked to fix "the Hostinger SSH issue". There is none: hPanel has auto-deployment on from GitHub, and it built `17099d4` at 16:52 in 2m29s, Completed — the WhatsApp merge had been live for hours. The five `HOSTINGER_SSH_*` secrets are leftovers from the rsync workflow #24 deleted and are read by nothing; the three `deploy.yml` actually reads are all set. **This file had said the opposite for two days**, accurately on 2026-08-20 and falsely from 2026-08-21, which is the §5aw failure one level up. **The real bug, found while disproving the false one:** `.gitignore` line 13 was a bare `build/`, which matches at any depth and therefore matched `app/api/internal/build/` — an App Router segment, not build output. `/api/internal/build` has never been committed, so Hostinger never had it and production 404s it, and the verification workflow's "which commit is live" step **could never have passed on any deploy** — its failure message blamed the deployment. Both patterns anchored to the root. **CI structurally cannot catch this** (an ignored file is absent from a fresh checkout), so `check-loaders` now asks git whether each route file on disk is tracked — 237 assertions, proven against a planted route in an ignored directory. Cache purged in hPanel. | Set `SMOKE_SUPER_ADMIN_EMAIL` and `SMOKE_SUPER_ADMIN_PASSWORD` — the only secrets genuinely missing — then run *Verify the live deployment* and watch it pass for the first time. Then the twenty minutes of clicking that three sprints have now deferred. |
| 2026-08-22 | **WhatsApp removed from the platform, and three faults underneath it** (§5aw). Four reports, one session. **WhatsApp is gone, not gated** — `lib/channels.ts`, `ChannelToggleList`, `sendWhatsAppMessage`, `PLATFORM_CHANNELS` and the whole channel-vs-module distinction deleted; `lib/ghl-fees.ts` rewritten as `lib/fee-notices.ts` with no GHL import left in it. GHL survives as contact sync only. `0028` drops the two invitation columns and the `school_modules` row, and **re-labels** `announcement_recipients.channel = 'whatsapp'` to `'notice'` rather than deleting the school's own delivery record. **The invite form had never accepted a formatted number**: the route validated with `/^\+?[0-9\s-]{7,20}$/`, which has no brackets in it, against a client that masks every value into `(021) 444444` — so it refused its own form's output, and `identity` on the PhoneField refused a landline besides. Both now import `lib/phone-formats.ts`, the rule `PhoneField`'s own docblock already stated. **The dashboard outage was `0027`**: `getAccountingOverview` counting a `ledger_transactions` that did not exist, inside a `Promise.all`, so one tile took the students count, the staff count, three charts and every quick action with it. `0027` and `0028` are **both applied to the live database now** — 27 rows of bookkeeping before, 29 after — and each optional read is wrapped so the page degrades one tile at a time. **"Unexpected response."** was the login route being the one route on this surface with no `try`/`catch`; probing the live endpoint with a wrong address returns a correct 401 JSON, so the report was a transient the message refused to name. Both client helpers now report the status and distinguish 502/503/504 from a defect. All nine gates green, plus all five database-backed checks — `check-reports` had been failing on the same missing tables and now passes. | **Nothing here has been clicked in a browser** — the sign-in needs a password and no session may type one, so the invite form, the dashboard and the bulk-modules page are verified by query and by build, not by eye. Twenty minutes with a real login is the next thing worth doing. ~~Then deploy: `HOSTINGER_SSH_*` is still missing.~~ **Wrong — see §5ax.** It deployed by itself; Hostinger's GitHub connection has auto-deployment on. Then the automatic sibling discount. |
| 2026-08-21 | **Sprint 13.5 merged, then actually run — and the day book had never worked** (§5av). PR #22 merged to `main` (`eec668f`) on a green CI. Then, for the first time in this project's history, a session had **PostgreSQL 16 and Chromium**: all 28 migrations applied in order, `0027`'s seed and backfill tested against a school seeded with three fee payments that **predated** it, and every screen driven in a browser. **The backfill is correct** — cash → `1000`, transfer → `1010`, cheque → `1020` and not the bank, each entry dated to the payment rather than to the migration, and a second run wrote **0 rows**. **The day book threw `column reference "id" is ambiguous` on every call**: Drizzle renders a column interpolated into a `sql` template **unqualified when the outer query has a single table in its FROM** and qualified once a join is present, so five correlated sub-selects that are correct beside a join were bare column names without one — and the one that did *not* throw compared two `ledger_entries` columns and would have printed a column of zeroes. Rewritten as two queries and a regroup. **`check-reports` is the only thing that could ever have caught it and was itself red**, asserting nine reports when 13.5 had added seven. 53 assertions through the application's own code, twelve routes in Chromium with **no console errors and no failed requests**, the balance sheet at **16,800 = 16,800**, the accountant's `POST /settlements` at **403**, all seven statements printing under `print` media and exporting as CSV. **Sign-in was stubbed** (no Supabase here) and the stubs reverted — everything behind the session is verified, the session itself is not. | **Apply `0027` to production.** It is proven and not deployed. Then real A4, still. Then Sprint 13.6 (i18n) on **`0028`**. |
| 2026-08-21 | **Sprint 13.5 — Accounting: the ledger, expenses and per-staff cash** (§5au). The sprint this file has pointed at for six sessions. Six tables, one column, seven statements. **The column is the point**: `fee_payments.ledger_transaction_id`, posted in the *same database transaction* as the payment — a payment recorded without its posting understates income silently, and nothing on any screen would ever say so. `ledger_transactions` + `ledger_entries` are **append-only**; a correction is a mirrored reversing entry and both stay in the book, because Sprint 16's wallet and Sprint 20's POS post here and a ledger retrofitted under live money is the cost this sequencing exists to avoid. **Per-staff cash accounts**: a cash payment lands in the drawer of whoever took it, not the office safe, and their balance is what they owe the school right now; settling stores what the drawer *should* have held beside what was counted, and the short is **not** written off. `accounting.settle` is a third key and the `accountant` role deliberately does not hold it. **Two calls against the document, both written down**: `ledger_entries` gets a header table (one date and one cause, two or more sides), and the module flag is the existing `accounts` rather than a second `accounting`. Income is recognised on receipt, not on billing — `0027`'s header says why at length, because it is the decision somebody will otherwise reverse without knowing it was one. Seven reports added as catalogue declarations, so each gets screen, `PrintSheet` and CSV for free. The dashboard's "Needs the accounting ledger" tile answers now, and still says so where the module is off or the chart is unset. New `npm run check-accounting` — **121 assertions, in CI**, and verified by breaking two rules on purpose (five failures, four sections) and restoring them. All nine gates green including the build. | **Apply `0027`.** It is written and not run; no session here has the credentials, and until it runs the module has no tables. The backfill is guarded on the null column rather than a date, so it picks up whatever accumulated in the meantime. Then **look at something in a browser** — six new screens and this is the third sprint with nothing seen. Then Sprint 13.6 (internationalisation) on **`0028`**. |
| 2026-08-21 | **Release notes, test cases, and a correction I owed the file.** Wrote `RELEASE-NOTES-ANNOUNCEMENT-SWEEP-AND-DEPLOY.md` (the sweep, the seven-process double-send, and the four separate faults the deploy pipeline took to complete) and `TEST-CASES-SPRINT-13.8.md` — 35 cases over the sibling rule, the enrolment lookup, the guardian rules, the CNIC field, the parent portal, the sweep, and the existing-data regressions. Marked 13.8's notes live. **Corrected this file's DNS claim: school portals were never broken.** I had probed `lgs.codexmill.com`; schools are `<slug>.schoolhub.codexmill.com`. `lgs.schoolhub.codexmill.com` resolves, serves the sign-in page, and answers 401 on the new sibling route while a nonsense path answers 404. No DNS change was needed or made. | Drive one scheduled announcement end to end on a school with no real parents — the send path past the atomic claim is still unexercised. Then the P1 test cases above, in a browser: nothing in 13.8 has been clicked. Then set `HOSTINGER_RESTART_COMMAND` and `PRODUCTION_URL` so deploys restart and verify themselves. |
| 2026-08-20 | **The announcement sweep had never worked** (§5at). ~420 lines of one repeating error in the production log, reported as a possible dependency or recent-change problem; it is neither. `` sql`${announcements.scheduledAt} <= ${now}` `` passed a JS `Date` straight to postgres-js, because a raw template is the one construct with no column to map against. Every sweep since **Sprint 11** threw before reading a row, so **no scheduled announcement had ever been released at any school** — and this file had dismissed the error as "pre-existing and unrelated" three times. `lte(col, now)` maps it to an ISO string. Reproduced against the live database with the real query builder: byte-identical SQL, raw form fails 3/3, `lte` passes 3/3. **Found while fixing it:** the log's timestamps repeat at seven offsets a minute — seven scheduler processes — and `sendAnnouncement` guarded with a read-then-check, so the query fix alone would have sent every parent **seven copies** of every notice (`email_outbox` has no unique key). The send now claims its row with a conditional UPDATE and reverts on failure; seven simultaneous claims against the live table produced exactly one winner. Two rules added to CLAUDE.md. | Deploy is still blocked on the missing SSH secrets (see the banner) — this fix and 13.8 are both merged and neither is live. Then drive one scheduled announcement end to end on a school with no real parents, since the send path past the claim is still unexercised. |
| 2026-08-20 | **Sprint 13.8 — sibling identity** (§5as). Six requests, one thing. **Nothing in this product linked one student to another**: "sibling" was derived in one file, `lib/family-challans.ts`, by grouping open challans on the primary guardian's phone, so the only screen that knew two children were related was the family voucher — and only for children billed that month. `student_guardians.cnic` becomes an identity key: **two students are siblings when they share a guardian, and two guardian rows are one person when they share a CNIC *or* a phone**, unioned transitively by a union-find so that promoting CNIC does not *split* the families that predate it. The enrolment form asks for the CNIC **first** and fills the card in from the record the school already holds, naming the children that person already guards. Three guardian rules (first must be Father/Mother/Sibling; Father and Mother once each; "Other" carries a written relation) enforced on the form and in `parseGuardians`. Siblings shown on the student profile, application review, challan detail, and as a **header dropdown in the parent portal** — the portal still scopes by `school_user_id`, never by the sibling rule. **Four raw `<Input label="CNIC">` boxes replaced** by one `CnicField`; production held a **32-character** value in that column, which is what an unmasked field produces. New `npm run check-cnic`, 36 assertions, in CI. `0026` applied and verified against the real schema — the junk value left at 32 characters rather than guessed at. | **Nothing was looked at** — still no screenshot of any new screen, now for two sprints running. Twenty minutes of clicking, then print one of each document on real A4. Then the **automatic sibling discount**: second children are detectable now and `student_concessions` still applies them by hand. Sprint 13.5 (accounting) on migration **`0027`**. |
| 2026-08-20 | **Sprint 13.7 — parent accounts, period schedules, colours, teacher calendar** (§5ar). The reported fault was "the father did not get a welcome email"; the email was the smaller half. **No guardian had ever been given a `school_users` row**, so Sprint 13's six parent screens — routed, permissioned, with a calendar and printable report cards in them — could not be opened by a single parent at any school, and every profile said "No portal account" with nothing implying that was leavable. `lib/parent-portal-access.ts` opens the account, links every guardian row on that number, and queues the §5g setup email with parent wording. **Found while wiring it:** enrolment gave the *child's* directory row the primary guardian's mobile, and `school_users` is unique on (location, phone) — so the father's own account would later have upserted onto his daughter's row, writing his address onto her record. The sentinel is now unconditional. **The fee gate** is a second column, `fee_status`, and deliberately not a fifth `status`: `active` is what the register, promotions, class lists, the challan generator and nine reports filter on, so a child parked outside it would be invisible to the very generator that produces the bill they are waiting to pay. Clears on "holds a challan and none still open"; a waiver counts; a manual button exists because a school that takes cash across a desk would otherwise never fire it at all. **Period structures** end one-bell-per-school — the old (location, order_index) key refused a school's second schedule as a duplicate of its first — with a default that makes the migration a no-op for anyone who never opens the screen. **Subject colours** gain a picker; asserting its contrast caught `#db2777`, in the shipped palette since Sprint 6 at 4.39:1, which no build or screenshot had ever objected to. **The teacher calendar** projects rules onto dates through UTC-midnight strings and sorts by the clock, because a teacher on two schedules has periods whose positions are not comparable. `0025` applied and verified against the real schema. New `npm run check-sprint-periods` — 107 assertions, in CI. **Everything was driven end to end against the live database in a real session** and the QA rows removed. | **Nothing was looked at** — the preview browser does not composite, so no screenshot of any new screen exists and the layouts are unseen. Twenty minutes of clicking is the next thing worth doing. Then **print one of each document on real A4** (still needs a person and a printer), then Sprint 13.5 (accounting) on migration **`0026`**. Also pre-existing and unrelated: `[announcements] sweep failed … Received an instance of Date`, every 60s in the dev log. |
| 2026-08-19 | **Three onboarding faults, reported by the user** (§5ap). (1) **Creating a school sent its first administrator nothing** — proven from the data, not inferred: `password_setup_tokens` had a row for the branch admin and none for the school admin, and the only mail that address ever got was an invite-flow OTP somebody sent by hand nine minutes later. Every other member-creating path queues `queueAccessEmail`; the one route that provisions the *first* person into a school was the only one that did not. It does now, and `SchoolForm` lands the operator on Users whenever the admin was not created **or** the mail did not queue. (2) **"School portal unavailable" on /dashboard/users — never reproduced**, and said so plainly: the live site answers that route correctly (14 anonymous samples, plus a garbage-cookie probe that proves the tenant headers are stamped), and it renders locally against the production database for `school_admin`, `branch_admin` and a platform-operator hand-off session alike. The one remaining code path that produces that page was middleware collapsing `fetchSchoolBySlug`s deliberate throw-vs-null distinction, so a single failed Supabase call accused the tenant; the lookup cache now serves its expired entry rather than the not-found page, and logs every time. **If it recurs, look at §5ak** — header casing still differs between consecutive responses, so more than one process is answering. (3) **Invite Staff asked for a branch it would not let you create.** New `POST /api/school/branches` gated on `settings.write` that **never creates a member**; Invite Staff redirects to `/dashboard/branches/new?next=…` when there are none and the caller can make one, and shows an empty state naming who can help when they cannot; the Super Admin branch form is reused with no `schoolId`, which is what drops the invite toggle and the Active toggle; `/dashboard/branches` finally exists, having been a sidebar `placeholder` pointing at a 404 since Sprint 10.5. Two lying strings fixed — the invite page now asks `isWhatsAppEnabled` instead of claiming WhatsApp is primary. | **Print one of each document on real A4** — still outstanding, still needs a person and a printer. Then Sprint 13.5 (accounting) on migration `0025`. **Ask the user whether /dashboard/users recurs** — if it does, the next move is restarting the app in hPanel (§5ak), not more code. `NEXT_PUBLIC_MAPBOX_TOKEN` still needs setting (§6 item 11). |
| 2026-08-19 | **Address and phone made one field each** (§5an). `AddressAutocomplete` (Mapbox Search Box) and `PhoneField` (Mobile/Landline dropdown, digits-only masks — mobile `(xxxx) xxx-xxxx` fixed at eleven, landline `(xxx)` then up to ten) replaced eleven hand-rolled fields across nine files; Google Places and both `@googlemaps` packages are gone. **The token was measured before anything was built**, and the answer shaped the design: Mapbox has Pakistani cities and localities and almost nothing below — "Beaconhouse" and "Ferozepur Road" return nothing at all — so the text box is the record and an empty suggestion list is worded as ordinary rather than as a miss. **No `phone_kind` column**: the format is self-describing, so the kind is derived on load and the store→detect→re-mask round trip is asserted. On identity fields (guardian, invitation, admissions) Landline is offered and then refused with a reason — the user chose that over relaxing `normalizePhone`, which was offered and declined. **Two defects found by building it:** `hasCompleteMobileDigits` accepted any eleven digits starting `0`, so the Lahore landline `042 35300000` was a valid "mobile" and was re-masked to a number that does not exist (live since `0024`); and coordinates outlived the address they belonged to, so picking a place and then retyping the address would have filed it at the old location. The second was only findable in a browser — so `ContactFields` was added to `/design-system` and both fields were **actually driven**, which §5ai and §5aj could not do. Mapbox billing checked too: 46 characters typed cost 2 suggest calls and 1 retrieve. New `npm run check-address-phone` — 32 assertions plus a scan of all 280 components that fails on a raw `<Input label="Phone">`, which is what makes the rule apply to pages nobody has written yet. | **Print one of each document on real A4** — still outstanding, still needs a person and a printer. Then Sprint 13.5 (accounting) on migration `0025`. Nothing here needs a panel action: the Mapbox token ships with the app and `NEXT_PUBLIC_MAPBOX_TOKEN` only overrides it. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` can be deleted from the hosting panel. |
| 2026-08-18 | **School and branch creation, fixed** (§5ai). Ten reported items, and the last of them was two defects wearing one description. The module-adoption chart was drawing eleven long labels onto one x axis and had passed every automated check while being unreadable — `BarChart` gains a horizontal orientation, and rotation and truncation are both recorded as rejected, the second because it renders "Academics & Timetable" and "Accounts & Finance" identically. The branch form asks city first because it is the only answer that produces another (`Karachi` → `KHI-MAIN`, editable); `MIXED` now demands a board name; "Highest grade" — a free-text box that could express neither a junior campus's floor nor a skipped year — is replaced by a curriculum-filtered class list; phone splits into masked landline and mobile; email is checked against the practical grammar rather than `includes('@')`; the address gains a map picker that degrades to plain text with no key configured. All of it applies to the school form and all of it is re-checked server-side. **The two real bugs: Supabase held no address the panel had ever been asked to invite** — only the synthetic `pa_` hand-off accounts — because nothing created an account until password setup, so the address is now registered at provisioning while `auth_user_id` stays null (five things read that column as "has been through setup"); **and deleting a member left their Supabase account claiming the address forever**, so a re-invited person came back onto their old credential — now deleted with the membership, but only once no other school holds that address, because one account is one human and not one membership. **Migration `0024` applied and verified** — 25 recorded, eight columns, nothing dropped; `max_grade` deliberately kept and populated because its free-text values cannot be mapped without guessing. New `npm run check-forms`: 60 assertions, which caught a mobile validator accepting the right digits in the wrong shape. | **The two forms have not been driven by hand in a browser** — no plaintext Super Admin password exists, so QA was scripted. Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` to turn the map on. Then print one of each document on A4, then Sprint 13.5 on migration `0025`. |
| 2026-08-16 | **Sprint 13 — Portals, the PWA shell and BR4** (§5ac). Fourteen new screens across the three portals a school does not log into, plus two things that are not screens: an installable per-tenant app, and multiple principals. **Migration `0023` written, applied and verified against the real schema** — 24 recorded, three tables, 11 indexes, `principal_model` defaulting to `single` on all six schools, and the permission CHECK accepting `principals.manage`. **BR4 adds no role**: the document's dynamic `principal_${division}` role is refused, because `school_users.role` is CHECK-constrained and every permission default is keyed on a closed set — the assignment scopes what a head *sees*, which is a visibility boundary and not an authorization one, and §5ac says plainly what that costs. **The service worker caches nothing authenticated**, deliberately and permanently until a session-keyed cache exists: a cached fee page outlives its session on a handset that is frequently shared, and signing out does not clear it. Notification preferences are opt-out with no back-fill and govern email only — the notice board is never suppressed, because a school must not be able to have told somebody something they had no way of seeing. Found and fixed a Sprint 11 defect in passing: the composer **discarded the send outcome**, so the unreachable count was computed, stored and never shown to anybody. New `npm run check-portals` asserts the calendar arithmetic and the principal-scope union with no database, then executes all 14 new queries against the live schema. All seven gates green. | **Print one of each document on real A4** — still outstanding, still needs a person and a printer, and Sprint 13 has just added the parent's own report-card sheet to the pile. Then Sprint 13.5 (accounting), which needs migration **`0025`** (`0024` was taken by the 2026-08-18 creation fixes, §5ai). Two smaller things this sprint left written but unrendered: the shared-lesson-plan read for coordinators, and Sprint 11's delivery report — build them together. |
| 2026-08-15 | **Sprint 12 — Reports & analytics** (§5ab). Nine reports — attendance summary, subject-wise attendance, fee collection, outstanding/aging, academic results, payroll summary, leave summary, enrollment funnel, monthly revenue — each with filters in the URL, a printed sheet on the school's letterhead and a CSV export. **One definition, three renderers**: `lib/report-catalogue.ts` declares a report once and the screen, the sheet and the file all read it, so a column cannot exist on one and not another. **No migration, deliberately** — a `reports.read` key would have needed the permission CHECK dropped and recreated, and would have let anyone who may read the register read the salary bill; each report is gated on the permission that already governs the screen its data comes from. `lib/csv-export.ts` is new because `lib/csv.ts` only read: it writes an Excel BOM and neutralises formula injection, both asserted in the new `npm run check-reports` **because both look like litter to whoever next tidies the file**. Subject-wise attendance is derived from the daily register plus the timetable and says so on screen and on paper — there is no per-period register to read, and the report measures teaching time lost rather than pretending otherwise. Verified against the seeded school: three independently written queries agree on PKR 2,105,531 outstanding, and the cash/bank split sums exactly to the collected total. All six gates green. | **Print one of each document on real A4** — still outstanding, still needs a person and a printer, and Sprint 12 has just added a tenth thing to print. Then Sprint 13 (portals + PWA shell + multiple principals), which does need a migration. |
| 2026-08-15 | **Sprint 11 — Communications** (§5aa), same session, after Task 1 merged. Three tables, three permissions, the audience rule, four API routes, the composer at `/dashboard/communications`, the notice board on the parent, student and teacher portals with a live unread badge, and the scheduler that releases a scheduled announcement — a second interval in `instrumentation.ts`, because the shared plan has no cron. The default delivery path is ours now that GHL is opt-in: the board always happens, email over the Sprint 0 outbox happens when asked, WhatsApp only where the paid add-on is on. The delivery log is written once at send and is what the notice board reads, so a child who changed section still sees the notice their old class was sent and never one addressed to a class they were not in. `unreachable` is kept separate from `failed` because one is the platform's to retry and the other is the school's to fix. All five gates green. | **Apply `0022_sprint11_comms.sql` to the live database** — nothing works until it runs, and it was left for a deliberate act rather than folded into a build session. Then the delivery-report screen, which is a written query with no page. |
| 2026-08-15 | **Sprint 10.5 Task 1 — the exams charts** (§5z). Grade distribution, subject averages and pass rate on the exam detail page; pass rate against average across the last six exams on the overview. Two aggregates in `lib/dashboard-queries.ts`, both registered in `check-dashboard`, taking deliverable C from five surfaces to seven. **The distribution is bucketed by the school's own bands** through the same `resolveBand` the report card calls, never fixed percentages — two schools with identical marks must draw different charts, and anything else would contradict the document printed from the same marks. Absent students are in no band and no pass-rate denominator, and every chart says who it left out. Extracted `resultPicker` so which sitting counts is written once rather than three times. **`check-dashboard` now also asserts the fold with no database** — eleven assertions, the pivotal one running the same marks through two schemes and requiring the results to differ, because that regression compiles and executes perfectly. Also **corrected a false claim in §5z**: the §5f worktree build hazard is not dead; the stub `node_modules` reappeared and broke the second build. | **Print one of each document on real A4.** It needs a person and a printer, gates Task 2 (the report card's per-subject bar), and is the only thing left in Sprint 10.5. |
| 2026-08-13 | **Sprint 10.5 foundation, run with `/impeccable`** (§5z). The palette a school picks now reaches the bottom of the interface instead of the top inch: `lib/brand-derive.ts` computes ~44 tokens from the five stored colours, and every travelling one is pushed until it clears contrast against *every* surface it can land on. Two user decisions taken — `lucide-react` for icons, and fully brand-derived status colours, implemented as a banded rotation so a school's hue moves them without letting "paid" and "overdue" swap appearances. Eleven missing primitives built, the eight existing ones retrofitted off `slate-*`, five SVG chart components (no library: a report-card chart must survive `PrintSheet`, and shared first-load JS is 102 kB against a 200 kB budget). Built `/design-system`, which renders everything once per palette across four real and three hostile ones and 404s outside development — **it immediately found 18 real contrast failures the audit script had passed**, all of them text on a surface the token had never been checked against. Fixed at source, and the script now checks the same list. Also caught a print regression this sprint introduced: `body` moved to `bg-surface`, which would have printed dark sheets for a dark-palette school. Final state: 994 rendered text elements across 7 palettes, 0 contrast failures; no sideways scroll at 375px; typecheck, lint, build, check-theme green. | **Deliverable B — the application shell.** Nothing the user looks at has changed yet; the foundation is built but no screen is rebuilt on it. Sidebar icons and grouping, page headers with breadcrumbs, then empty/loading/error states everywhere. |
| 2026-08-11 | **Super Admin login fixed and working live** (§5v). Inspected the Hostinger deployment over MCP: build completed, env present (a wrong password returned `401 invalid_credentials`, not `500`, which proves the variables reached the process and bcrypt ran), redirects relative so the `HOSTNAME` bug was absent, Supabase Edge tenant lookup working, `NEXT_PUBLIC_APP_DOMAIN` correctly inlined. That left only the hash. **Both log-based diagnostics turned out to be unreadable on this host** — hPanel shows no runtime logs and the deployment log ends at the build output — so the shape could not be observed at all. Rather than guess the escaping for a sixth session, removed the ambiguity: `normalizeBcryptHash()` strips wrapping quotes and `$`-escaping backslashes, which is a repair and not a guess because a bcrypt hash cannot contain either. Verified against real bcrypt across seven damaged forms; the one case that must not be repaired (shell-expanded, 53 chars) still fails. typecheck + lint + build green, pushed to `main`, Hostinger auto-built it, **and the user signed in.** Two platform facts learned expensively: the Environment panel and `.env` are one store (deleting the file wiped the panel — my recommendation caused that), and pushing to `main` deploys automatically. | **Rotate the password**, then set `SUPER_ADMIN_DIAGNOSTICS_SECRET` and call the endpoint: `repairedOnRead` says whether the host escapes `$` (which would also corrupt `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_PASS`, `DATABASE_URL`), and a changing `process.pid` settles the double-start. Then Node 20 → 22. Then browser-verify the school portals. |
| 2026-08-11 | **Deploy automation, so deploying stops depending on a session** (§5u). The user asked the assistant to perform the Hostinger deployment itself and to list the credentials it needed. It cannot — no network path to the host, and entering hosting credentials is not something it may do; the list was declined rather than inviting SSH keys into a chat transcript that has already leaked one password. Built the pipeline instead: `.github/workflows/deploy.yml` (manual dispatch, builds on Ubuntu because `sharp` is platform-specific, copies `.next/static` into `standalone`, rsyncs over SSH, restarts, verifies) and `scripts/smoke-test-live.mjs`. Every secret lives in GitHub Actions, entered by the user, seen by nobody else. The smoke test's best trick needs no credentials at all: a deliberately wrong password distinguishes `401 invalid_credentials` (healthy) from `500 server_misconfigured` (env missing) from `429` (throttled) — the distinction four sessions failed to make by hand. Verified against the standalone artifact in all three states: healthy → exit 0, escaped hash → exit 1 naming the boot log, missing env → exit 1 naming the variables. Fixed a defect in it found by testing: `process.exit()` with undici's keep-alive sockets still open aborts on Windows and reported **127** instead of 1, which would have made CI's verdict unreliable. | **Set the ten Actions secrets and run the workflow** — see `DEPLOYMENT.md` §5b. Then rotate the password and unset `SUPER_ADMIN_DIAGNOSTICS_SECRET`. Then the double-start and Node 20 → 22. |
| 2026-08-11 | **ROOT CAUSE: the repo printed the backslashes** (§5u). A fresh deployment still received 63 characters with backslashes after the user entered a raw 60-character value, so the transformation had to be upstream of the panel — and it was in this repository. `scripts/hash-password.mjs:94` did `hash.replaceAll('$', '\\$')` and printed that as its **only** output, labelled "the SUPER_ADMIN_PASSWORD_HASH line", with nothing saying it was escaped or that a hosting panel needs the raw form. Both `DEPLOYMENT.md` and `.env.example` told the operator to run it. Its output measures 63 characters with 3 backslashes — byte-for-byte what the live process reported. The panel was never wrong; it stored exactly what this repo told the user to paste. Ruled out every other transformer by inspection: no Dockerfile, no PM2 config, no deploy script, `ci.yml` sets no environment, `next.config.mjs` reads only `SUPABASE_URL`, nothing writes a `.env`. The script now prints both forms with character counts and says which goes where. **Anyone who generated a hash before today must regenerate it.** | **Regenerate the hash, paste form 1 into Hostinger, restart.** Then rotate the password properly and unset `SUPER_ADMIN_DIAGNOSTICS_SECRET`. Then the double-start (two Next.js banners per boot) and Node 20 → 22. |
| 2026-08-11 | **Built a way to inspect the deployed process** (§5u). The panel hash was corrected to a verified 60 characters and sign-in still failed, and the user objected — correctly — that local testing proves nothing about their host. Nothing in the repo had ever read the process actually serving the requests: the boot log, the host script and every local run inspect some other process. `POST /api/internal/super-admin-check` now answers from inside the live one — pid, uptime, configured email, the hash's length/prefix/**fingerprint**, the `.env` files beside it, and a bcrypt comparison performed there — guarded by `SUPER_ADMIN_DIAGNOSTICS_SECRET` and returning 503 whenever it is unset. `npm run fingerprint` computes the matching digest locally, which is the only way to tell whether the process holds *the* 60-char hash rather than *a* 60-char hash. Verified: guard rejects a missing and a wrong secret, 503 when unconfigured, fingerprints agree across an independent computation, and both comparison outcomes report correctly. Found a third mangling mode doing it — dotenv strips single quotes then expands, so a raw hash in a `.env` file resolves to 36 chars. | **Call the endpoint on the live host** and compare fingerprints; call it repeatedly to see whether `process.pid` changes. Then unset the diagnostics secret. |
| 2026-08-11 | **Root cause confirmed from the live host** (§5u). The redeployed build's new log line settled it in one attempt: `email matched: true; password matched: false; SUPER_ADMIN_PASSWORD_HASH is MALFORMED: 63 chars, expected 60, contains a backslash, starts "\$2b"`. The email was never wrong; the hash reaching the process is the escaped `\$2b\$12\$` form, which bcryptjs rejects on length without raising anything. The user had already set the panel to the raw form, so a `.env*` file was the obvious suspect — until it was measured: `@next/env` never replaces a variable the environment already holds, so the panel always wins and the wrong value can only have come from the panel. `DEPLOYMENT.md` §3 claimed the reverse and is corrected. Added a boot-time check in `instrumentation.ts` so a malformed hash announces itself when the server starts rather than waiting for someone to fail a login, with the shape logic moved into `lib/super-admin-hash-shape.ts` as one source for all three callers. Also surfaced two unrelated findings: the app prints two Next.js banners and two `Ready` lines per boot, so **it appears to be starting twice** — which would run the email-outbox drainer twice — and the host is on **Node 20**, which `@supabase/supabase-js` now warns is deprecated. | **Paste the raw 60-char hash and delete any `.env*` beside `server.js`.** Then rotate the password (it was pasted in plaintext on 2026-08-11). Then settle the double-start. |
| 2026-08-11 | **Super Admin sign-in returns 401 on the live Hostinger deployment** (§5u). Traced it: middleware exempts `/api/super-admin/auth/*` before its session check, so the only line in the codebase that can produce that 401 is `invalid_credentials` in the login route — the env vars are therefore *present* (missing ones give 500), and either the email or the bcrypt comparison failed. Found the mechanism that made it unloggable: `compare()` in bcryptjs 3.0.3 opens `if (hash.length !== 60) return false`, verified by probe — the escaped form (63), a shell-expanded one (53), quoted (62) and newline-terminated (61) all return **false without throwing**. Fixed the reporting rather than guessing the value: the login route now logs which half failed and the hash's *shape* (never the hash), and `scripts/check-super-admin-env.mjs` answers the same question on the host in one command. Also fixed `lib/super-admin-client.ts`, which converted every 401 — including the login route's own — into "Session expired.", which is what sent the previous two sessions after cookies and HTTPS. Verified locally end to end: wrong password → 401 `invalid_credentials` with the real message; correct → 200 with the cookie set; log line names the cause. | **Run `npm run check-super-admin` on the host** and read §5u. It prints which of the two halves is wrong. Then rotate the Super Admin password — it was pasted in plaintext into a chat on 2026-08-11 and was already the leaked one. |
| 2026-08-10 | **Enrolment form and the branding page that named the wrong theme** (§5t). The school's own settings page reported "Vibrant — in use" for a school themed from the Crimson & Gold preset: `GET /api/school/branding` never returned `presetKey`, so the page read `selected_palette` — `0` by default — while the portal around it was painted in the preset. The route now returns and accepts a preset, the page shows presets alongside the logo palettes, and the three derived names live in one shared constant instead of disagreeing between the two screens. On the enrolment form, "B-Form / CNIC" became a document *and* a number: CNIC is digits-only and reformatted 5-7-1 as typed and refused otherwise, B-Form is free text, both hidden by default behind an eye toggle, and the document type is stored in a new column rather than inferred from digits it cannot be inferred from. Religion and nationality became dropdowns that still hold any value predating the list. `typecheck`, `lint` and `build` clean. Migration `0020` applied and verified — 417 rows intact, 0 typed. **The enrolment error is found and fixed:** a school that imported its roll in our own numbering (`RHA-2026-0001`…`0409`) left the ID counter at zero, so every direct enrolment minted a number the roll already held and died on the unique index — 409 times over, one number burned per attempt. `generateStudentId` now reconciles the counter past the roll once, and the request that failed returns `RHA-2026-0410`. All four fixes clicked through against the live database; two probe students enrolled and deleted, fixtures back where they were. | **Print one of each document on real A4** — unchanged. Then Sprint 11. |
| 2026-08-10 | **Bulk switches made honest, dead Settings link removed** (§5s). Two things the user found on `/super-admin/modules`. Every Phase 1 module reported "on everywhere" beside a switch reading *Leave* — both statements true, the pair indefensible. The third position is gone: a switch is On or Off, opens on what the selected schools actually hold, and the safety "Leave" bought is now bought by the **baseline** — only switches moved away from the loaded state are sent, so an untouched flag still never reaches the database. Mixed selections light neither side (the badge already said "on at 1 of 3"), moved switches are ringed, and moving one back leaves zero changes rather than two. Also removed the `Settings` sidebar entry, which pointed at a route that was never built and is on no roadmap. Verified in a browser against the live database: the payload for one moved switch carried exactly that one flag, and re-reading the school afterwards showed the new baseline with nothing left to apply. Reverted; fixture unchanged. | **Print one of each document on real A4** — unchanged, still the only thing between here and a printed-document sign-off. Then Sprint 11. |
| 2026-08-10 | **Dress rehearsal started** (§5r) — of Sprints 0–10, not of R1, which cannot be rehearsed because Sprints 11–13 do not exist. Extended the seed with a full published examined term (50 papers, 2,121 marks, 63 absences, 76 re-sits) and a fortnight of registers, because none of the four printed documents could be produced without one. **All four render and are correct**: the report card excludes the unpublished paper from its list *and* its denominator, prints `ABS` and refuses a position to anyone absent; the tabulation sheet daggers the unpublished paper and includes it, being a review document; the admit card carries all five, being a datesheet. Three defects: the suggested grading ladder had no band below 33%, so a genuine fail printed a blank grade beside a passing A; the seed's own marker was printing on every fee challan, having been put in the postal address; and class names were ambiguous across campuses for the fourth and fifth time, which is what finally moved the rule into `lib/class-labels.ts`. | **Print one of each on real A4.** It is now the only thing left before the printed documents can be signed off, and it needs a person with a printer. Then Sprint 11. |
| 2026-08-10 | **Sprint 10 complete, every piece clicked** (§5q). Transfer and family vouchers verified against the seeded school, and doing it found the sprint's most consequential defect: `student_enrollments` was uniquely indexed on (student, year), so a transfer — which by design opens a second enrolment in the same year — failed at the database every time. Editing the row in place would have been worse, because `attendance_records.enrollment_id` points at it and a register taken at the old campus would afterwards claim the new one. Migration `0019` makes the index partial on `status = 'active'`: one *placement* at a time, closed rows accumulating as history. Also: the transfer picker had promotion's year-duplication defect (written twice, seen once), and family vouchers could be issued but not paid — the route distributed a payment across the children's challans and no screen offered to record one. | **Print one of each document on real A4.** It is now the largest unverified thing in the project, and has been since §5n. Then the dress rehearsal. |
| 2026-08-10 | **Sprint 10 feature-complete** (§5q). Promotion, transfer with proration, family vouchers, the aged-debt report and the adversarial seed — 409 students, 10 classes, 2 campuses, 3 years, 3 months of challans, with siblings, missing emails, mid-term joiners, partial payments, concessions and names carrying commas and non-ASCII. Promotion and the aged-debt report were run against that data and seven more defects came out of it, **three of them the same performance defect in three different features**: a loop of single-row writes, which against Supabase is one round trip each. Saving and applying a 128-student promotion was nearly 400 of them inside a held-open transaction; set-based it is four statements and 20 seconds. Also: promotion offered *earlier* years as destinations, destination classes appeared once per academic year, "Grade 5" was ambiguous across campuses, and re-opening an existing run said "Something went wrong". | **Click transfer and family vouchers** — both are built and neither has been run, and the seeded school has the second campus and the 36 sibling families they need. Then the dress rehearsal. |
| 2026-08-09 | **Sprint 10 started** (§5q) — migration `0018` applied and verified, three permission keys, and the CSV student import built and browser-verified end to end against a deliberately hostile file. Three defects the build could not see: the dry run was one round trip per row (25 seconds for seven rows, unusable at the 2000 it accepts — now one statement whatever the size); a duplicate admission number went unreported whenever the row also had a second fault, so it surfaced only after the operator fixed the *other* problem and re-uploaded; and the supplied admission number was used to detect duplicates and then discarded, which would renumber a migrated roll and break its link to every fee receipt and certificate the school holds. Also measured: ~2.4s per round trip to Supabase from this machine, which is why the commit loop must be re-timed once deployed rather than judged from here. | **Promotion, transfer, family vouchers, the defaulter list, and the adversarial seed** — the rest of Sprint 10. The seed is what first produces a file big enough to test the importer at real size. |
| 2026-08-09 | **Three QA fixes from the user** (§5p), merged to `main`. School administrators can now delete members — the route had answered 405 while the Super Admin panel had done it since §5h — singly and in bulk, per-row rather than all-or-nothing because a `NO ACTION` foreign key would otherwise let one referenced member refuse ninety-nine. **The selected branding template reached one colour out of five**: `PalettePreview` had always drawn a five-colour portal and the shells consumed only `primary`, painting `bg-slate-50` over a set-and-unread `--brand-background`. All four shells now match the preview, with three computed `--brand-on-*` foregrounds so a school with a pale primary does not get white lettering on it. And the status filter, which offered two values against a table that drew three, so "Active only" also returned everyone who had never signed in; status is now three-valued from `auth_user_id`, and role/branch/status are faceted — each offers only what the others leave, with counts. Browser-verified against the live database; nothing left behind. | **Sprint 10** — onboarding: CSV import, promotion, transfer, family fees, and the seeded adversarial school. Note `SPRINTS.md` says migration `0017` for it and that number is taken: **next free is `0018`**. Trigger the referential delete refusal against that seeded school (§5p), since losing a row there costs nothing. |
| 2026-08-09 | **Sprint 9 QA fixes** (§5n). Four defects back from QA, all fixed. The big one was not Sprint 9's: `PrintSheet` hid the print root with an unqualified `display: none`, so **every printed document in the application — fee challans included — had been coming out blank since the framework was written two days earlier**, and nobody had run a print to find out. Cured at the framework level in `globals.css`. Also: a paper's total can no longer be lowered below a mark already awarded (QA printed 178% on a report card), a school's first grading scheme now becomes its default instead of silently grading nothing, and the tabulation sheet's printed legend no longer states the absence policy backwards. typecheck + lint + build green again. | **Print one of each document on real A4** — the cascade is right but no paper has been produced, and no test school has a logo, so only the name-only letterhead has ever rendered. Then remove QA's three leftover rows (SQL in §5n) — a DevOps step, not a developer one. |
| 2026-08-09 | **Sprint 9 built** (§5n) — the keystone. Six tables (migration `0016`, **written not applied**), nine API routes, eight admin screens plus two teacher ones, and the three printed artefacts: report card, tabulation sheet with position holders, and admit card, all on `PrintSheet`. Marks entry is one paper for one section on one screen, with save-as-draft, submit, and a publish step the teacher cannot take or undo. Grading is per-school bands resolved by a dependency-free `lib/grading.ts` the editor and the report card both call. Re-sits are attempt 2 of the same paper with their own publication lifecycle. Five permission keys in both catalogues. typecheck + lint + build green. | **Apply `0016`** (DevOps), then QA it in a browser — none of it has been clicked, and §5j is the standing evidence that matters. Then Sprint 10, which is the one not to compress. |
| 2026-08-08 | **Sprint 0 built** (§5m) — rate limiting, account lockout and the email outbox, on `feature/sprint-0-auth-hardening`. New `auth_attempts` and `email_outbox` tables (migration `0015`, **written not applied**), `lib/auth-throttle.ts` on all five auth endpoints, `lib/email-outbox.ts` with a `FOR UPDATE SKIP LOCKED` claim, an `instrumentation.ts` interval drainer and a secret-guarded `/api/internal/email/drain`. Every screen that used to claim "sent" now says "queued", because that is now all it knows. Corrected `SPRINTS.md`: Sprint 0 does need a migration, and Sprints 9–21's numbers each shifted up by one. typecheck + lint + build green. | **Apply `0015`** (DevOps), then exercise a lockout and a drain in a browser. Then Sprint 9 — it is the keystone and everything in R1 waits on it. |
| 2026-08-07 | Surveyed codebase, established STATE.md, scoped both migrations, identified the Edge-middleware DB hazard. | — |
| 2026-08-07 | **Stage 1 complete.** Neon → Supabase Postgres: postgres-js driver, Edge-safe REST tenant lookup, all 15 `db.batch()` sites converted to real transactions, `next/image` Supabase host fix, `output: 'standalone'`. typecheck + lint + build all green. | — |
| 2026-08-07 | **Stage 3 documented.** User confirmed Hostinger supports Node.js and auto-issues HTTPS per subdomain. Wrote `DEPLOYMENT.md`; corrected the operator-facing strings in the storage diagnostics route to name Hostinger. | — |
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

## 5ar. Sprint 13.7 — parent accounts, period schedules, colours, teacher calendar — 2026-08-20

Four items the user asked for, and one defect found while building the first.
The found one is the largest single gap this file has recorded.

### 1. No parent could reach the parent portal, and nothing said so

The report was "when I create a parent, the father did not get a welcome email".
The email was the smaller half.

`student_guardians` held name, relationship, phone, email, CNIC, occupation.
`school_users` — the only table `lib/school-auth.ts` will authorise a request
against — held nothing for a guardian, and **no code path had ever written one**.
Sprint 13 shipped the parent portal: six screens, routed, permissioned, with an
attendance calendar and printable report cards in it. Not one parent at any
school could open it. The profile page said "No portal account" beside every
guardian in the system and nothing on screen implied that was a state anybody
could leave.

`lib/parent-portal-access.ts` is the missing half. It opens the `parent` row,
links it to **every** guardian record carrying that phone number — a father
against three children is three rows, and the portal follows all of them to find
his children — and queues the first-time setup email through the same
`lib/access-email.ts` staff have used since §5g, with parent wording and the
children named.

`student_guardians.welcome_email_sent_at` is what stops a family of three
receiving three welcomes, and what makes the fee gate safely re-enterable.

#### ⚠ The collision this uncovered, which was live and silent

`enrollStudent` gave the **child's** `school_users` row the primary guardian's
mobile, falling back to a `student:<admission-no>` sentinel only when the number
was already taken. That table is unique on (location, phone). So the father's own
parent account, created later when the fee cleared, would have upserted **onto
his daughter's directory row** — writing his email address onto her record and
linking him to an account that was never his.

The sentinel is now unconditional. A number belongs to the person who answers it,
and nothing in the product ever looked a student up by their guardian's phone —
the number a school rings is on `student_guardians`, where it always was.

### 2. The fee gate, and why it is not a fifth enrolment status

The user's rule: a new student counts as enrolled once their fee is paid, and
that is when the parents are welcomed. Only for new students.

The obvious implementation is `student_enrollments.status = 'pending_fee'`. It is
wrong, and expensively so. `status = 'active'` is what the register, the
promotion run, the class lists, the challan generator and nine reports filter on.
A child admitted Monday and paying Friday would be invisible to every one of them
for four days — **including to the challan generator that would have produced the
bill they were waiting to pay**, which makes the state unleavable.

So `fee_status` is a second column. The enrolment is real from the moment it is
written; what is conditional is whether it has been *confirmed*.

**It clears when the student holds at least one challan and none is still open.**
Both halves are chosen:

- *at least one* keeps a child admitted five minutes ago outstanding. Without it
  zero challans reads as zero debt and every admission clears itself instantly —
  the exact opposite of the rule.
- *none still open* rather than "the admission challan is paid", because this
  product has **no admission-fee challan type**. What a school is owed is the sum
  of its open challans. `cancelled` and `waived` are closed on purpose: a waiver
  settles an account as surely as cash, which is the only thing that will ever
  clear a scholarship admission.

`POST /api/school/students/[id]/fee-clearance` is the escape hatch and is not
optional. A large share of the schools this product is for take the admission fee
in cash across a desk and never raise a challan. Without the button their gate
would never fire and their parent portal would be empty **permanently**, with
nothing anywhere to fix it. Costs `fees.write`; one-way, because it sends email
to real people.

**Existing rows were back-filled to `cleared`.** Those children are already at
school. Re-opening settled admissions would invent a debt for every family and
fire a welcome at the entire parent body on the first payment that landed. The
bulk import passes `cleared` for the same reason — a migrated roll is not a queue
of new admissions.

### 3. Period structures — one bell schedule was one too few

`timetable_slots` was uniquely keyed on (location_id, order_index) and its own
comment explained why: "a school rings one bell". True of a school with one set
of children in it. False the moment the same school teaches Pre-Nursery and Class
10 on one campus — the infants sit three long periods and go home, the seniors
sit eight short ones. Under that key **the second schedule a school entered was
refused as a duplicate of the first**, and the junior grid carried five rows that
could never be filled, every one an invitation to click.

`period_structures` are named; `period_structure_grades` assigns grades to them.
Grades and not sections because nobody rings a different bell for 5A and 5B — and
because a new section is then timetabled correctly the day it is created.

One structure per school carries `is_default`, enforced by a partial unique
index, and an unassigned grade runs on it. That is what makes the migration a
no-op: every school with periods got one "Standard" schedule holding them, **no
grade assignments were written**, and a one-bell school never learns the feature
exists.

The unique index moved from (location_id, order_index) to (period_structure_id,
order_index). `POST /timetable/entries` now re-resolves the section's structure
and refuses a slot from another one — without it, a stale tab left open across a
reassignment would write a row that satisfies every constraint and appears in no
grid, which is the worst kind of accepted write.

#### ⚠ Reassigning a grade does not carry its timetable

Confirmed by driving it: moving Pre-Nursery onto "Junior school" left its two
existing lessons filed against Standard's slots, invisible. **Nothing is
deleted** and moving the grade back restores them, but a grid that silently went
blank is indistinguishable from one that lost a term's work. The builder now
counts the undrawable entries and says so. Deliberately not auto-migrated: there
is no honest mapping from "period 3 of the senior day" to anything in the junior
one.

### 4. Custom subject colours, and a palette colour that was never legible

The column always accepted any `#rrggbb` — `isHexColor` has guarded it since
Sprint 6. Only the form was closed. `SubjectColorPicker` keeps the eight presets
first and adds a native picker plus a hex box, previews a **real grid cell** at
real size with the lettering `readableForeground` will actually compute, and
warns below 4.5:1 or on a shade close to another subject's. Warns, never refuses:
a school with a house colour has a reason this product has no standing to
overrule.

Asserting that caught a live defect. **`#db2777` reached only 4.39:1** against
either candidate lettering colour and had been in the shipped palette since
Sprint 6. No build, type-check or screenshot had ever objected. Now `#be185d`
(5.77:1). Stored colours are untouched.

Also corrected: both subject routes rejected a bad colour with "Choose a colour
from the palette", which stopped being true the moment the picker shipped.

### 5. The teacher calendar

`lib/teacher-calendar.ts` projects timetable rules onto real dates per range. Not
a table: 40 teachers over a 200-day year is 60,000 rows saying what 300 rules
already say, and every edit to a rule would rewrite the rest of the year.

Dates are handled as `YYYY-MM-DD` through **UTC midnight** on both server and
client, never a local `Date`. "Monday 9am" is Monday 9am in Lahore whichever
continent the server is on, and a server-local `Date` would put Friday's last
period on Saturday for a school six hours ahead. Same reason `timetable_slots`
stores times as text.

Lessons sort by the **clock**, not by `order_index`: a teacher on two schedules in
one day has periods whose positions are not comparable — position 3 is 10:00 on
one and 11:20 on the other.

`academics.read` gates the route, which is what the timetable routes already
carry and they already return every teacher's name against every period — so a
colleague's *lessons* are not a disclosure. **Leave is**, so it goes only to
`hr.read` or to the teacher themselves.

⚠ **No school-holiday table exists**, so a day the school is shut still shows its
periods. Stated on the screen rather than implied away. When a school calendar
arrives it subtracts in this one file.

### `npm run check-sprint-periods` — 107 assertions, and it is in CI

The rules this sprint added are invisible to the type-checker and to a passing
build: calendar date arithmetic that is correct on the machine that wrote it and
wrong six timezones away; a subject colour whose lettering cannot be read; a
generated welcome that names a family's children and could say "Ayesha, Bilal"
or "Ayesha and ". It found the palette defect on its first run.

### QA — driven against the live database, 2026-08-20

An emergency login token was minted directly for the school administrator (the
Super Admin password is still the leaked one and is still unrotated), and every
path below was exercised through the running application's own API inside that
authenticated session:

| Checked | Result |
| --- | --- |
| New admission | `active` + `outstanding`; guardian unlinked, unwelcomed |
| Student directory row | `student:LGS-2026-0003` — the father's mobile left free |
| Part payment (2000 of 5000) | challan `partial`, enrolment **not** cleared |
| Balance (3000) | challan `paid`, enrolment cleared, **1 welcome queued** |
| The welcome | delivered (`sent`), names the child, carries `/set-password/<token>` |
| That link | set a password; `/parent/children` then showed the child |
| Guardian added to a cleared student | welcomed immediately |
| Guardian with no email | reported, not failed |
| Resend to somebody who has a password | returning-user wording, **not** a second setup link |
| Manual clearance, called twice | cleared once, then 409 — one mail-out, not two |
| Two schedules at positions 0–2 | accepted (impossible before) |
| Duplicate position inside one schedule | 409 |
| Grade assigned | its sections' grids followed it; 3 rows, not 4 |
| Unassigned grade | fell back to the default; 4 rows |
| Slot from the wrong schedule | 409 `wrong_structure` |
| Calendar day / week / month | correct; month = 42 days, whole weeks, Monday-start |
| Teacher across two schedules | both named, lessons in clock order |
| Custom hex subject | stored; `#7f1` and `red` refused |

**All QA rows were removed afterwards** — the database is back to one "Standard"
structure, 4 slots, 2 entries, 2 subjects, which is the state in the user's
screenshots.

#### ⚠ What was NOT verified, and why

**Nothing was looked at.** The preview browser in this environment does not
composite, so React's streamed content never swaps in: `innerText` returns empty,
the accessibility tree holds only the navigation, and `computer{screenshot}`
times out with "the Browser pane is not displayed". The pages' structure was read
out of the DOM and every rule was driven through the API, but **no screenshot of
any new screen exists** and the layouts have not been seen. Worth twenty minutes
of clicking before relying on them.

### Deployed, and the window this opened

Merged to `main` and pushed, which auto-deploys (§5v). Live and confirmed by
ten-sample route probes, as recorded in the header banner.

⚠️ **Note the ordering, because it has a cost.** The migration was applied
*before* the deploy, as it has to be. Between the two, the old build was running
against a schema where `timetable_slots.period_structure_id` is NOT NULL and the
old insert does not supply it — so an administrator adding a period in that
window would have hit an error. It lasted about a minute here and nobody was in
the system, but on a busier school it is real. There is no fix that keeps both
halves correct at once; what there is, is knowing to deploy immediately after
migrating rather than leaving the two apart.

Unrelated and pre-existing, seen in the dev log throughout: `[announcements]
sweep failed … Received an instance of Date [ERR_INVALID_ARG_TYPE]`, every 60
seconds. Not touched by this sprint. Worth a look.

---

## 5bb. Sprint 15 — one table primitive, thirty listings — 2026-08-23

Requirement 5 of Sprint 15: **every record listing on every portal has filters,
sorting toggled from the column title, pagination capped at 100 rows, and a
visible loader while a filter or page change is in flight.** No migration, no
new permission key — this is a UI and query-parameter sprint.

### What was built

**`components/ui/DataTable.tsx`** is the whole of it. It layers on the existing
`Table` and `Pagination` primitives rather than replacing either, and it runs in
one of two modes:

| Mode | For | State |
| --- | --- | --- |
| `client` (default) | rows already in the browser — fee types, salary components, the chart of accounts, one section's attendance | owned internally; never touches the network |
| `server` | listings that grow without bound — students, challans, applications, expenses, the day book, users, schools | fully controlled by the caller, which turns it into query parameters |

**`lib/list-query.ts`** is the server half. `readListQuery(search, { sortable,
defaultSort })` caps the page size at 100 and matches the sort column against a
whitelist the route owns. The cap has to exist on the server as well as in the
browser — a request typed into the address bar never runs the browser's code —
and a column name off the wire never reaches the query builder.

### Decisions — do not re-litigate these

**Sorting is type-aware, and `money` is one of the types.** Money is integer
paise everywhere in this codebase; sorted as text, 1000 comes before 900, and
the wrong number sits at the top of the fee report with nothing to say why.
`kind` on a column decides the comparator, and blanks sort last in *both*
directions — an absent value is not "the smallest".

**Empty and filtered-to-nothing are different screens.** `EmptyState` has drawn
that distinction since Sprint 10.5; this is what finally honours it on every
list. If any filter or the search box carries a value, the empty result offers
"Clear filters" and never "Add a student". Telling a school with 400 students
that it has none is the defect this prevents.

**A sort clears a multi-row selection, exactly as a filter does.** On the
challan register and both user tables the selection feeds a bulk action — print,
delete — and a re-ordered result set is a different set of rows. The rule was
already written for filters in STATE.md §5e; sorting joins it.

**Six components were deliberately not converted.** They render a `<Table>` and
are not record listings: `PermissionMatrix` (a role × permission grid),
`TimetableGrid` and `TimetableBuilder` (week grids — and the CLAUDE.md rule
about resolving a section's own period schedule is why paging one would be
worse than useless), `MarksEntry` and `FeeStructureMatrix` (entry matrices whose
row order is the thing being edited), and `StudentImporter` (a CSV preview
before a commit). Two more were left for the same reason inside components that
were otherwise converted: the salary-structure grid in `StaffDetailPanel`, whose
footer totals the rows above it, and the band editor in `GradingSchemeEditor`,
whose rows are unsaved drafts keyed by position. Sorting a form is not a
feature.

**`ReportTable` split rather than became a client component.** The printed sheet
must render every row in the report's own order with no controls on it; the
screen wants all four. `ReportDataTable` is the screen half, `ReportTable` keeps
the print half, and both read `definition.columns` — neither has a column list
of its own, which was the property Sprint 12 was built around.

**`StaffManager` moved the other way, to client mode.** A school's staff is
bounded by its payroll — tens, occasionally a couple of hundred — so the whole
directory arrives once and is searched in the browser. It was costing a round
trip per keystroke for a list that fits in memory several times over.

### API routes extended

All six stay tenant-scoped exactly as they were: `auth.locationId` from the
verified session, never from a parameter. Only sort, direction, page and size
were added.

| Route | Added |
| --- | --- |
| `GET /api/school/students` | `sort`, `direction`; page size now capped centrally |
| `GET /api/school/applications` | `sort`, `direction`, `page`, plus `total` in the response |
| `GET /api/school/fees/challans` | `sort` (including a computed `balance`), `direction` |
| `GET /api/school/accounting/entries` | `page`, `limit`, `direction`, plus `total` |
| `GET /api/school/accounting/expenses` | `sort`, `direction`, `page`, `search`, plus `total` and `approvedPaise` |
| `GET /api/school/users` | `sort`, `direction` |
| `GET /api/super-admin/schools` | `sort`, `direction`, `page`, plus `total` |

Two of those are worth calling out. **The day book used to answer with the most
recent 500 rows and say nothing about the rest** — a school in its third year
has more than that, and a silently truncated ledger is a set of books that does
not add up on screen. **The expense register's footer now totals every page of
the filter, not the fifty rows on screen**; the old one was a different number
on every page of the same register with nothing to say so.

### What is still open

- Nothing on the parent and student portals rendered a `<Table>`, so nothing
  there changed. When those listings arrive they get `DataTable`.
- The day book sorts on `entryDate` only. Its amount is a `SUM` over the lines,
  and a sort the server computes per page would disagree with itself between
  pages.
- `UserTable`'s status column is not sortable: the server groups it with a SQL
  expression for the facet counts, and a sort that disagreed with the counts
  beside it would be worse than no sort.

---

---

## 5bd. Sprint 16 — feedback, global search, and the second scrollbar — 2026-08-26

Test cases: `test-cases/TEST-CASES-SPRINT-16.md`. Release note:
`release-notes/RELEASE-NOTES-SPRINT-16.md`. Migration `0032` applied and
verified, and the sprint is **deployed and live as `47e072c1f058`** — see both
banners at the top. PR [#32](https://github.com/Haznain666/School-Managment/pull/32),
merged.

### What was built

Six requirements, and they divide into three real features and three fixes.

1. **Feedback, both directions.** A school administrator writes a bug report or
   a suggestion with up to five PNG/JPEG/PDF attachments; the platform operator
   is notified in-app and by email, reads a four-section queue, replies, sets a
   status or deletes. Every status change and every reply notifies the school
   the same two ways.
2. **Global search on all five portals**, each with its own scoped result set.
3. **School setup progress** on the school-admin dashboard — a bar and six
   headcounts.
4. Class strength and Recent exam outcomes, sized like every other chart.
5. Quick links, at the top of every dashboard, as chips.
6. The second scrollbar, removed.

### The migration is four tables and nothing else

`feedback_tickets`, `feedback_attachments`, `feedback_replies` and
`notifications`. Expand-only: no column changed, no row rewritten. It had to go
in before the merge for the reason §5aw records — both portal layouts grow an
unread-notification count, and a layout runs on every page of its portal.

Both layout reads are wrapped anyway. A bell with no badge is the correct
degradation; a portal that 500s is not.

### `notifications` is general, and that was the decision worth taking

The obvious move was to derive the bell from `feedback_tickets` — "count where
status = 'unread'". That works for exactly the first feature that needs it and
then has to be rewritten for the second.

An announcement is a *document* a school publishes; a notification is an *event*
that happened to one person. The two differ in every way that matters, which is
why `announcement_reads` was not widened either. `notify()` is the one door, and
it writes the bell row **and** queues the email in one call — two calls at each
site is two chances to forget one, and the one that gets forgotten is always the
mail, because the bell is the one you can see while developing.

**A failed notification never fails the thing that caused it.** `notify` logs
and returns. A school that has pressed Send has sent its feedback the moment the
ticket row exists.

### Attachments are private, in a public bucket

`school-assets` is public, so a stored public URL is a permanent credential-free
link to the object. A feedback screenshot is a picture of a school's own data —
a fee register, a roll — and that URL works for anybody who ever sees it,
including after the ticket is deleted.

Only the object *path* is stored. `lib/storage.ts` gained `downloadObject`, and
the two routes stream the bytes with `Content-Disposition: attachment`,
`X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`. The
headers live in one shared module (`app/api/school/feedback/attachment-response.ts`)
because they *are* the security posture of the endpoint and two copies drift.

`attachment` is also what the product owner asked for — clicking downloads — and
it is the safe disposition, since an inline PDF is a scriptable document running
on this origin. Do not "improve" it into a preview.

### Five search functions, not one with a role parameter

The whole risk in a global search is that it is the one feature whose job is to
reach across everything, and tenancy is the thing it must not reach across.
`search(query, viewer)` would put "may this person see a student" behind a
branch inside a shared function, and **the branch that is wrong returns results
rather than an error**.

So `lib/global-search.ts` exports five entry points, each readable start to
finish against one question: what does this person already have a screen for?
`lib/portal-search.ts` resolves a session into the right one, and both the API
route and the results page call it — the dropdown and the page cannot disagree
about what somebody may see, because one function decides it.

**Screens are a category**, built from `schoolNav`'s output. That is not
padding: it is the most-used category in every CRM that ships one, and feeding
it the caller's own navigation means a page result can never lead somewhere the
guard would bounce, without `searchPages` knowing what a permission is.

**ILIKE, not full text, and that is deliberate.** `tsvector` stems, and stemming
is exactly wrong for admission numbers, challan numbers and a section called
"5-A". Every query is capped at nine rows — one more than is shown, which is how
"there are more of these" is known without a second `count(*)`. When a school
arrives that this is slow for, the fix is a trigram index on the same columns.

`likePattern` escapes `%`, `_` and `\`. Without it, searching for `100%` matches
every row in the table.

### 🐛 The second scrollbar was made of screen-reader text

The product owner reported two scrollbars on the school-admin dashboard, the
outer one exposing a blank strip. Measured at 1280×720 on the *platform*
dashboard — so it was never school-admin-only:

    innerWidth - documentElement.clientWidth   = 15    (a real root scrollbar)
    documentElement.scrollHeight               = 1185  (viewport 720)

on a page whose every `<body>` child measured exactly 720.

**`sr-only` is `position: absolute`.** An absolutely positioned element is
clipped by an ancestor's `overflow` only when that ancestor is its **containing
block** — which means a positioned one. Nothing between those spans and `<html>`
was positioned, so their containing block was the initial containing block: they
escaped `<main>`'s `overflow-y: auto` and extended the *root's* scrollable
overflow to wherever they happened to sit.

The bottom-most one — the hidden `<figcaption>` summarising the schools-by-city
chart — sat at document y = **1185**. That is `scrollHeight` exactly.

`position: relative` on the scrolling `<main>` in `PortalFrame` and
`SuperAdminShell` is the whole fix. Verified: root scrollbar 15 → 0, root max
scroll 465 → 0, and the content keeps its own.

⚠ **A first attempt clamped the four portal layout wrappers with `h-dvh
overflow-hidden` and did nothing**, because those wrappers are not positioned
either. It was reverted rather than left in beside the real fix: a defensive
change carrying a wrong explanation is worse than no change.

### The two charts were the wrong width, not the wrong chart

`BarChart` and `LineChart` draw into a fixed 640×260 `viewBox` scaled to the
container. Class strength and Recent exam outcomes were full-width cards, so at
~977px the same drawing rendered at roughly twice the height of the eight charts
above it — thicker bars, larger labels, and a card that read as a different
component. Moving them into the existing `lg:grid-cols-2` was the entire change.
Measured afterwards: 479px card, 177px chart, identical to Collections.

### Decisions not to re-litigate

1. **Feedback is gated on no permission.** A `feedback.write` toggle is a switch
   no administrator has a reason to move, and the only thing it could do is stop
   somebody reporting a bug. Same judgement as `/me` and `/branches`. It also
   avoided widening the `role_permissions` CHECK — §5o records what happens when
   that is forgotten.
2. **Active is `unread` + `read`.** Opening a ticket must not make it vanish
   from the list of things still to decide. The product owner's rule, and it is
   stated once in `FEEDBACK_SECTION_STATUSES` so the listing, the counters and
   the dashboard tile cannot disagree.
3. **Only three statuses are settable.** `unread` and `read` are not decisions;
   offering them would let an operator put a ticket back into a state meaning
   "nobody has looked at this", and re-notify the school about a decision that
   had been unmade.
4. **`setFeedbackStatus` is a conditional `UPDATE … WHERE status <> $1
   RETURNING`.** Notify-exactly-once-per-real-change is then a property of the
   statement rather than of anybody remembering. A second click returns
   `changed: false` and sends nothing.
5. **`markFeedbackRead` is a claim, not a read-then-`if`** — CLAUDE.md's
   background-work rule applied to a different actor with the same race: two
   tabs, or a double-clicked link.
6. **The counter toggle is off by default.** A permanent "0" beside three of
   four headings is three numbers nobody reads, which would cost the fourth its
   meaning. Read from `localStorage` after mount, never during render.
7. **The dashboard tile counts `unread`, not `active`.** Active includes tickets
   somebody has opened and not yet decided about — already known, and a tile
   that stayed lit until every one was resolved would be lit permanently.
8. **A school cannot delete its own feedback, or set a status.** A bug report a
   school can delete is one that disappears the week before anybody looks at it.
9. **Deleting sends no notification.** "Your feedback has been deleted" answers
   nothing and reads as a rebuke. A school that wants a decision communicated
   gets one of the three statuses.
10. **The school's own list is a client-mode `DataTable`.** A school sends a
    handful of these a year; the whole list fits in memory several times over.
    Same judgement §5bb made about `StaffManager`.
11. **The platform reply is signed "SMS Platform Support".** A school that
    learns one operator's private mailbox will use it, which routes the next
    report past this table and into an inbox with no ticket and no status.
12. **`getSetupProgress` counts `> 0`, not a threshold.** "At least five
    teachers" is a number this code would have invented, and every school it did
    not fit would be told it was incomplete while working perfectly.

### 🐛 Five defects QA found, and one of them could only be found against real data

**Teachers read 0 at a school with a teacher on the register.** The step counted
`school_users` with role `teacher`. Lahore Grammar School has an active `staff`
record for a class teacher and **zero** teacher accounts — the person is on the
HR register and has never been invited to the portal. The panel told a school to
redo work it had already done, which is the single most misleading thing a setup
checklist can do. It now counts active staff records **plus** teacher accounts
with no staff record behind them, and the step is labelled *Teachers & staff*.

This is the §5ba lesson again in a new costume: **a green check script is not a
shipped feature.** `check-dashboard` ran `getSetupProgress` twice against a
tenant that belongs to nobody, and both runs were green.

The other four: the two full-width charts (above); `DataTable`'s default
no-choice filter option rendering "All nature" and "All school"; `StatTile`
announcing "All healthy — an improvement" to a screen reader on four tiles whose
delta states a condition rather than a movement (fixed with a `deltaKind` prop);
and a ticket submitted by the platform operator rendering a raw uuid where the
sender's name belongs.

Plus one measured in passing: the header search box had collapsed to **165px**
between a long school name and the sign-out control. It now has a 16rem floor,
and the role chip drops below `xl` to pay for it.

### ⚠ The browser pane does not paint streamed content, and it is not this sprint

Every route with a `loading.tsx` shows its skeleton forever in this pane. The
server produces the complete HTML — fetching it from inside the page and parsing
it returns the finished screen — and the trailing inline `$RC(…)` scripts that
splice a resolved Suspense boundary into the document never execute. Screenshots
fail for the same reason ("the Browser pane is not displayed").

**Proved environmental, not this sprint:** `/super-admin/modules`, a page this
sprint does not touch, behaves identically. §5bc records the same class of
problem. Two pages *did* paint — the school-admin dashboard and the platform
dashboard — and everything measurable in the DOM was measured on those.

So the QA method was: fetch the server HTML and parse it for every screen, and
drive every endpoint from the page's own JS with the real session cookie. That
produced stronger evidence than clicking would have — a real submission with a
real PNG and PDF, byte-exact round trips, two-school tenancy isolation, and the
notification and email rows read out of the database afterwards.

### How to sign in for QA, and the trap in it

**`gh` IS on PATH now** (`/c/Program Files/GitHub CLI/gh`), contradicting §6
item 1. PR creation still needs a push, which is why there is no PR here.

There is no plaintext Super Admin password anywhere in this repository and there
must not be. What worked: mint a **local-only** hash into
`.env.standalone.local` — a gitignored file that exists to run the built
artefact on this machine — and sign in with a password chosen for the session.
`.env.local`, the hosting panel and the live deployment are untouched, and
nothing built from this repository reads that file.

From there, *Login as Admin* opens any school's portal without ever handling a
school member's own credentials. On localhost the tenant comes from `?school=<slug>`
or the `school_slug` cookie, so `/dashboard?school=lgs` works.

⚠ **`.env.standalone.local` exists because one file cannot satisfy both
loaders** — §5bc trap 4. `@next/env` runs dotenv-expand and needs `\$`; `node
--env-file` does no expansion and needs the raw hash. `.claude/launch.json` now
carries an `sms-platform-qa` entry pointing at it. Regenerate it by stripping
quotes and unescaping `\$` out of `.env.local`.

### The tightening pass before the deploy, and the one real defect in it

Asked to make the code tight before it went live. Five changes, and the first
was a bug the QA run had not exercised:

1. **The platform listing re-fetched page 1 on mount.** The guard against it
   used `useState`, and `setMounted(true)` is itself a state change — so the
   effect ran again with `mounted === true` and issued the exact request the
   guard existed to skip. It is a `useRef` now. A ref does not re-render, so
   there is no second run to guard against.
2. **A value reached the driver through a raw `sql` template.**
   `coalesce(read_at, ${now.toISOString()})` in `setFeedbackStatus`. It *worked*,
   because the value was already a string — which is precisely what makes it the
   wrong thing to leave in the tree: the next person to write `${now}` there
   gets `ERR_INVALID_ARG_TYPE` and no column name to go on, which is §5at's
   announcement bug exactly. It is `now()` now, with no parameter at all.
   Re-verified live: setting a status *without* opening the ticket first still
   stamps `read_at`, and the notification and email both went.
3. **`attachment-response.ts` moved to `lib/`.** It sat inside the school route
   tree and the platform route reached across into it with `@/app/api/…`.
4. **Four `as never` casts removed from the search scope helper.** It took a
   column argument it did not need — every scoped query in that module narrows
   on `sections.grade_id` — and a cast at a call site is how the wrong column
   eventually reaches a function whose whole job is a boundary.
5. **Dead exports trimmed** from `lib/feedback.ts`: a re-export block nothing
   imported, and `sectionForStatus`, which had no caller.

All fifteen gates re-run green afterwards, and the changed write path was driven
against the live database again before the push.

### What is NOT done

- **The teacher, parent and student portals were not signed into.** No account
  for those roles exists on the live tenant. Their search scoping is one
  `inArray` over a list an existing check-covered query returns, and all three
  pages refuse the wrong role (verified: three redirects, no 500s) — but nobody
  has held one of those logins.
- **No screenshots exist**, for the reason above.
- ~~Nothing is pushed.~~ **Pushed, merged and live** — see the banner.
- **Search does not cover** exams, payroll runs, lesson plans, expenses or
  ledger entries. The *Screens* category finds those screens by name.
- **No attachments on replies.**
- **`sr-only` overflow was not swept across the whole product** — only the two
  scroll containers every portal screen renders inside, which is where it
  matters.

## 8. Working agreement

- **Update this file at the end of every development step.** It is the contract
  that makes running out of context safe.
- **Write release notes at the end of every sprint** — `release-notes/`, one
  file per sprint, named `RELEASE-NOTES-SPRINT-NN.md`, and add the row to
  `release-notes/README.md`. The user asked for this on 2026-08-15. It is a
  different document for a different reader than this file: what a school gets,
  stated as outcomes. Say plainly what is not usable yet — an unapplied
  migration, a screen with no page — because a release note that omits that is
  the kind of claim this file exists to prevent.
- Keep §3 (state), §6 (blockers) and §7 (log) truthful — a stale STATE.md is
  worse than none.
- `README.md` is out of date (still describes Sprint 1, Firebase Storage and
  Neon). Its deploy section now names Hostinger, which is correct; the rest of
  its stack table is not. Refresh it in one pass rather than editing it twice.

---

## 5bc. Sprint 15 QA — what was measured, and the traps that cost the time — 2026-08-23

Test cases: `test-cases/TEST-CASES-SPRINT-15.md`. Release note:
`release-notes/RELEASE-NOTES-SPRINT-15.md`. Merged to `main` as `9dfb735`
(PR #27). Migration `0031` applied and verified — see the banner at the top.

### The merge was the risk, and it was checked as one

Three developers built §5az, §5ba and §5bb on **separate branches**, each green
on its own, and none had ever been compiled against the other two. All twelve
gates were therefore re-run on the merged tree, not trusted from the branches.
They pass.

Two of them independently wrote a section numbered `§5az`, and **git merged both
without a conflict** because they sat far apart in the file. A clean merge is
not a correct one. They are now §5az, §5ba, §5bb.

### Two defects found and fixed

**A delta of zero was announced as an improvement.** `+0` rendered in success
green with `<span class="sr-only"> — an improvement</span>` beside it. A
screen-reader user was told the platform had improved in a month when no school
was added. Six tiles: `deltaMeaning="good"` hardcoded on two Super Admin tiles,
and `>=` mapping **equality** to `good` on four School Admin ones. Equality now
resolves to `neutral`, which `StatTile` already renders muted.

**`new Date().getFullYear()` in the School Code hint.** Evaluated once on the
server and again in the browser, in different timezones; around New Year they
disagree and a differing text node discards the server render of the whole form.
Hoisted to a module constant.

### React #418 on create-mode forms is PRE-EXISTING — measured, not assumed

`/super-admin/schools/new` and `/super-admin/schools/[schoolId]/branches/new`
throw a hydration mismatch. The edit page and the dashboards do not.

**Commit `5385689` — the merge immediately before this sprint — was built in a
scratch worktree and reproduces the identical error on the identical page.** So
this sprint's changes to `BranchForm`, `SchoolForm` and `AddressAutocomplete`
did not introduce it, and the new portal cannot: it is mount-gated and renders
nothing on the server *and* nothing on the first client render. Fetching the
server HTML from inside the page and diffing its `<form>` text against the
hydrated DOM showed them byte-identical (1014 chars), so it is not stable render
output either. It has its own task; do not re-diff those three files.

### Four environment traps, each of which cost real time

**1. `next start` does not work with `output: standalone`.** It prints that and
then serves an incomplete asset set. Use the new `sms-platform-standalone` entry
in `.claude/launch.json` (`node --env-file=.env.local .next/standalone/server.js`),
and remember `.next/static` must be copied into `.next/standalone/.next/static`
after every build.

**2. Stop the server before rebuilding.** `rm -rf .next` fails with *Device or
resource busy* while the standalone server runs out of `.next/standalone`. The
build that follows is silently corrupt and renders as a page stuck permanently
on its loading skeleton. Two builds were lost to this before the cause was seen.

**3. These pages take longer than 2.5 seconds to stream.** Against a remote
Supabase from a development machine, `/super-admin` and `/super-admin/schools`
need more than that to finish. **Sampling the DOM earlier reads the `loading.tsx`
skeleton and is indistinguishable from a hung page.** A long stretch of this
session was spent diagnosing a defect that did not exist because of exactly
that. Poll to a stable value; never read once.

**4. `.env.local` needs two incompatible escapings.** `@next/env` (used by
`next dev` and `next start`) runs dotenv-expand, so every `$` in
`SUPER_ADMIN_PASSWORD_HASH` must be written `\$` — 63 characters. `node
--env-file` does no expansion and needs the raw 60-character hash. One file
cannot satisfy both; swap it for whichever server you are running.

Also: the dev server in this worktree is broken independently, with a webpack
`Cannot read properties of undefined (reading 'call')` on every page. The
production build is unaffected. Not diagnosed.

### What was NOT verified

Two entries that stood here on 2026-08-23 have since been closed against the
live deployment, and are kept below with their evidence rather than deleted —
what was checked and how is the part a later session needs.

- ✅ **The Mapbox dropdown, closed 2026-08-24.** `NEXT_PUBLIC_MAPBOX_TOKEN` *is*
  set in hPanel. Typing `gulshan` into Street Address on the live wizard, the
  listbox reported `parentElement === document.body`, **`insideOverflowHiddenCard:
  false`**, `position: fixed`, `zIndex: 1300`, 726px wide and fully on-screen,
  with one option: *Gulshan-E-Iqbal — Karachi, Karachi East, Sindh, Pakistan*.
  That is the same query and the same suggestion as the product owner's original
  screenshot, now rendering outside the card. `aria-owns` was present, so the
  relationship the portal broke is restated. Read out of the DOM rather than
  photographed, which is the stronger evidence here.
- ✅ **The wizard past step 1, closed 2026-08-24** — by the product owner, who
  created **Beacon House School System** through it on production. Step 1's field
  order and labels rendered exactly as specified, and both the school and its
  branch were created, which also exercised step 2.
- **BR4 was not driven as a signed-in principal** — no principal account exists
  on the live tenant. Asserted by `check-portals`, and every aggregate runs both
  scoped and unscoped in `check-dashboard`, but neither is a person signing in.
- **Teacher, parent and student dashboards were not opened as those roles.**
- **No screenshots exist from the QA pass.** The browser pane would not composite
  frames, so every observation is from the accessibility tree, page text, the DOM
  and the network log. (The live checks on 2026-08-24 ran through the operator's
  own Chrome, where screenshots worked.)

### Mail delivery: the invitations were built correctly and could not leave

Creating the second school sent nothing to either the school admin or the branch
admin. **The wizard was not at fault, and neither was Sprint 15.** Both messages
were written to `email_outbox` at the right moments — the school admin's three
seconds after the school row, the branch admin's on completing step 2 — and both
sat there with:

    Invalid login: 535 5.7.8 Error: authentication failed: [EAUTH]

**The mailbox password was never wrong.** A real `verify()` against
`smtp.titan.email:465` as `contact@codexmill.com`, using the value in the local
`.env.local`, authenticated on the first attempt — 17 characters, SHA-256
fingerprint `3e92ffa00be4`.

What was wrong was what production held, and the `[smtp]` boot line said so
outright once anyone looked at the runtime logs:

    production:  [smtp] SMTP_PASS_B64 decoded cleanly (31 chars)
    local:       [smtp] SMTP_PASS_B64 decoded cleanly (17 chars)

**Thirty-one characters against seventeen: two different passwords.** It decoded
*cleanly*, so none of the corruption defences in `lib/smtp-credentials.ts` had
anything to catch — the value was intact, valid base64, and simply stale.

**And hPanel had both `SMTP_PASS` and `SMTP_PASS_B64` set.** `SMTP_PASS_B64`
wins (`lib/smtp-credentials.ts:119`), so a correct `SMTP_PASS` would have been
silently overridden by the stale one. Both were fixed: `SMTP_PASS_B64` replaced
with the working value and `SMTP_PASS` **deleted**, which is what the module's
own warning text asks for and removes the shadowing trap entirely.

Confirmed end to end: the boot line now reads `(17 chars)`, both messages sent at
02:02:51 and 02:07:51, and the outbox is **5 sent, 0 queued, 0 failed**.

Three things to carry forward:

1. **That boot line is the diagnostic.** One integer — the decoded length —
   distinguishes "the right value arrived" from "a plausible wrong one did",
   and it exposes nothing. Read it before theorising. `/api/internal/smtp-check`
   gives fingerprints too, but needs `SUPER_ADMIN_DIAGNOSTICS_SECRET`, which is
   correctly unset.
2. **`EMAIL_MAX_ATTEMPTS` is 5, and both rows were at 4.** They sent on their
   *final* retry. Twenty more minutes and they would have been `failed` and
   needed the dashboard's *Requeue failed emails* control. When mail is broken,
   the queue is on a clock.
3. **Nothing had sent since 2026-08-20**, so the breakage long predated this
   sprint and these two were simply the first messages anyone waited for.

### The cache IS purged — and the verifier that said otherwise is fixed

**Purge the cache with the workflow, not the MCP.** The Hostinger MCP answers
`Unauthenticated` and cannot do it. `gh workflow run "Verify the live
deployment"` can, and did — it holds `HOSTINGER_API_TOKEN` as a repository
secret. Prerendered pages ship `s-maxage=31536000`, so this is not optional
after any deploy. Do not conclude "I cannot purge the cache" without trying it.

**That run then reported a stale deploy that had shipped**, which is the precise
false claim the workflow exists to prevent — and the one this file records as
having cost a session before. `PRODUCTION_URL` carries a **trailing slash**, so
the probe requested `…//api/internal/build`, the host answered **308**, and
`curl -fsS` does not follow redirects — an empty body, read as "the running build
predates that route". It did not: `/api/internal/build` was returning
`{"buildId":"3f6f6d90dda8"}`, the exact merge, at that moment.

Fixed in `f46e36f` (PR #29): the base is normalised with `${PRODUCTION_URL%/}`,
redirects are followed, the URL and HTTP status are printed, and **the error no
longer asserts a cause it has not established** — a wrong URL, a redirect, a
timeout, an outage and a genuinely old build all look identical from there, and
four of the five are not about the deploy.

Re-run afterwards: `status: 200`, *Confirm which commit is live* **success**, and
every step green including the smoke test — the first fully-passing run of that
workflow.

### The one live action still outstanding

**Both schools need Provision pressed.** `Lahore Grammar School` and
`Beacon House School System` each sit at `failed`. That, not a migration, is what
clears the recorded error — the fix changes how *future* attempts are recorded
and deliberately does not rewrite history.

The blocker is gone: the hosting API token in hPanel was **expired**, which is
why both rows read `HTTP 401 Unauthenticated` rather than the 429 the original
screenshot showed. It was replaced on 2026-08-24 and the site redeployed, so a
press should now succeed.

> **The 401 was itself a useful result.** The message rendered as
> *"Hostinger refused the request (HTTP 401). Unauthenticated. (ref a292cdb0-…)"*
> — one plain sentence with the correlation id demoted to `(ref …)`, which is
> exactly what §5az's `summariseResponseBody` was written to produce. Before this
> sprint that cell held a raw JSON blob. The presentation fix is therefore
> confirmed live, on an error nobody arranged.

**Keep the two Hostinger tokens in step.** There are three copies of that
credential and they expire together: hPanel's `HOSTINGER_API_TOKEN` (used by the
running app to provision subdomains), the GitHub Actions secret of the same name
(used by *Verify the live deployment* to purge the CDN), and the four
`hostinger-*` MCP entries in the operator's `~/.claude.json`. On 2026-08-23 the
local copy was dead while the Actions copy still worked, which is why the cache
purge succeeded on the same day provisioning 401'd. Updating one is not updating
the others.

---

## 5be. Sprint 17 — onboarding, the admission fee, and the discount that never applied — 2026-08-27

Spec: `SPRINT-17-SPEC.md`. Twelve items reported by the product owner after
driving the school-admin and principal portals against Lahore Grammar School.
Migration **`0033` is APPLIED and verified** —
`db/migrations/0033_sprint17_student_credits.sql`. 33 bookkeeping rows before,
**34** after; 19 structural assertions, and every new constraint made to *fire*
inside its own `SAVEPOINT` and rolled back.

**DEPLOYED AND LIVE as `51c185f367cd`**, PR
[#33](https://github.com/Haznain666/School-Managment/pull/33), merged. Test
cases: `test-cases/TEST-CASES-SPRINT-17.md`. Release note:
`release-notes/RELEASE-NOTES-SPRINT-17.md`.

### ⚠ The live origin was unreachable for ~40 minutes and it was NOT the deploy

After the merge, `/api/internal/build` returned `status=000` — a TCP connect
that never completed — for twelve consecutive probes across both IPv4 and IPv6.
The temptation is to read that as a broken deploy. It was not:
`codexmill.com` and `staging.codexmill.com`, two sites this deploy never
touched, failed **identically**, while `example.com` and `google.com` answered
200 in under half a second. Hostinger's own API reported the build `completed`
at 12:22Z with both new routes in the manifest.

It came back on its own and answered `{"buildId":"51c185f367cd"}` in 2.4s. This
is §5bc's lesson again and the rule holds: **read the status code before
concluding anything about the deploy — `000` is the network, not the build** —
and check a sibling site on the same host before blaming your own change.

### The four defects QA found, none of which a gate could have caught

Every one needed a real voucher raised against real data.

1. **The admission voucher was born overdue, and that silently killed the
   discount.** `admissionDueDate` applied the school's due day to the *current*
   month, so a voucher raised on the 27th fell due on the **10th** — seventeen
   days in the past. Concessions are priced against the due date, and LGS's
   sibling discount starts 2026-08-26, so it was silently dropped: the voucher
   billed **50,000 with `concessionAmount: 0.00`**. That is item 8's exact
   complaint resurfacing through the new route, which is the thing to remember —
   *fixing a rule in the calculator did not fix it at every call site.* The due
   date can no longer be in the past, and an admission anchors its concessions
   on **today**, the anchor `findAdmissionPrice` already used. The panel and the
   voucher could disagree before; now they cannot.

2. **Cancelling a voucher stranded the student.** `resolveAdmissionFee` counted
   `cancelled` among the closed statuses, so the panel called the admission
   settled and no corrected voucher could ever be raised — while
   `fee_challans_admission_once_idx` is deliberately partial on
   `status <> 'cancelled'` to permit exactly that. **The screen was refusing
   what the schema permitted.** Two statements of one rule that had drifted.

3. **The carry-forward never happened.** The per-line clamp in
   `concessionPaiseFor` discarded the excess before anything could bank it, so a
   fixed 60,000 against a 50,000 fee floored the voucher at zero and the
   remaining 10,000 ceased to exist. Proven live: `creditGranted: "0.00"`. The
   calculator now returns `{ applied, excess }` and `calculateChallanLines`
   surfaces the total; all three write paths bank it in the same `batch()`.

   ⚠ **The first version of that fix had its own bug, caught before it shipped.**
   `repriceOpenChallans` runs on every concession write — create, amend *and*
   delete — so granting the recomputed overflow each time would have handed the
   parent another 10,000 for every unrelated concession the school later
   touched, drifting silently. `grantedOverflowPaise` subtracts what is already
   banked against that challan. Repricing has to be idempotent with respect to
   credit or it is not safe to call as often as it is called.

4. **The refusal message contradicted the rule it explained.** Adding
   `guardian` to `FIRST_GUARDIAN_RELATIONSHIPS` left **four** hand-written
   copies of "father, mother or sibling" in the API, the form and the parser.
   The server accepted a legal guardian and then told the clerk who chose one
   that it would not. `firstGuardianChoices()` derives the sentence from the
   constant.

### And one defect found in code review, before QA

"One admission, one admission fee" was a read followed by an insert, and the
unique index that catches this for a monthly challan **cannot see an admission
voucher at all** — it carries a null `billing_month` by design, and Postgres
treats nulls as distinct. Two clicks would have produced two vouchers *and*
spent the student's credit twice. `fee_challans.challan_kind` exists so
`fee_challans_admission_once_idx` has something to be partial on.

### 🐛 "The browser pane cannot paint streamed content" was WRONG, and it cost three sprints

§5bd, §5bc and the first half of this session all recorded the same belief: that
this environment's browser pane serves the request, receives complete HTML, and
then fails to run the trailing scripts that resolve a Suspense boundary — so
every route with a `loading.tsx` shows its skeleton forever and screenshots are
impossible. It was written up as environmental and worked around by fetching
server HTML and parsing it.

**It was not the pane. `next build` had never been finished.**

Next's standalone output *deliberately omits* `.next/static` and `public` — the
documented final step is to copy them in, and nobody ever had:

    cp -r .next/static .next/standalone/.next/static

Without that, the server returns 404 for every JS chunk and every stylesheet.
The page arrives as unstyled HTML with no client runtime at all, so of course
nothing hydrated, no Suspense boundary ever resolved, and no interactive element
was ever found. The symptom was read as a renderer limitation when it was a
missing `cp`.

After the copy, in real Chrome against the same build: the login form renders
styled, the school portal loads with LGS's own green branding and logo, the
enrolment wizard hydrates, `loading.tsx` skeletons resolve into content, file
inputs accept uploads, and screenshots work.

**So the standing advice is reversed.** Do not work around the pane. Copy the
static assets after every standalone build and drive the real UI. Add it to any
QA runbook that starts a standalone server. There is no `public/` directory in
this repository, so only the first copy is needed.

### How QA signed in

Super Admin login, then *Login as Admin* into LGS, and an operator **emergency
token** for the principal case — which is how item 2 was verified with a genuine
principal session rather than by reading the code. Sign-in was done by driving the real endpoints from the page's own
origin: Super Admin login, *Login as Admin* into LGS, and an operator
**emergency token** for the principal case, which is how item 2 was verified
with a genuine principal session rather than by reading the code.

A local-only bcrypt hash in `.env.standalone.local` was the credential. No
school member's password was handled.

**Everything was then verified by observation in real Chrome**, once the static
assets were copied: the guardian dropdown offers Father / Mother / **Guardian** /
Sibling and excludes *Other*; a chosen photo survives step 1 → 2 → 1 with its
thumbnail, name and *Remove photo* intact; a cancelled file dialog no longer
clears it; the upload lands (`photo_url` set); and *Change photo* on the profile
re-uploads and re-stamps the version. The fee-matrix zero round-trip is now
observed too: typing `0` writes a row with `amount = 0.00`, it reads back as
`0` after a reload while a cell with no row reads blank, and the Examination Fee
KPI moves 0/14 → 1/14 with the headline 73% → 74%. Blanking the cell deletes the
row and both revert. LGS was left exactly as found.

**A limitation, recorded not fixed:** cancelling a challan does not return the
credit it consumed.

### The measured result of items 2 and 12, live

Signed in as *LGS Defence Principal*, the setup panel reads **73%, 8 of 11** —
identical to the school administrator's, where it read 50% before. Eleven KPIs:
Principals **0/1**, Teachers & staff 1/1, Classes 14/14, Subjects 1/1, Timetable
**1/15**, Enrolled students 1/1, and one per fee head — Tuition, Admission,
Annual and Library all 14/14, **Examination Fee 0/14**. The mean of those eleven
is 73.3%, which is the headline, and eight are complete.

### The three defects that were confirmed against the live database first

Worth keeping, because each one explains a symptom that looked like something
else entirely.

| Fact | What it explained |
| --- | --- |
| LGS is `principal_model = 'multiple'` with **0 `principal_assignments`** | the principal seeing 50% where the administrator saw 100% |
| LGS's sibling discount is `applies_to_fee_type_id = NULL` | why it never reached the admission fee |
| LGS has fee structures on 14/14 grades for four heads and **0/14 for Examination** | a setup panel that said Fees ✓ |

`npm run check-dashboard` now prints those fee figures on every run, and they
came back exactly as measured.

### The one-line bug that cost the most

`lib/fee-calculator.ts`, `concessionPaiseFor`. A concession naming no fee head
matched `line.feeCategory === 'monthly'`. So *every* unqualified discount — "20%
sibling discount", the commonest thing a school writes — silently could not
reach an admission, annual or examination fee. It is now `true`: no head named
means every head. A monthly-only discount is expressed by naming the monthly
head, which has always worked and is the narrower, explicit case.

**Do not re-litigate this.** The narrow reading is not recoverable as a default:
a discount that does not apply is indistinguishable on screen from a discount
the school never granted, which is why it survived from Sprint 5.

### Setup progress is a school-wide fact and is never narrowed

`getSetupProgress` no longer takes an `AggregateScope` at all. Passing the
principal's scope is what produced the 50%: an unassigned head resolves to
`gradeIds: []`, and three of the six steps short-circuited on it.

`resolvePrincipalScope` was **not** relaxed — "no assignment" must never resolve
to "no filter", and the earlier note about that is right. What was added instead
is the sentence said out loud: an unassigned head now gets a warning callout at
the top of their dashboard linking to `/dashboard/settings`, rather than the
grey helper text that read as decoration.

Every *other* dashboard aggregate keeps its scope. This is one function.

### The setup panel is now per-KPI, and the headline is a mean

Each step carries `done`/`total`/`percent`/`complete`, and the headline is the
**unweighted mean of the step percentages** — not `completed / total`, which is
what it was and which reported a school with eleven KPIs at 90% as 0%.

Classes counts *grades with a section*, the timetable counts *sections with an
entry*, and there is **one KPI per fee head** — grades priced over total grades.
Teachers, Subjects and Enrolled students stay 1-of-1 on `> 0`, because any
denominator for those would be a threshold this code invented.

**A stored `0` is complete; a blank cell is not.** `fee_structures.amount` is
NOT NULL with a `>= 0` check, so the KPI counts rows and must never filter on
`amount > 0`. The matrix already round-tripped a zero correctly in both
directions (`String(Number('0.00'))` is `'0'`); its on-screen copy said the
opposite and was corrected.

The staff-plus-unlinked-accounts query is untouched. QA earned it (§5bd) and it
is still the only correct way to count teachers at a school like LGS.

### The admission fee panel is now driven by the fee structure

`FeeClearancePanel` had been headed *Admission fee* since Sprint 10 with **no
connection to the Admission Fee head**. It asked one question — has somebody
ticked this as paid — and offered that tick on a grade whose admission fee had
never been priced.

`lib/admission-fee.ts` resolves a four-state discriminated union, and the
ordering rule is structural rather than prose: **the confirm-payment control
exists only in `billed` and `settled`.** A reviewer reads one `switch`. The
head is found by name (`Admission Fee`, case-insensitive) falling back to the
lowest-ordered active `one_time` head, so a school that renamed it keeps
working.

`generateAdmissionChallan` is `generateChallan` with three differences, all of
them facts about what an admission is: null billing month and year (the unique
index treats nulls as distinct, so it cannot collide with a monthly challan),
only the resolved head is billed, and `already_exists` when the resolver says
`billed` or `settled`. The challan **number** still comes from the current month
and year, because that counter's key is the issuing period.

### Credit carried forward: `student_credits`

Migration `0033` adds one table and one column with a default. Expand-only.

The rule, verbatim: *as long as the fee has not been paid, any discount applied
will be effective. If the discount has been applied afterwards, then it will
appear as adjustment in the next voucher.*

* First half: `repriceOpenChallans` rewrites `unpaid`/`partial` challans in
  place, from the **frozen `amount` already on each line** — never from
  `fee_structures`. Only the discount moves. March's tuition rise must not
  rewrite February's bill.
* Second half: a paid challan is history, so the surplus becomes a
  `discount_overflow` credit and `previewChallan` spends it on the next voucher
  as *Adjustment — credit carried forward*.

Three things to leave alone:

1. **It is not the double-entry ledger and must not be made to balance.** It is
   a fee-module artefact in exactly the sense an outstanding balance is one. A
   credit reaches the books when the reduced challan is paid and that payment
   posts. `check-accounting` knows nothing about it and should not.
2. **The adjustment is on the header, not in `fee_challan_items`.** Every line
   there carries a `fee_type_id`; an adjustment has no fee head. `total_amount`
   stays the authority: `subtotal − concession − credit_applied + late_fee`.
3. **The consuming row is written in the same `batch()` as the challan.** A
   credit spent by a challan that was not written is money lost with nothing
   anywhere to report it.

A challan folded into a family voucher is skipped and *reported*, not edited —
the voucher is what the parent is holding and it is priced as a whole.

### Invitations are password-setup emails now

`POST /api/school/invitations` creates the `school_users` row and calls
`queueAccessEmail`. One mail, one link, the same one the platform's own
provisioning path has sent since Stage 4.

**`school_invitations` is not dropped and nothing new is written to it.** Rows
already in it are live invitations somebody may still click, so the GET, the
public `/invite/[token]` page, `InviteOTPForm`, the accept routes and the resend
endpoint are all untouched until those rows expire. The OTP path in
`lib/school-auth.ts` stays too — Forgot Password still uses a code, and an
established account should have to prove the mailbox.

`POST /api/school/users/[userId]/send-access` is the school-side twin of the
Super Admin's `send-signin`, behind `users.write`, wired to **Send access
email** on `UserDetailPanel`. It replaced that panel's *Resend invite* button,
which would otherwise have started answering 409 "someone with that phone number
already exists" — naming the person whose page it is on.

### The photo: three defects, one of which was never a storage problem

* **11a** — the wizard renders steps conditionally, so the file input is
  remounted empty on every return to step 1. The `photo` state survived; the
  file name did not, so the photo was re-selected. Fixed by rendering the held
  `File` as a thumbnail with an explicit *Remove photo*. The `onChange` handler
  no longer nulls state: cancelling a native dialog fires `change` with an empty
  `FileList` on some platforms, and `?? null` read that as a removal.
* **11b** — the upload had **no `response.ok` check** inside a `catch` that
  logged to the console. A 413, a 415 and a 500 were all indistinguishable from
  success; *Student 5* on the live tenant has `photo_url = null` from exactly
  that. The failure now travels on `?photo=failed&reason=…` and the profile
  names it.
* **11c** — *Add photo* / *Change photo* on the profile card, behind
  `admissions.write`, posting to the endpoint that already appends
  `?v=<timestamp>`.

**Storage was never the cause.** `uploadBuffer` sends `x-upsert: true`, so a
re-upload to the same deterministic path replaces the object. Do not go looking
there.

### Smaller, and settled

* `seedDefaultFeeTypes` moved into `lib/school-bootstrap.ts` and is called at
  provisioning beside `seedChartOfAccounts` and `seedResultSubcategories`, on
  the same terms: own `try`/`catch`, logged, never fails the request.
  **Heads only, no `fee_structures` rows** — a seeded `0` would tell the new
  per-head KPI that every fee is deliberately free on day one.
* `'guardian'` added to `FIRST_GUARDIAN_RELATIONSHIPS`. A legal guardian *is*
  the person the school holds responsible. `SINGLETON_RELATIONSHIPS` still holds
  only father and mother: a child has one of each and may have two guardians.

### Deviations from the spec, and why

* **Bulk generation also spends credit.** The spec named `previewChallan` and
  `generateChallan`. The monthly bulk run *is* "the next voucher" for almost
  every school, so a credit only a hand-raised challan could spend would sit on
  the record for a year.
* **`DELETE /api/school/fees/concessions/[id]` reprices too.** The spec named
  POST and PATCH. Deleting a concession entered in error has to take the
  discount back off the open bills, or the school has quietly forgiven money.
* **The confirm-payment button also renders in `settled` when `feeClearedAt` is
  null.** That is a waived or cancelled admission voucher: the fee is settled,
  nothing moved the enrolment out of `outstanding`, and the guardians are still
  without a portal login with no other screen to say why.

### Still open

* Migration `0033` is **not applied**. Every credit path is inert until it is —
  `student_credits` and `fee_challans.credit_applied` do not exist yet.
* No test-cases document was written for this sprint.
* Nothing here has been driven in a browser against the live tenant; the twelve
  acceptance criteria in `SPRINT-17-SPEC.md` are the QA script.

---

## 5bf. Sprint 18, phase 1 — the student record, the enrolment lock and DD-MMM-YYYY — 2026-08-28

Spec: `SPRINT-18-SPEC.md`, eighteen items. **This is items 1, 2, 3, 4, 5, 15
and 16 only.** Items 6–14, 17 and 18 — the voucher email, the currency sweep,
the "Challan → Voucher" rename, the landscape print format, concession schemes,
auto-send and the family-voucher wizard — are a later phase and none of them has
been started.

Migration: **none written, deliberately.** A single `0034` covering the whole
sprint is folded together at the end; what this phase needs is recorded in
`SPRINT-18-DDL-NOTES.md` at the repo root. `db/schema/role-permissions.ts`
derives its CHECK from `PERMISSIONS` and is therefore already correct — it is
the *live* constraint that is behind.

Gates run and green: `typecheck`, `lint`, `check-loaders`, `check-forms`,
`check-address-phone`, `check-cnic`, `check-sprint-periods`, `check-accounting`.
`npm run build` was **not** run — it is the DevOps agent's step, and running it
here would need the worktree `node_modules` stub deleted first (§5f).

### The student record is four permissions now, and the screens follow them

`students.read`, `students.create`, `students.update`, `students.delete`, in a
new `PERMISSION_GROUPS` entry the permissions screen picks up on its own.

**The defaults are chosen so that nothing changes for any school on the day this
deploys**: the first three go to exactly the roles that already hold
`admissions.read` / `admissions.write`, and only `school_admin` gets the fourth.
A school with no `role_permissions` row gets them with no write at all, which is
what that table's override design is for and why the code can ship ahead of the
CHECK.

Two screens were guarding themselves with a hand-kept list of roles —
`role === 'school_admin' || role === 'branch_admin'` — and had drifted from the
routes behind them: `PATCH /api/school/students/[studentId]` accepted
`admissions.write`, so a principal could already edit a record through the API
while the Edit button was hidden from them. **A control that is hidden but not
enforced is the wrong half of the pair to keep.** Both now read the permission.

### DELETE deletes two rows, not one, and refuses on a receipt

The cascade only runs downhill. `student_profiles` references `school_users`,
so deleting the profile alone leaves a directory row holding the child's name,
the `student:` sentinel phone and the admission number's uniqueness — the number
could not be reissued and the ghost would appear in the user list. Both rows go,
in one `batch()`.

It refuses with **409** once `fee_payments` holds anything against any of the
student's vouchers, with the count in the message and *withdraw instead* in the
same sentence. Money the school has received is answered for in the ledger, in a
bank reconciliation and to the parent holding the counterfoil; no admissions
screen gets to make it stop having happened. The confirm modal requires the
admission number to be typed, because every school has two children called
Muhammad Ali and a yes/no box is clicked through.

### The Guardian phone column was printing student ids

`listStudents` selected `guardianPhone: schoolUsers.phone` — the **student's**
own directory row, whose phone is the sentinel `student:GVS-2025-0011` that
`studentDirectoryPhone` writes because the column is `NOT NULL` and a
seven-year-old has no phone. So the column showed sentinels and the free-text
search on it could only ever match one.

It now reads the primary guardian through a joined subquery,
`(array_agg(phone order by is_primary_contact desc, created_at asc))[1]` —
an ordered aggregate, which is one of the few things with no Drizzle operator
and therefore legitimately a raw `sql` template; **no JavaScript value is
interpolated into it.** The search gained a second pattern that re-expresses
typed digits in the stored trunk form, because `0321 123 4567` and
`+923211234567` are the same number and share no substring.

### The fee chip, and why the filter is written from the same ranking

Four states — `Admission unpaid`, `Overdue`, `Due`, `Cleared` — ranked by how
specific the reason is rather than by severity, in `lib/student-fee-status.ts`.
A student can be in several at once, exactly one chip shows, and the SQL filter
in `listStudents` excludes the stronger states from the weaker ones so that
filtering by *Overdue* returns the students whose chip says Overdue. **A filter
that returns rows the reader can see contradict it is worse than no filter.**

One grouped subquery over `fee_challans`, left-joined once and included in the
count query too — a total that counted rows the page cannot show would page the
reader off the end of the list. Overdue is decided by `current_date` **in the
database**, so nothing crosses the driver and there is one clock rather than the
browser's and the server's.

### The guardian card locks until the CNIC is answered

A fresh card has nothing enabled but `CnicField`. It opens when the lookup
returns — match or no match, either is an answer — or when the clerk presses
**"No CNIC to hand — enter by hand"**, which is offered only while the field is
blank.

Three things about that lock which should not be re-litigated:

1. **A failed lookup unlocks the card.** A network blip must not become an
   enrolment nobody can finish.
2. **A card that arrives carrying details is never locked.** That is the
   converted-application path: the parent typed their name and number on the
   public form weeks ago, often with no CNIC, and locking it would leave the
   clerk staring at fields they cannot correct behind an escape hatch that only
   offers itself when the CNIC box is empty.
3. **Unlocking never reverses.** Taking fields away from somebody mid-sentence
   is not a safety feature. What a CNIC edit invalidates is the *match*, not the
   answer.

On a match, name / email / phone go read-only pointing at the guardian panel on
the sibling's profile; relationship, occupation and primary contact stay
editable because they are facts about *this* child. The relationship also now
prefills from the matched record when it is still free for this student — a
mother enrolling her second child was being offered Father, the form's default,
and the clerk who left it created a second father and split the family the
lookup had just recognised.

### `formatPhoneForDisplay` refuses to touch anything with a letter in it

The stored form is right and stays: `student_guardians.phone` is an identity.
The defect was on the way **out** — the E.164 string was handed to `PhoneField`,
whose value is display-format, so `isValidMobile('+923211234567')` was false and
the field showed an error on a number the server itself had written.

The guard matters more than the formatting. `school_users.phone` for a student
is `student:GVS-2025-0011`, whose digits (`20250011`) are a plausible landline
count — a mask applied blindly renders it `(202) 50011`, a number that does not
exist, derived from something that was never a number. Any letter in the value
and it is returned untouched.

### Dates: `lib/dates.ts`, and the one thing it must never do

`formatDateOnly`, `formatDateTime`, `formatMonthYear`, `DATE_INPUT_HINT`. A
`YYYY-MM-DD` column value is split on the hyphens and **never handed to
`new Date`**, which reads it as UTC midnight and prints the day before anywhere
west of Greenwich — a date of birth and a due date both a day early, on a screen
that has never been wrong for anyone in Karachi.

`DataTable` renders `kind: 'date'` through it, but only for a string that really
is a column value (`isIsoDateValue`). That narrowness is load-bearing:
`Date.parse` accepts `'August 2025'` and answers the first of it, so the
academic-year table would have had its months turned into days, and the cash
counter's `'Never'` would have become an em dash.

### Deviations from the spec, and why

* **The `Fees` column is not sortable.** The states are ranked by specificity,
  not severity, so a sort on them would order rows by a rule that reads as
  urgency and is not one. The filter answers the question the sort was for.
* **`students.read` also went to `coordinator`, `teacher`, `accountant` and
  `hr_manager`.** The spec said "every role that holds `admissions.read`
  today", and those four do — a teacher's register and a challan's section
  picker both read students through these routes, and dropping either would
  empty a dropdown rather than refuse a page.
* **The delete removes the `school_users` row as well**, where the spec says
  "a real delete of `student_profiles`". See above: the cascade does not run
  that way.
* **The date sweep is broad but not exhaustive.** Everything on item 15's list
  is done — the profile card, the guardian panel, the voucher print view and
  detail page, the defaulters list, the application table and detail, and both
  portals — plus the two feedback tables and the user panel. A `<input
  type="date">` that is *not* a date of birth did not get the hint.

### Still open

* **Migration `0034` is not written.** Until the CHECK is widened, an
  administrator toggling any of the four new keys on the permissions screen is
  refused by Postgres with a constraint name and no explanation. Everything else
  in this phase works without it.
* Items 6–14, 17 and 18 of the spec are untouched, including the
  "Challan → Voucher" rename, so the product still says *Challan* in most
  places while this phase's own new copy says *Voucher*.
* Nothing here has been driven in a browser. The chip, the lock and the delete
  refusal all need a real tenant with real vouchers to be believed.
* `npm run build` has not been run on this branch.

---

## 5bg. Sprint 18 — the voucher, the concession the school owns, and the 500 that shipped — 2026-08-28

Spec: `SPRINT-18-SPEC.md`, eighteen items reported by the product owner against
Lahore Grammar School. **§5bf above describes only phase 1 and is superseded by
this section**: all eighteen items are now built, migrated, deployed and driven.

Migration **`0034` is APPLIED and verified** —
`db/migrations/0034_sprint18_vouchers_concessions.sql`. 34 bookkeeping rows
before, **35** after. Three new tables, four new columns, one widened CHECK; 30
constraint-firing assertions, each expected refusal inside its own `SAVEPOINT`
per §5be, whole transaction rolled back, 30 of 30 passed.

**DEPLOYED AND LIVE as `02904e373dc3`.** PR
[#37](https://github.com/Haznain666/School-Managment/pull/37) (the sprint) and
[#38](https://github.com/Haznain666/School-Managment/pull/38) (QA's fixes,
including a live 500) both merged. Test cases:
`test-cases/TEST-CASES-SPRINT-18.md` — 63 passed, 6 defects, 62 not executed.
Release note: `release-notes/RELEASE-NOTES-SPRINT-18.md`.

### 🐛 The all-students screen shipped as a 500 at every school

`dbe7571156cb` went live with `/dashboard/admissions/students` returning 500 for
every user at every school. Items 3 and 4 could not render a row.

`listStudents` aliased its guardian-phone ordered aggregate as `phone`. **Drizzle
emits a raw-`sql` subquery column unqualified**, `school_users.phone` is joined
on the same statement, and Postgres refused the whole query — 42702,
`column reference "phone" is ambiguous`.

**This is the second time this exact Drizzle behaviour has cost a shipped
defect.** §5av is the first: the day book threw on every call for five sprints
for the same reason. The rule that follows from having paid for it twice:

> **Alias a raw-`sql` subquery column to something no joined table has, and
> qualify every reference to it.** `guardian_phone`, never `phone`.

The qualification is not cosmetic. Unqualified in the `WHERE`, the search would
have bound to `school_users.phone` — the `student:<admission number>` sentinel
that item 3 exists to stop showing people. It would have silently searched the
wrong column instead of failing loudly.

**No gate could have caught it.** Nine were green: none of them executes a
query. What would have caught it is driving the screen once, and §5bf records in
its own words that phase 1 had never been driven in a browser.

### The build is the only gate with a bundler in it

`npm run build` refused the artifact after item 6e moved the defaulters screen
onto `DataTable`:

    ./lib/defaulters.ts
    Error: You're importing a component that needs "server-only".

`AgedDebtTable` is a client component and imported `AGING_BUCKETS` and
`BUCKET_LABELS` as **values**. They are pure constants sitting above everything
in that file that touches the database — but the bundler follows a value import,
and `lib/defaulters.ts` opens with `import 'server-only'`.
`lib/aging-buckets.ts` now holds them with no imports at all, and
`lib/defaulters.ts` re-exports them so no server-side caller changed.

Typecheck, lint and all eight check scripts were green throughout. A
`server-only` violation is a bundling fact. **That is the argument for the build
staying in CLAUDE.md's nine rather than being the slow one to skip.**

A sweep of the whole boundary found three other client components importing from
`server-only` modules — `FeeClearancePanel`, five exam components, three
feedback components — and every one is `import type`, erased before the bundler
sees it. Only the value import broke.

### The four other defects QA found

* **The register's Kind column called every admission voucher a One-off.**
  Filtering by *Admission* returned four rows all labelled One-off:
  `listChallans` never selected `challan_kind`, so the cell inferred a kind from
  `billing_month`, which an admission voucher deliberately leaves null.
* **A scheme's Students count was always nought** — the same
  unqualified-emission class as the 500. The correlated subquery came out as
  `where "scheme_id" = "id"`, comparing each row's `scheme_id` to its own primary
  key. Raw SQL counted 1; the API returned 0.
* **A Tuition-only concession was described as "off every fee head."** The
  sentence read the legacy single-head column, which a multi-select grant leaves
  null. The calculator was right and only the description was wrong — which is
  the dangerous direction, because a description reads as a guarantee.
* **Item 9 missed the navbar search placeholder**, the most-read string in the
  product, plus two hints, a page description and five refusals.

### Sprint 17's credit-idempotence regression holds

Specifically re-tested, because §5be records a *fix* introducing it: after a
third unrelated concession write forced another reprice, Student 11's credit was
still exactly one 5,000.00 row with its original timestamp.
`grantedOverflowPaise` is doing its job. Do not remove it.

### The rename was mechanical and three of its results were not

150 words across 41 files, restricted to string literals and JSX text so that
`const challan = …` stayed code. Three occurrences inside strings were
identifiers and keep the old spelling: `icon: 'challans'` is a key into the icon
registry, `challan-copy` is a CSS class `globals.css` styles by name, and
`BulkGenerateResult['challans']` indexes a type. Typecheck caught two; the rule
that skips a match touching `/`, `-`, `.` or `_` caught the third.

Nothing else was renamed — not a table, a column, a route, a file or a
permission key. A route rename breaks every bookmark a school has.

### Two environment facts, both new

* **`DATABASE_URL` in `.env.local` holds unescaped literal `@` characters in the
  password.** `postgres.js` tolerates it; **`npx drizzle-kit migrate` hung on it
  for five minutes and applied nothing.** That is why the documented
  `npm run db:migrate` route does not work. `0034` was applied through
  drizzle-orm's own `postgres-js` migrator instead — same statements, same
  `drizzle.__drizzle_migrations` bookkeeping. Percent-encoding the password
  would likely restore the documented route.
* **Streamed Suspense boundaries never reveal while the Browser pane is
  undisplayed.** React 19 gates reveals on `requestAnimationFrame`, and an
  uncomposited pane fires none. This is **not** §5be's missing static copy —
  assets were fine, chunks returned 200, fibers were attached. The workaround
  (override rAF, drain React's `$RB`/`$RV` queue) is written up in the
  test-cases file.

### ⚠ QA shares a database with production, and that has teeth

`.env.standalone.local` **must have SMTP blanked**. Any voucher generated during
QA queues real mail to real parents, which the *live* drainer will then send.
The outbox came out of this run at 17 sent and 0 queued — no parent was emailed
— but only because it was blanked in time.

### ⚠ One row left behind at LGS, and it is money

A **5,000.00 unspent `discount_overflow` credit for Student 11**
(`8d7a36af-c562-4728-ba37-df5e20f0fde8`), banked by a deliberate overflow test
and stranded by the limitation below. It is harmless until Student 11's next
voucher, which would silently consume 5,000 rupees the school never granted.
The exact `DELETE` is in `test-cases/TEST-CASES-SPRINT-18.md`.

`student_credits` is not one of the two append-only ledger tables, so removing
it breaks no rule — but **an agent deleting a row from a live production
database should be a human decision**, and it was left for one.

LGS is otherwise exactly as found: both QA schemes deleted, all grants removed,
Student 11's voucher restored to 50,000 / 15,000 / 35,000 unpaid, ledger
untouched. One benign permanent change: that voucher's items now carry
`concession_detail` where they carried null, which is accurate and is what item
14 wants.

### Known limitation, reported rather than built

**Removing a concession does not claw back the overflow credit it banked.**
Repricing the open voucher is correct; the banked credit stays. Reducing a
credit that may already be partly spent is a decision about real money, so QA
stopped rather than guessing — the right call, and the same judgement §5be
records about a cancelled voucher not returning its credit.

### What was NOT verified, honestly

Items 1, 2, 6, 10, 17 and 18 are largely unexecuted. The enrolment wizard was
never driven. Items 6, 17 and 18 all require emailing real guardians or posting
to an append-only ledger at a live tenant. Item 10's print layout cannot be
judged from the DOM.

**Item 18's even-spread partial-payment arithmetic is the sum most worth
checking in this sprint and it remains unchecked** — LGS has no family fixture
for it. All of these need a **disposable tenant**, which is now the single most
valuable thing this project could build for its own QA.

### Next free migration number is `0035`.
