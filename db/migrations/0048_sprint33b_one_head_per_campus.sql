-- Sprint 33b — one Principal and one Vice Principal per campus.
-- `SPRINT-33-SPEC.md` decision 2, and the product owner's decision of
-- 2026-09-16 that **divisions inside a campus are retired**. STATE.md §5ch.
--
-- ══ Why this is its own migration, and the order it must run in ═════════
-- Askari, the one `principal_model = 'multiple'` school, has four active
-- Principals on Main Campus — one per division. Imran Qureshi stays Principal;
-- the other three become Section Heads. That fixes the order:
--
--   1. `0047`   widens `school_users_role_check` so `section_head` is a value
--               the column will take at all;
--   2. deploy   the code that recognises the role — nobody may sign in as a
--               Section Head before the portal knows what one is;
--   3. `node scripts/apply-sprint33b-data.mjs --apply`
--               makes the three Section Heads and gives Imran the whole campus;
--   4. THIS     creates the indexes, which it can only do once step 3 has left
--               one head per campus.
--
-- Folded into `0047` it would have run before step 3 at every deploy and
-- skipped itself at Askari for ever.
--
-- ══ Counted first, and REPORTED rather than failed ══════════════════════
-- `CREATE UNIQUE INDEX … WHERE role = 'principal' AND is_active` fails
-- outright at a school that still has two, and a migration that fails on live
-- data leaves whoever ran it guessing what state they are in. So this is a DO
-- block that counts: a clean estate gets the four indexes; any duplicate is
-- raised as a WARNING naming the school, the campus and the role, the indexes
-- are skipped, and **nothing is deleted**. One of those two rows is a person
-- who signs in every morning. Resolve it and run this file again — every
-- statement is `IF NOT EXISTS`.
--
-- Read `pg_indexes`, not this file, to learn whether the rule is in force.
-- `scripts/check-sprint33b.ts` does.
--
-- ══ Four indexes, not two ════════════════════════════════════════════════
-- `school_users.branch_id` is nullable and a null means *the whole school*.
-- Postgres counts every NULL as distinct, so the per-campus index would not
-- constrain two school-wide Principals at all — they get an index of their own.
-- A school-wide head does **not** block a campus head; `lib/one-head-per-campus.ts`
-- asks exactly the question these indexes answer, and no stricter one.
--
-- ══ The sentence before the 23505 ════════════════════════════════════════
-- Every write that can make a head — creating a member, Invite Staff, "Create a
-- login" on HR, accepting an invitation, changing a role, campus or active flag,
-- reactivating from the operator panel, and the branch form's head field — asks
-- `headConflict` first and names the person already in post, and catches
-- `isOneHeadIndexConflict` for the race. Without that a school where this
-- migration succeeds would meet a raw unique violation on five screens.

DO $$
DECLARE
  duplicate record;
  found_any boolean := false;
BEGIN
  FOR duplicate IN
    SELECT su.location_id, su.branch_id, su.role, count(*) AS holders,
           string_agg(su.name, ', ' ORDER BY su.name) AS names
      FROM school_users su
     WHERE su.role IN ('principal', 'vice_principal')
       AND su.is_active
     GROUP BY su.location_id, su.branch_id, su.role
    HAVING count(*) > 1
  LOOP
    found_any := true;
    RAISE WARNING
      'Sprint 33b: % active % accounts at school % campus % (%) — the one-head-per-campus indexes are NOT being created. Nothing has been deleted; resolve it (scripts/apply-sprint33b-data.mjs for Askari) and run 0048 again.',
      duplicate.holders, duplicate.role, duplicate.location_id,
      coalesce(duplicate.branch_id::text, 'school-wide'), duplicate.names;
  END LOOP;

  IF found_any THEN
    RAISE WARNING 'Sprint 33b: skipped every school_users_one_*_idx — see the warnings above.';
    RETURN;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS "school_users_one_principal_per_branch_idx"
    ON "school_users" ("location_id", "branch_id")
    WHERE role = 'principal' AND is_active AND branch_id IS NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS "school_users_one_principal_school_wide_idx"
    ON "school_users" ("location_id")
    WHERE role = 'principal' AND is_active AND branch_id IS NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS "school_users_one_vice_principal_per_branch_idx"
    ON "school_users" ("location_id", "branch_id")
    WHERE role = 'vice_principal' AND is_active AND branch_id IS NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS "school_users_one_vice_principal_school_wide_idx"
    ON "school_users" ("location_id")
    WHERE role = 'vice_principal' AND is_active AND branch_id IS NULL;

  RAISE NOTICE 'Sprint 33b: one Principal and one Vice Principal per campus is now enforced.';
END
$$;
