# CLAUDE.md — standing rules for this repository

Read `STATE.md` first; it is the handover file and says where the work is.
This file is different: it holds the rules that apply to **every** change,
including ones nobody has thought of yet.

---

## RULE: every data-fetching route shows a loader

**If a `page.tsx` fetches on the server, its segment has a `loading.tsx`.**

Enforced by `npm run check-loaders`, which is part of a green build. The check
runs in both directions:

| The page | Must have |
| --- | --- |
| has `export const dynamic = 'force-dynamic'`, or any `await` | a sibling `loading.tsx` rendering at least one `components/ui/Skeleton` shape |
| has neither — it is prerendered at build time | **no** `loading.tsx` |

The second direction is not pedantry. A prerendered page has no wait to fill,
so a skeleton on it is a flash of fake content in front of content that had
already arrived.

### Use a shape, not a grey box

`components/ui/Skeleton.tsx` ships the five shapes this product actually has:

| Shape | For |
| --- | --- |
| `SkeletonTable` + `SkeletonPageHeader` | list screens |
| `SkeletonForm` | create/edit screens |
| `SkeletonDetail` | one record |
| `SkeletonChart` + `SkeletonStatTiles` | dashboards and reports |
| `SkeletonDocument` | print and preview routes |

Add a sixth shape there rather than hand-placing boxes in a route file. A
skeleton is worth having only when it is the shape of what is coming; one that
is the wrong shape promises a layout that then jumps, which is worse than a
blank.

Do not use a spinner in the middle of content. A spinner reports that something
is happening; a skeleton reports what is arriving and where.

### Client-side loading is your job too

`loading.tsx` covers the server render. Anything a client component fetches
after mount — a filter that refetches, a form that submits, a table that pages
— carries its own visible pending state. Every current `fetch('/api/…')` call
site in `components/` has one; keep it that way.

`components/ui/RouteProgress.tsx` covers the third gap: the moment between the
click and the new route starting to render. It is mounted once in the root
layout and needs nothing from you.

### Why this is a rule and not a preference

Measured against the live origin on 2026-08-19: an uncached request took
**~1.0s**, and a CDN-cached one **~85ms**. Local development shows you neither
number. A screen that feels instant on your machine is a one-second blank on a
parent's phone in Lahore, and the only thing standing in that second is the
loader.

---

## RULE: do not make a static page dynamic by accident

Four things opt a route out of prerendering and into ~1s per request:
`searchParams`, `cookies()`, `headers()`, and any database read.

`app/(super-admin)/super-admin/login/page.tsx` is the worked example. It read
one query parameter, which cost it 0.82–1.23s on 12 of 12 measured samples, for
a page with no query and no session. The parameter now reaches the form through
`useSearchParams` and the page is prerendered.

Before adding any of the four to a page, ask whether the value can be read on
the client instead. If it can, read it there.

---

## RULE: a timetable grid resolves its period schedule

**Never call `listTimetableSlots(locationId)` unscoped to draw a grid.**

A school keeps as many bell schedules as it needs (`period_structures`), and
which one a class runs on is decided by its *grade* — its own assignment, or the
school default when nobody has assigned it. Use the function that resolves that:

| Drawing | Call |
| --- | --- |
| one section's week | `listSlotsForSection(locationId, sectionId)` |
| one teacher's week | `listSlotsForTeacher(locationId, teacherId, yearId)` |
| a count across the school | `listTimetableSlots(locationId)` — and only this |

The unscoped call returns every structure's periods at once. On a grid that
means an infant class laid out against the senior school's eight rows, five of
which can never be filled and every one of which invites a click. It is right
for a summary count and wrong for everything else, which is why it is still
exported rather than deleted.

Writes are guarded the same way: `POST /api/school/timetable/entries` re-resolves
the section's structure and refuses a slot from another. Without that, a stale
tab left open across a grade reassignment writes a row that satisfies every
constraint and appears in no grid — an accepted write nobody can see.

---

---

## RULE: every CNIC field is `CnicField`, and every stored CNIC is canonical

**If a screen asks for a CNIC / Smart Card number, it uses
`components/ui/CnicField.tsx`. If a route stores one, it puts it through
`normalizeCnic` first.**

Enforced by `npm run check-cnic`, which runs in CI on every push.

| You are | Use |
| --- | --- |
| asking a person for their CNIC | `<CnicField />` |
| asking for a CNIC **or** a B-Form (a student's own document) | `<NationalIdField />` |
| writing the value to any column | `normalizeCnic(value)` |
| comparing two of them | plain `===`, on canonicalised values |

### This is not a formatting preference

`student_guardians.cnic` is the key that decides **which enrolled children are
siblings** — see `lib/siblings.ts`. A column holding `4210112345671` on one row
and `42101-1234567-1` on another holds two different people as far as every
query is concerned, and the two are *indistinguishable on screen* because both
render as a masked field.

So an unmasked `<Input label="CNIC">` does not produce an ugly value. It
produces a family that silently stops being a family: the sibling card empties,
the family voucher splits in two, and nothing anywhere reports an error.

Before this rule there were four such inputs — the enrolment guardian step, the
guardian panel, the public application form and the staff record — and only the
*student's* own document had a mask. That is why the check exists rather than a
note in a review.

### Blank is always allowed

No screen may refuse to record a person because the card is not to hand. An
admissions desk with a queue in front of it will invent a number to get past a
required field, and an invented CNIC is worse than an absent one now that the
column decides who is related to whom. `cnicProblem` returns null for blank
everywhere.

---

## RULE: a guardian is a person, and the first one is a parent

Three rules, enforced on the form **and** in `parseGuardians` — the dropdown is
a courtesy to the clerk, the server is the rule:

1. **The first guardian must be Father, Mother or Sibling.** "Other" is the
   absence of an answer to "who does the school hold responsible for this
   child". `FIRST_GUARDIAN_RELATIONSHIPS` in `db/schema/student-guardians.ts`.
2. **Father and Mother are each available once per student.** A second row
   claiming either is a duplicate, and a duplicate is what splits one family in
   two on the sibling lookup and the family voucher.
   `SINGLETON_RELATIONSHIPS`, same file.
3. **"Other" carries `relationship_other`** — the relation in the school's own
   words. Required by the API whenever the relationship is `other`.

The one documented exception is
`POST /api/school/applications/[id]/convert`, which carries what the *applicant*
wrote on the public form weeks ago. A one-click conversion must not fail because
a parent described themselves as a guardian; the relationship is corrected on
the profile in one click, and refusing would lose the admission instead.

---

---

## RULE: a value never reaches the driver through a raw ``sql`` template

**Use the operator — `eq`, `lte`, `gte`, `inArray` — not `` sql`${column} <= ${value}` ``.**

A raw template is the one place Drizzle has no column to map the value against,
so it hands the JavaScript value straight to postgres-js. An operator goes
through the column's `mapToDriverValue` first.

For a `Date` against a `timestamp` column that difference is total:

```ts
sql`${announcements.scheduledAt} <= ${now}`   // param is a Date  -> throws
lte(announcements.scheduledAt, now)           // param is an ISO string -> works
```

The failure is `The "string" argument must be of type string or an instance of
Buffer or ArrayBuffer. Received an instance of Date [ERR_INVALID_ARG_TYPE]`, and
it names neither the column nor the file.

### Why this is a rule and not a style note

`lib/announcement-queries.ts` carried that first line from Sprint 11 until
2026-08-20. Every sweep threw before touching a row, so **no scheduled
announcement had ever been released at any school**, and nothing said so: the
sweeper caught the error and logged it, the screen went on saying "Scheduled",
and development never noticed because nothing there schedules anything.

Reserve `` sql`` `` for expressions that have no operator — `count(*) filter
(…)`, `extract(isodow from …)`, a cast. If you are writing a comparison, there
is an operator for it.

### And when you do write one: alias it to a name no joined table has

**Drizzle renders a column inside a `` sql`` `` template *unqualified*.** That is
the same rendering behaviour §5av of `STATE.md` records against the day book,
and it has now shipped a defect twice.

| Write | Not |
| --- | --- |
| `` sql`…`.as('guardian_phone') ``, referenced as `"primary_guardian"."guardian_phone"` | `` sql`…`.as('phone') `` |

The second one is Sprint 18's: an ordered aggregate aliased `phone`, in a
statement that also joins `school_users.phone`. Postgres refused the whole query
with 42702, `column reference "phone" is ambiguous`, and the all-students screen
was a 500 at every school for as long as it was live.

**Qualify every reference to it, including the one in the `WHERE`.** That is not
tidiness. In Sprint 18's query an unqualified `phone` in the `WHERE` would have
bound to `school_users.phone` — the `student:<admission number>` sentinel — and
searched the wrong column *silently* instead of failing.

**Nothing in the repository can catch this.** No check script executes a query,
so a green build says only that the SQL compiled, never that Postgres would
accept it. The gate is opening the screen.

---

## RULE: the ledger is append-only, and everything that moves money posts to it

**Nothing updates or deletes a row in `ledger_transactions` or
`ledger_entries`. A correction is a reversing entry.**

Enforced by `npm run check-accounting`, which runs in CI on every push.

| You are | Do |
| --- | --- |
| writing to the ledger | `postTransaction(tx, …)` — the only door |
| correcting a wrong entry | `reverseTransaction(tx, …)` — a mirror, both kept |
| taking money in code | post it *in the same transaction* as the record of it |
| reading a balance | `SUM` over the entries. There is no balance column |

### Why it is not a style preference

A parent disputing a figure in March is asking about a payment made in
October, and the only answer a school can give is the entry as it was written
plus everything that has happened to it since. A ledger that can be edited
answers "it says 5,000 now", which is not an answer.

Sprint 16 (JazzCash/Easypaisa and the parent wallet) and Sprint 20 (POS) both
post here, and both carry real money in and out of a parent's balance. The rule
has to hold *before* they arrive.

### Every posting is inside the transaction that caused it

A fee payment recorded without its posting understates the school's income, and
understates it **silently** — nothing on any screen would ever say so. So the
posting is not fired-and-forgotten like the WhatsApp confirmation beside it in
`…/challans/[challanId]/payments/route.ts`. It commits with the payment or the
payment does not happen.

### Debits equal credits, in whole paise

`lineProblem` in `lib/accounting.ts` is the check, and it runs in the poster,
in the browser form, and in the check script. `ledger_entries_one_side_check`
enforces the rest in the database. There is no code path that writes an
unbalanced transaction, including the ones nobody has written yet.

Money is integer paise throughout, exactly as `lib/money.ts` requires of the
fee module. A balance sheet out by four rupees is a balance sheet nobody trusts
again.

### Income is recognised on receipt, not on billing

A fee payment posts; raising a challan posts nothing. This is deliberate and
migration `0027`'s header says why at length. The consequence to remember:
**what is still owed is not in the ledger.** `1100 Fees Receivable` exists for
opening balances entered by hand, and the authoritative answer to "how much is
outstanding" stays in the fee module, which has a challan number attached to
every rupee of it.

### A cash payment lands in the drawer of whoever took it

Not in office cash — that is a different fact, and a school where the two are
the same number is a school where nobody can be short. `cashAccountForStaff`
answers with the clerk's own account when they have one and the office drawer
when they do not, so a school that has never opened a staff cash account
behaves exactly as it did before Sprint 13.5.

---

## RULE: background work is claimed, not checked

**Anything a timer picks up is claimed with a conditional `UPDATE … RETURNING`,
never with a read followed by an `if`.**

`instrumentation.ts` starts one scheduler per server process, and production
runs **seven** of them — visible in the log as seven distinct 60-second offsets
within the same minute. A read-then-check lets all seven pass the same test and
do the same work.

```ts
const claimed = await db.update(t).set({ status: 'sent' })
  .where(and(eq(t.id, id), ne(t.status, 'sent')))
  .returning({ id: t.id });
if (claimed.length === 0) return null;   // somebody else owns it
```

Postgres decides it on one row under one lock: exactly one caller gets a row.

**Claim first, then revert on failure.** Claiming moves the row before the work
is done, so a throw must hand it back or a transient failure becomes an
announcement the school believes went out and nobody received.

---

## Green build

All ten must pass before anything is merged:

```
npm run typecheck
npm run lint
npm run check-loaders
npm run check-forms
npm run check-address-phone
npm run check-cnic
npm run check-currency
npm run check-sprint-periods
npm run check-accounting
npm run build
```

Plus whichever of the other `check-*` scripts covers the area you touched —
`check-reports`, `check-dashboard`, `check-portals`, `check-provisioning`,
`check-smtp`.

`.github/workflows/ci.yml` runs the eight that need no database —
`check-loaders`, `check-forms`, `check-address-phone`, `check-cnic`,
`check-currency`, `check-theme`, `check-sprint-periods` and `check-accounting` —
on every push and pull request, so the loader, CNIC, currency and double-entry
rules are enforced by the repository and not only by whoever remembers them. The rest execute against the real schema and stay on a
machine that holds the credentials.

### Building in a worktree

Delete `D:\School-Management-System\.claude\worktrees\node_modules` before every
build. Standalone output writes a stub there and the *second* build in a
worktree always fails on a missing Next internal until it is gone. See
`STATE.md` §5f.
