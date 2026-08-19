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

## Green build

All six must pass before anything is merged:

```
npm run typecheck
npm run lint
npm run check-loaders
npm run check-forms
npm run check-address-phone
npm run build
```

Plus whichever of the other `check-*` scripts covers the area you touched —
`check-reports`, `check-dashboard`, `check-portals`, `check-provisioning`,
`check-theme`, `check-smtp`.

### Building in a worktree

Delete `D:\School-Management-System\.claude\worktrees\node_modules` before every
build. Standalone output writes a stub there and the *second* build in a
worktree always fails on a missing Next internal until it is gone. See
`STATE.md` §5f.
