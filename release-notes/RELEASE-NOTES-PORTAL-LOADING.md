# Release notes: portal loading

**Branch:** `claude/youthful-meninsky-68e84b`
**Migration:** none. `0045` is still the next free migration number.

---

## For the school

**Every portal page now shows its own loading shape, and only its own.**

When anyone opened a page inside a portal directly (from a bookmark, a link in
a message, or by refreshing), the screen could first show the portal
*dashboard's* loading placeholder, with tiles and two charts, and then switch
to that page's own placeholder before the page itself arrived. The same thing
happened on the public admissions form: opening the "application received"
page first showed an empty application form.

This is the change made to the parent portal on 2026-09-13, now applied to:

| Portal | Home page | Pages that no longer flash its placeholder |
| --- | --- | --- |
| School admin | `/dashboard` | fees, users, calendar, reports and every other `/dashboard/…` page |
| Teacher | `/teacher` | attendance, timetable, marks and every other `/teacher/…` page |
| Student | `/student` | results, fees, timetable and every other `/student/…` page |
| Super Admin | `/super-admin` | schools, modules, feedback, search |
| Admissions (public) | `/apply` | `/apply/success` |

Each home page still shows its own placeholder. No address has changed, and
nothing anyone sees once a page has loaded has changed.

---

## For whoever maintains this

**Why.** A `loading.tsx` is a Suspense boundary for its segment *and every
segment below it*. Each of these portals kept its home page's `loading.tsx`
beside the home `page.tsx` at the portal root, so it also wrapped every
sub-route. A hard load of a sub-route streamed that skeleton first and the
sub-route's own skeleton nested inside it: two boundaries where one was needed,
and the wrong shape first. STATE.md §5by has the parent-portal investigation;
§5bz has this one.

| File | Change |
| --- | --- |
| `app/(school-admin)/dashboard/(home)/page.tsx`, `loading.tsx` | moved from `app/(school-admin)/dashboard/`; still `/dashboard` |
| `app/(teacher)/teacher/(home)/page.tsx`, `loading.tsx` | moved from `app/(teacher)/teacher/`; still `/teacher` |
| `app/(student)/student/(home)/page.tsx`, `loading.tsx` | moved from `app/(student)/student/`; still `/student` |
| `app/(super-admin)/super-admin/(home)/page.tsx`, `loading.tsx` | moved from `app/(super-admin)/super-admin/`; still `/super-admin` |
| `app/(public)/apply/(home)/page.tsx`, `loading.tsx` | moved from `app/(public)/apply/`; still `/apply` |

Each moved `loading.tsx` carries a docblock paragraph saying why it lives in the
group. File contents are otherwise unchanged; nothing imported these files by
path.

**The pattern, for any new portal:** a root page that has sibling routes goes
in a `(home)` group together with its loader. `check-loaders` does not enforce
this (a root loader beside a root page is legal), so it is recorded here and
in STATE.md.
