# Test cases — Sprint 15: the school creation wizard, dashboards on five portals, and one table primitive

Traces to [`RELEASE-NOTES-SPRINT-15.md`](../release-notes/RELEASE-NOTES-SPRINT-15.md).
Migration `0031` — **APPLIED and verified** against the live database.

## Status — 2026-08-23

Built by three developers on separate branches, merged, and then re-gated **as
one tree** — which is the only measurement that counts, because each branch was
green on its own and none of them had ever been compiled against the other two.

| Mark | Meaning |
| --- | --- |
| ✅ | executed and passing |
| 🔁 | **was a defect, now fixed and re-verified** |
| ⚠️ | executed, passed, with a caveat recorded |
| ⬜ | not executed, and why |

**What was executed.** All twelve gates on the merged tree. Then a drive in a
real browser against a **production standalone build** — not `next dev` and not
`next start`, for the reason in §4 below — signed in as the platform Super Admin,
and then into a real school through *Login as Admin*, against the live database
with nine enrolled students, four classes and published exam marks in it.

**Two defects found, both fixed** — F1 and F2 below. One further defect was
found, measured, proved **pre-existing**, and handed to a separate task rather
than fixed here (§5).

---

## 1. The school creation wizard

| ID | Case | Result |
| --- | --- | --- |
| UC-S15-01 | `/super-admin/schools/new` renders a five-pill stepper: School, Branch, Branding, Modules, Integrations | ✅ |
| UC-S15-02 | Step 1 field **order** is Head Office Name → Street Address → City → School Owner / School Administrator → School Landline Number → School Mobile Number → School Admin Email → Subdomain | ✅ |
| UC-S15-03 | School Code follows Subdomain and still derives from the name when left blank | ✅ |
| UC-S15-04 | Step 1 renders 8 inputs, no skeleton, console clean | ✅ |
| UC-S15-05 | Branch step carries **no** Principal field — principals are School Admin → Settings | ✅ (read) |
| UC-S15-06 | Branch step order is Main Branch → Branch Name → Street Address → City → Branch Landline → Branch Mobile → Branch Email → Curriculum Level → Classes Taught | ⬜ static read only — reaching step 2 requires creating a school, and the only tenant on the live database is a real one |
| UC-S15-07 | Steps 3–5 offer **Skip for now**; steps 1–2 do not | ⬜ same reason |
| UC-S15-08 | Steps 1 and 2 cannot be returned to; 3–5 move freely | ⬜ same reason |
| UC-S15-09 | Finish lands on the school detail page, or on Users when no administrator was emailed | ⬜ same reason |
| UC-S15-10 | The per-school Branding / Modules / Integrations / Branches tabs still edit an existing school | ✅ all four tabs render |
| UC-S15-11 | Labels only — no column, payload key or API contract changed | ✅ (`git diff` on `db/schema`, the two routes) |

⚠️ **UC-S15-06 to 09 were not driven.** Completing the wizard creates a school
row and a branch row on the **production** database. There is one real tenant on
it and no scratch tenant to spend, so the flow past step 1 was read rather than
run. This is the largest gap in this sprint's QA and is named as such.

---

## 2. The subdomain error — requirement 2

| ID | Case | Result |
| --- | --- | --- |
| UC-S15-20 | `throttled` is a distinct status: amber, "Rate limited", retryable | ✅ (`check-provisioning`, 27 assertions) |
| UC-S15-21 | Migration `0031` widens the CHECK to accept `throttled` | ✅ live: bookkeeping 31 → 32 |
| UC-S15-22 | A real `UPDATE … SET subdomain_status = 'throttled'` is accepted | ✅ live, inside a transaction, rolled back; the row was left exactly as found |
| UC-S15-23 | `Retry-After` honoured, retries bounded at 2 within a ~5s ceiling, only 429/5xx | ✅ (`check-provisioning`) |
| UC-S15-24 | A provision costs three API calls, not four | ✅ (`check-provisioning`) |
| UC-S15-25 | Raw JSON no longer reaches the operator's screen | ✅ for **new** attempts |
| UC-S15-26 | The existing failed row now reads as a rate limit | ❌ **No — and this is expected. See below.** |

⚠️ **UC-S15-26 is the one to know about.** The schools table still renders:

> Hostinger refused the request (HTTP 429). { "message": "Too Many Attempts.",
> "correlation_id": "a28cff8a-…" }

That string is **stored in the database** from the attempt that failed before
this sprint. The fix changes how *future* attempts are recorded; it deliberately
does not rewrite history, because nothing in the code can know which historical
`failed` rows were really rate limits. **Pressing Provision on that row is what
corrects it**, and that must be done on the live site where
`HOSTINGER_API_TOKEN` is configured — pressing it from a local instance, which
has no token, would replace a meaningful error with "Manual" and lose the
record.

---

## 3. The Mapbox dropdown — requirement 3

| ID | Case | Result |
| --- | --- | --- |
| UC-S15-30 | The listbox portals to `document.body` and is not clipped by `Card`'s `overflow-hidden` | ⬜ **not executed** |
| UC-S15-31 | Flips above the input when under 160px remains below | ⬜ not executed |
| UC-S15-32 | Clicking a suggestion still selects it (portal breaks the old sibling-blur assumption) | ⬜ not executed |
| UC-S15-33 | ARIA preserved; `aria-owns` added because the list is no longer a descendant | ✅ (read) |
| UC-S15-34 | `Card` keeps `overflow-hidden` | ✅ (read) |

⚠️ **Requirement 3 is unverified in a browser, and that is not a small caveat**
— it is the requirement whose whole content is visual behaviour. No
`NEXT_PUBLIC_MAPBOX_TOKEN` is set in `.env.local`, so every address field
renders "Address search is off" and the listbox never opens. The public
`/apply` form on production would have served, but it needs a tenant subdomain
and the only tenant's subdomain is the one that failed to provision.

**To verify: open any address field on the live site, type `gulshan`, and
confirm the suggestion list is fully visible past the card border** — the exact
condition in the original screenshot.

---

## 4. Filters, sorting, pagination, loaders — requirement 5

Driven on `/super-admin/schools` and on `/dashboard/admissions/students`.

| ID | Case | Result |
| --- | --- | --- |
| UC-S15-40 | Schools list carries Search, a Status filter and a Subdomain filter | ✅ |
| UC-S15-41 | Column headers are keyboard-reachable buttons labelled "Sort ascending" | ✅ |
| UC-S15-42 | Clicking a header sets `aria-sort` on **that** `<th>` and no other | ✅ Name → `ascending`, six others `null` |
| UC-S15-43 | Sorting issues a server request | ✅ `?page=1&limit=50&sort=name&direction=asc` |
| UC-S15-44 | Footer states the range: "Showing 1–1 of 1 school" | ✅ |
| UC-S15-45 | Students list carries Search + Status + Academic year + Branch + Grade + Section, and 7 sortable headers | ✅ |
| UC-S15-46 | Changing a filter issues a server request carrying it | ✅ `…&status=withdrawn&…` |
| UC-S15-47 | **Over-filtered is distinct from empty** | ✅ "No students match those filters — Widen the year, class or status and they will come back", with a Clear filters action |
| UC-S15-48 | `limit=500` is clamped **on the server** | ✅ returns `limit: 100` |
| UC-S15-49 | `limit=-5` falls back to the default | ✅ returns `limit: 50` |
| UC-S15-50 | `sort=DROP;--` is rejected by the route-owned whitelist | ✅ falls back to the default sort |
| UC-S15-51 | Tenant scope unchanged — `location_id` from the session, never a parameter | ✅ (read, all seven routes) |
| UC-S15-52 | A pending state renders while a filter is in flight | ⚠️ the skeleton was observed on first paint; the *transient* filter-change state was not caught — it is faster than the sampling interval |

**UC-S15-48 to 50 matter more than they look.** A page-size cap only the browser
enforces is not a cap, and a sort key that reaches the database as text is not a
sort key. Both were probed as an attacker would.

---

## 5. Dashboards — requirement 4

Driven against a school with nine students, four classes and published marks.

| ID | Case | Result |
| --- | --- | --- |
| UC-S15-60 | Super Admin shows Active schools, **Needing attention**, Students, Email delivery | ✅ |
| UC-S15-61 | Needing attention surfaces the broken tenant and says why | ✅ "Lahore Grammar School · Failed · Subdomain Failed" |
| UC-S15-62 | Total schools / total branches / modules enabled are gone | ✅ |
| UC-S15-63 | Provisioning donut, tenant growth, students-by-school, schools-by-city all render | ✅ |
| UC-S15-64 | **A tile that cannot be computed says so and never renders a zero** | ✅ "Attendance today — / unavailable / No register taken yet today" |
| UC-S15-65 | School Admin exceptions strip leads with what is wrong | ✅ "4 classes with no register taken today" |
| UC-S15-66 | The five orphaned aggregates now render | ✅ fee-status split, ageing, attendance-by-class, admissions funnel, recent exam outcomes |
| UC-S15-67 | Every chart carries a text summary and a data table for screen readers | ✅ |
| UC-S15-68 | Empty states are honest, not zeroes | ✅ "No applications yet", "No register has been taken in the last 30 days" |
| UC-S15-69 | Recent exam outcomes reads real published marks | ✅ 33% pass / 56% average on Class 4 |
| UC-S15-70 | 🔁 **A delta of zero is not announced as an improvement** | 🔁 **F1 — fixed** |
| UC-S15-71 | Quick actions gate on permissions, not on the role name | ✅ (read) |
| UC-S15-72 | BR4: a principal sees only their own campuses and grades | ⬜ **not executed** — no principal account exists on the live tenant. `check-portals` asserts `resolvePrincipalScope`, and `check-dashboard` runs every aggregate twice, scoped and unscoped; neither is a signed-in principal |
| UC-S15-73 | Teacher / Parent / Student dashboards | ⬜ not executed — no teacher, parent or student login available on the live tenant |

---

## Defects found and fixed

### F1 — a delta of zero was announced as an improvement 🔁

`+0` rendered in **success green** and carried `<span class="sr-only"> — an
improvement</span>`. A screen-reader user was told the platform had improved
when nothing had changed, and a sighted user was shown the colour that means
"good" for a month in which no school was added.

Six places, all in the same shape: `deltaMeaning="good"` hardcoded on the Super
Admin *Active schools* and *Students* tiles, and `>=` mapping **equality** to
`'good'` on School Admin's collections, attendance, enrolment and net-this-month
tiles. All six now resolve equality to `'neutral'`, which `StatTile` already
renders muted grey.

Verified after the fix: with collections at PKR 0 against PKR 0, the tile no
longer claims an improvement, while *Enrolled students +9* still does.

### F2 — a hydration hazard in the School Code hint 🔁

`components/super-admin/SchoolForm.tsx` rendered `new Date().getFullYear()`
directly into the hint text. That expression runs once on the server and again
in the browser, in different timezones — around New Year they disagree, and a
differing text node discards the server render of the whole form. Hoisted to a
module constant.

---

## Found, measured, and deliberately not fixed here

**React error #418 — a hydration mismatch on create-mode form pages.**
`/super-admin/schools/new` and `/super-admin/schools/[schoolId]/branches/new`
both throw it; the edit page and the dashboards do not.

It is **pre-existing**. Commit `5385689` — the merge immediately before this
sprint — was built in a scratch worktree and reproduces the identical error on
the identical page. Sprint 15's changes to `BranchForm`, `SchoolForm` and
`AddressAutocomplete` did not introduce it, and the new portal cannot cause it:
it is mount-gated and renders nothing on the server *and* nothing on the first
client render.

Also ruled out: fetching the server HTML from inside the page and diffing its
`<form>` text against the hydrated DOM showed them **byte-identical** (1014
characters), so it is not stable render output.

Handed to a separate task rather than fixed inside this sprint.

---

## Notes for whoever runs these next

**Use the standalone server, not `next dev` and not `next start`.**
`next.config.mjs` sets `output: standalone`, and `next start` prints
*"next start" does not work with "output: standalone"* and then serves an
incomplete asset set. A `sms-platform-standalone` entry now exists in
`.claude/launch.json`.

**Stop the server before rebuilding.** `rm -rf .next` fails with *Device or
resource busy* while the standalone server is running out of `.next/standalone`,
and the build that follows is silently corrupt — it renders as a page stuck
permanently on its loading skeleton. Two builds were lost to this.

**These pages take longer than you think.** Against a remote Supabase from a
development machine, `/super-admin` and `/super-admin/schools` need **more than
2.5 seconds** to finish streaming. Sampling the DOM earlier than that reads the
`loading.tsx` skeleton and looks exactly like a hung page. Poll to a stable
value; do not read once.

**`.env.local` needs two different escapings.** `@next/env` (used by
`next dev`/`next start`) runs dotenv-expand, so every `$` in
`SUPER_ADMIN_PASSWORD_HASH` must be written `\$` — 63 characters. `node
--env-file` does no expansion, so the standalone server needs the raw
60-character hash. The same file cannot satisfy both at once.
