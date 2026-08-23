# Sprint 15 — the school creation wizard, dashboards on five portals, and one table primitive

**Built 2026-08-23.** Migration `0031_subdomain_throttled_status.sql` is
**APPLIED to the live database.**

> ✅ **Live.** The bookkeeping table went 31 → 32. Verified against the real
> schema rather than trusting the success message: the CHECK on
> `schools.subdomain_status` now carries `throttled`, and a real
> `UPDATE … SET subdomain_status = 'throttled'` was executed inside a
> transaction, accepted, and rolled back — the row was left exactly as found.
>
> **It had to go in before the merge, not after.** `provisionSchoolSubdomain`
> writes `throttled` the first time a school is created after this deploys, and
> against the old constraint that write fails. The migration is expand-only —
> one CHECK widened, no column changes, no row changes — so applying it while
> the *old* build was still live cost nothing: nothing yet wrote the new value.
>
> **Next free migration number is `0032`.**

Five requirements, built by three developers on separate branches and merged
here. Each branch was green on its own; none had ever been compiled against the
other two, so the gates were re-run **on the merged tree**, which is the only
measurement that counts.

---

## 1. Creating a school is one flow, not five screens

`/super-admin/schools/new` was a single form. Everything else a new school needs
— its first campus, its branding, its modules, its integrations — lived on four
separate tabs that an operator had to *know* to visit. Nothing said they
existed and nothing said a school was unfinished, so the normal outcome was a
school with no branch, default colours, and every module in whatever state the
platform ships.

It is now five steps with a stepper: **School → Branch → Branding → Modules →
Integrations**. The last three carry *Skip for now*; the first two do not.

Fields were reordered and relabelled on both steps to the list the product owner
gave. **Labels only** — no column, no payload key and no API contract moved, so
nothing that reads a school reads it differently.

| Step 1 | Step 2 |
| --- | --- |
| Head Office Name | Main Branch (checkbox) |
| Street Address | Branch Name |
| City | Street Address |
| School Owner / School Administrator | City |
| School Landline Number | Branch Landline Number |
| School Mobile Number | Branch Mobile Number |
| School Admin Email | Branch Email |
| Subdomain | Curriculum Level |
| School Code | Classes Taught |

**Two decisions worth knowing.** Steps 1 and 2 cannot be returned to: each
POSTs a record, so a Back button onto either is a button offering to create a
second school or a second branch. And step 1 **saves immediately**, which is the
reason that is safe — a wizard abandoned after step 1 leaves a *valid* school
behind, finishable later from its own tabs, not a half-written one.

**The panels are the same components the tabs render.** `BrandingManager`,
`ModuleToggleGrid`, `IntegrationsPanel` and `BranchForm` are imported, not
copied. A wizard with its own copy of the branding panel is a second place for
the palette rules to live, and the two diverge the first time either is touched.

### There is no Principal field on the branch step

The product owner moved principal management out of platform setup and into
**School Admin → Settings**, where it already lived: `PrincipalAssignments`,
`principal_assignments`, and the branch-scoping resolver were all built in
Sprint 13. A principal already has the school portal without being able to edit
the school profile, change roles and permissions, manage other principals, or
see another campus — because the role holds `settings.read` but not
`settings.write`, and holds neither `permissions.manage` nor `principals.manage`.

So this requirement needed no new code. It is recorded here because "we built
nothing" is the useful fact, not an omission.

---

## 2. A rate limit was being recorded as a refusal

The live database held one school, and it read:

    subdomain_status = 'failed'
    subdomain_error  = 'Hostinger refused the request (HTTP 429).
                        { "message": "Too Many Attempts.",
                          "correlation_id": "a28cff8a-…" }'

Nothing about that request was wrong. **HTTP 429 is the host's rate limiter
saying "not now"**, and the same call succeeds seconds later. But
`lib/hostinger.ts` fell through to `failed` for every non-ok status, so the panel
showed a red **Failed** badge with a JSON blob beside it — which sends an
operator hunting for a misconfiguration that does not exist.

Three things were wrong and all three are fixed:

- **`throttled` is now its own state** — amber, "Rate limited", retryable, and
  told apart from a refusal on the merits. `failed` means the attempt was
  refused; `throttled` means the host would not look at it yet, nothing was
  lost, and pressing Provision again finishes the job.
- **`Retry-After` is honoured** (seconds and HTTP-date), with at most two extra
  attempts against a **five-second per-provision ceiling**. A wait longer than
  what is left is not slept through — the row is marked `throttled` instead, so
  a super-admin's create request never hangs on somebody else's throttle.
- **Raw JSON no longer reaches the screen.** The response body is parsed and its
  `message`/`detail`/`error` lifted into one sentence; the correlation id
  survives as a small `(ref …)` for support rather than as the headline.

And the cause of the throttle was addressed, not just its symptom: a provision
made **four** API calls (list-then-create for the alias, read-then-write for
DNS) and now makes **three**. `SchoolTable` also stopped hardcoding danger red
for the recorded message and now takes its colour from the status descriptor, so
a rate-limited row no longer shows an amber badge above red text.

> ⚠️ **The school already sitting at `failed` is left as it is.** Nothing in
> this code can know which historical failures were really rate limits, and
> guessing retrospectively would be worse than leaving an honest record.
> **Pressing Provision on that row is what corrects it** — on the live site,
> where the hosting token is configured.

---

## 3. The card was eating the address dropdown

`Card` is `overflow-hidden` — that is what clips a table's corners to the card
radius — and `AddressAutocomplete` rendered its suggestion list as an absolutely
positioned child. So whenever an address field sat near the bottom of a card,
the suggestions were sliced off at the border.

The listbox now renders in a **portal to `document.body`**, positioned from the
control's own bounding rect, re-measured on capture-phase scroll and on resize,
matched to the input's width, and flipped above the field when there is under
160px below it. `Card` was not touched.

Two things fell out of moving it. The list is no longer a DOM descendant of the
field, so `aria-owns` was added to restate the relationship a screen reader had
been getting from the tree. And the old blur handling assumed the list was a
sibling — that assumption breaks in a portal and would have made every
suggestion unclickable, so blur now checks `relatedTarget` and an outside
`pointerdown` instead. It renders at `z-modal` rather than `z-dropdown`, because
at body level dropdown depth would put it *behind* a dialog that owns the field.

---

## 4. Dashboards that answer a question

Built to `SPRINT-15-DASHBOARDS.md`, written with the business-analyst,
dashboard-designer and chart-builder skills. **No migration** — every figure on
all five screens was already derivable.

**The rule the whole thing is built on: a tile that cannot be computed says so,
and never renders a zero.** `PKR 0` on a school that collected three lakh this
morning is confidently wrong and unfalsifiable by the reader. Every read goes
through `settle`, so one failed query removes one tile rather than the page —
the 2026-08-22 outage, where a single missing table rendered the whole dashboard
as "Could not load the dashboard", is the reason that is not optional.

**Five aggregates were already written, already covered by `check-dashboard`,
and on no screen at all** — the fee-status split, the ageing buckets, attendance
by class, the admissions funnel, and recent exam outcomes. They render now. That
was the cheapest half of this sprint and it had already been paid for.

- **Super Admin** gains the tile it was missing: **tenants needing attention** —
  a broken subdomain, no campus, or no administrator. An operator's job is
  exception handling, and until now a school nobody could use was reachable only
  by scrolling a table past a red badge. *Total schools*, *total branches* and
  *modules enabled* are gone: they are trophies, and no number in that list
  changes what anyone does next.
- **School Admin**: every headline tile now carries a benchmark — four of five
  had none, and a number without a comparison is not an indicator. Above them
  sits an **exceptions strip**: overdue challans, registers not marked, marks
  not entered, leave awaiting approval, failed email. That morning round used to
  mean visiting five screens.
- **Teacher, Parent and Student** had placeholder cards. Teacher is now a to-do
  list with today's timetable and the running period marked. Parent is **one
  card per child**, so a parent with three children does not switch context
  three times. Student shows what is next and how the terms have gone.

**Principal scoping runs through every aggregate as a sub-select condition
rather than a join**, so the unscoped query shape is *provably* unchanged and a
school administrator's dashboard cannot have regressed. An unassigned head
resolves to an empty grade list, not to "no filter" — the fail-safe direction.

`check-dashboard` went from 11 aggregates to **41**, each registered twice
because the scoped path is genuinely different SQL. `check-portals` went from 14
to **22**, and two joins that had always short-circuited behind an empty-section
guard are now actually executed.

---

## 5. One table primitive, thirty listings

Every record listing now has filters, sortable column headers, pagination capped
at 100 rows, and a visible pending state — from one new component,
`components/ui/DataTable.tsx`, layered on the `Table`, `Pagination`, `Skeleton`
and `EmptyState` that already existed. No new dependency.

- **Sorting is type-aware.** Money compares as integer paise, not lexically. A
  column of rupees sorted as text is the kind of bug nobody reports, because it
  looks like an ordering somebody chose.
- **The 100 cap is enforced twice** — in the browser and again in
  `lib/list-query.ts` on the server. A cap only the client enforces is not a cap.
  Sort keys resolve against a route-owned whitelist rather than reaching the
  database as text.
- **Over-filtered is a different empty state from empty.** Telling somebody "no
  students" when they have simply over-filtered sends them looking for data that
  is there.

Seven API routes gained sort, direction, page and size. **Tenant scope is
untouched in every one**: `location_id` still comes from the verified session and
never from a request parameter.

**Two defects fell out of the work.** The day book returned the most recent 500
rows with no count and no way to reach row 501. And the expense register's footer
totalled only the rows on screen, so a filtered register reported a total that
was not the total of the filter — a wrong number presented as a right one.

**Six screens were deliberately left alone**: the permission matrix, two
timetable grids, the marks and fee-structure entry matrices, and the CSV import
preview. Sorting a week grid is nonsense and paginating an invoice loses lines.

---

## Found during QA

**Fixed here.** A delta of zero was rendered in success green and announced to
screen readers as *"— an improvement"*. Six tiles across two dashboards, all
resolving equality to `good`; they now resolve it to `neutral`. And
`SchoolForm` rendered `new Date().getFullYear()` straight into hint text, which
is a hydration hazard across a New Year boundary — hoisted to a constant.

**Not fixed here, and measured rather than assumed.** Create-mode form pages
throw React error #418, a hydration mismatch. Commit `5385689` — the merge
immediately before this sprint — was built in a scratch worktree and reproduces
it on the identical page, so it is **pre-existing**. It has its own task.

---

## What was not verified

Stated plainly, because two of these are load-bearing.

- **The wizard past step 1 was never driven.** Completing it creates real rows on
  the production database, and there is no scratch tenant to spend. Steps 2–5,
  the Skip behaviour, and where Finish lands were read, not run.
- **The Mapbox dropdown was never seen.** No `NEXT_PUBLIC_MAPBOX_TOKEN` is
  configured outside production, so the listbox never opens; the public form
  that would have served needs a tenant subdomain, and the only tenant's
  subdomain is the one that failed. **This is the requirement whose entire
  content is visual behaviour, and it is the one with no visual evidence.**
- **BR4 principal scoping was not driven as a signed-in principal.** No
  principal account exists on the live tenant. The resolver is asserted by
  `check-portals` and every aggregate runs scoped and unscoped in
  `check-dashboard`, but neither is a person signing in.
- **Teacher, parent and student dashboards were not opened as those roles**, for
  the same reason.
