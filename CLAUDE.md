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

## Green build

All six must pass before anything is merged:

```
npm run typecheck
npm run lint
npm run check-loaders
npm run check-forms
npm run check-address-phone
npm run check-cnic
npm run check-sprint-periods
npm run build
```

Plus whichever of the other `check-*` scripts covers the area you touched —
`check-reports`, `check-dashboard`, `check-portals`, `check-provisioning`,
`check-smtp`.

`.github/workflows/ci.yml` runs the six that need no database —
`check-loaders`, `check-forms`, `check-address-phone`, `check-cnic`,
`check-theme` and `check-sprint-periods` — on every push and pull request, so
the loader and CNIC rules are enforced by the repository and not only by
whoever remembers them. The rest execute against the real schema and stay on a
machine that holds the credentials.

### Building in a worktree

Delete `D:\School-Management-System\.claude\worktrees\node_modules` before every
build. Standalone output writes a stub there and the *second* build in a
worktree always fails on a missing Next internal until it is gone. See
`STATE.md` §5f.
