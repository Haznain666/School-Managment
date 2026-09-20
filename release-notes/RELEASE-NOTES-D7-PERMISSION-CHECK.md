# Release notes — the permission check that could not read its own list

**Date:** 20 September 2026
**Not a sprint.** `PENDING.md` **D7**, opened 2026-09-20 and closed the same
day. Narrative in `STATE.md` §5cn.
**Migration:** none, and that is the finding — see *Why no migration*.
**Status:** merged.
**Anything a school will notice:** nothing. No screen, route, permission or
database object changed. This release is entirely about a check that was
reporting a defect the product did not have.

## What was reported

`npm run check-sprint28` failed on one line:

```
FAIL  db/migrations/0049_sprint33c_portal_work.sql names every key in PERMISSIONS
      missing: kpis.rate.teacher, kpis.rate.coordinator, kpis.rate.vice_principal,
      kpis.rate.hr_manager, kpis.rate.accountant, kpis.rate.marketing,
      kpis.rate.section_head — the first school to override one of those gets a 23514
```

Read literally, that is a live defect with a named victim: a school that opens
the permissions matrix and grants one of those seven KPI-rating rights to a
different role would have its save refused by the database with a `23514`, on a
form that had never failed before. It cites CLAUDE.md's own standing rule — *a
new permission key needs a migration, not just a line in the list* — and the
remedy looked obvious: write the migration.

## What was actually true

**The seven keys were never missing.** Three independent readings, all taken
before any code was changed:

| Checked | Result |
| --- | --- |
| `0049_sprint33c_portal_work.sql`, the constraint's own `IN (…)` clause | all seven are listed |
| `npm run check-branch-scope`, which makes the same comparison on the same file and is in CI | **PASS**, 1792 assertions |
| the **live** `role_permissions_permission_check`, read from `pg_constraint` | 61 keys, every one of the seven present |

No school could ever have hit the `23514` the failure predicted.

## What the defect was

One line in `scripts/check-sprint28.ts`, unchanged since Sprint 28:

```ts
[...migration.body.matchAll(/'([a-z]+\.[a-z]+)'/g)]
```

That pattern reads a permission key as *two* segments of lowercase letters.
Against `'kpis.rate.teacher'` it matches `kpis.rate`, then requires the closing
quote and finds a third dot — so the key does not match **at all**. `[a-z]`
also excludes the underscore, putting `kpis.rate.vice_principal` and
`kpis.rate.hr_manager` out of reach twice over.

The consequence people saw was a false alarm. The consequence that mattered is
the other direction: **a three-segment key genuinely missing from the
constraint would have been just as invisible**, so for eight sprints this
assertion could not have caught the failure it exists to catch.

`check-branch-scope` had already been through this — its comment records
Sprint 32's underscore keys being "reported missing from a CHECK that names
them" — but the fix was never carried across. Two checks in one repository
disagreed about one file for eight sprints, one green and one red.

## Why no migration

The instruction this work started from was to write `0052`, dropping and
re-adding the constraint with the full key list. It was not written, for two
reasons.

It would add nothing: every key it would name is already in `0049` and already
in the live database.

And it would not have fixed the failure. `check-sprint28` looks up whichever
migration most recently defines the constraint — so it would have found `0052`,
applied the same broken pattern, matched the same 54 of 61 keys, and printed
the same seven as missing. The check would have gone red **on a migration
written specifically to satisfy it**, and the next session would have been
asked for `0053`.

## What changed

`scripts/check-sprint28.ts` only.

1. **The parse is scoped and widened** — the constraint's `IN (…)` clause
   rather than the whole migration file, with a pattern that can read every key
   shape the catalogue actually uses. A key promised in a comment two hundred
   lines above the constraint no longer counts as the key being there.

2. **A pattern that drops keys now says so.** A new assertion counts the quoted
   literals in the clause and requires the parse to have matched all of them.
   This is the one that matters: an under-matching pattern produces a long
   "missing" list and an empty "extra" list, which on screen is *indistinguishable*
   from a migration somebody forgot to write. That ambiguity is the entire
   reason D7 was filed as a missing migration. It is now named:

   ```
   FAIL  every quoted literal in the clause was parsed
         the clause holds 61 literals and the pattern matched 54 — the pattern is
         dropping keys, so "missing" below is about the pattern and not about the migration
   ```

   Verified by reverting to the old pattern and watching it fire, which is the
   only way to know a guard works.

3. **Every permission key is now proved against the live constraint by
   attempt.** Previously one key was attempted and the other sixty rested on
   the regex — which is precisely why a broken regex was the only thing anybody
   heard from. Each key now gets its own insert against the real CHECK, inside a
   transaction that is always rolled back, with the table's row count read back
   afterwards to prove nothing was written.

## Evidence

```
PERMISSIONS and the newest migration’s CHECK are the same set:
  ok    db/migrations/0049_sprint33c_portal_work.sql carries a readable "permission" IN (…) clause
  ok    every quoted literal in the clause was parsed
  ok    db/migrations/0049_sprint33c_portal_work.sql names every key in PERMISSIONS
  ok    db/migrations/0049_sprint33c_portal_work.sql names no key the code does not

The widened permission CHECK, proved by attempt:
  ok    fees.admission is accepted by the CHECK
  ok    fees.invent is refused with 23514
  ok    all 60 other keys in PERMISSIONS are accepted by the live CHECK
  ok    nothing was written by any of those attempts

PASS — 51 ok, 0 failed or not exercised
```

All fifteen green-build commands pass, including `npm run build`.

## The lesson worth keeping

CLAUDE.md already says a constraint is proved **by attempt and not by reading
it**, and gives one reason: a CHECK that was dropped and never re-added leaves
every row count identical. D7 is the second reason, and it points the other
way — **a read can be wrong about a constraint that is entirely correct.**

More generally: a failing check is evidence about the check until its claim has
been tested independently. Here that cost three readings and about twenty
minutes; writing the migration the failure asked for would have cost a
permanent file in the tree, an applied production migration, and a check still
red at the end of it.
