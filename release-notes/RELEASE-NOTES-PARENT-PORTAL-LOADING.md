# Release notes: parent portal loading

**Branch:** `claude/great-bouman-c2ca47`
**Migration:** none. `0045` is still the next free migration number.

---

## For the school

**Parent pages now show the right loading shape, and the header arrives in one
piece.**

When a parent opened any parent page other than the dashboard directly — from
a bookmark, a link in a message, or by refreshing — the screen briefly showed
the *dashboard's* loading placeholder (tiles and two charts) before switching
to that page's own placeholder, and then to the page. On a report card that was
two jumps where one was intended.

Each parent page now shows only its own placeholder while it loads. The
dashboard still shows its tiles-and-charts placeholder, and only on the
dashboard.

The "Viewing" child selector in the top bar also now appears with the rest of
the bar instead of a moment later.

Nothing a parent sees once a page has loaded has changed.

---

## For whoever maintains this

**Why.** Capturing screens for the SchoolHub demo film, `/parent/results`
logged React error #418 (a hydration mismatch) followed by `$RS` failing on
`parentNode`. It proved intermittent — one load in about forty on live, none in
about thirty-five locally — and no value on the page differs between server and
browser. What it did show is that a hard load of any `/parent/*` route streamed
**three** Suspense boundaries: the header's child switcher, the dashboard's
`loading.tsx` wrapping every sibling route, and the page's own `loading.tsx`
nested inside it. Two of those were defects in their own right. STATE.md §5by
has the full investigation.

| File | Change |
| --- | --- |
| `components/parent/ParentNavbar.tsx` | `ChildSwitcher` no longer wrapped in `Suspense`; docblock said the boundary was never hit in production, and it was hit on every load |
| `app/(parent)/parent/(home)/page.tsx` | moved from `app/(parent)/parent/page.tsx`; still serves `/parent` |
| `app/(parent)/parent/(home)/loading.tsx` | moved with it, so the dashboard skeleton no longer wraps `/parent/results`, `/parent/fees` and the rest |

**Not claimed:** that #418 cannot recur. The remaining trigger is timing inside
React's batched Suspense reveal in the React canary vendored by Next 15.5.x
(`19.2.0-canary-0bdb9206-20250818`, unchanged through `15.5.25`).

**Same shape elsewhere, not changed here:** the teacher, student, school-admin
and super-admin portals each have a root `loading.tsx` beside a root
`page.tsx`, so the same wrong-shape flash applies to their sub-routes.
