-- Sprint 21 — one email is one person.
--
-- Three steps and they are ordered. Two repairs of rows that already exist,
-- then the constraint that stops them being made again. The constraint last is
-- not tidiness: step 1 finds a father's parent row **by the address on the
-- child's row**, and step 2 is what removes that address. Reorder them and step
-- 1 matches nothing, silently, and every affected family stays broken while the
-- migration reports success.
--
-- ── What went wrong, so nobody re-litigates the repair ───────────────────
-- A student's `school_users` row used to borrow the primary guardian's mobile.
-- `school_users` is unique on (location, phone), so parent-portal provisioning
-- — which upserts on exactly that pair — landed on **the child's row**, wrote
-- the father's email onto it, and pointed `student_guardians.school_user_id` at
-- it. He accepted his invite; GoTrue bound his auth uid to a row whose role is
-- `student`. `school_users_location_id_auth_user_id_idx` is unique per school,
-- so from that moment his uid could never also sit on his own `parent` row.
--
-- He was permanently in the student portal, signed in as one of his own five
-- children, and the other four were unreachable by any login he possessed. The
-- screenshot that opened this sprint is a father looking at his daughter's
-- results page and being told his children's information is missing.
--
-- `lib/enrollment.ts` stopped creating rows that way when the
-- `student:<admission number>` sentinel became unconditional. **It repaired
-- nothing.** The rows already carrying a guardian's number were still there,
-- and nothing stopped the upsert landing on them again — which is why this
-- migration exists at all and why Sprint 21 also closed the code path.
--
-- ── Atomic without a BEGIN ───────────────────────────────────────────────
-- drizzle-orm's migrator runs each migration file inside one transaction, so
-- the three steps commit together or not at all. An explicit `BEGIN` here would
-- be a nested transaction the migrator did not ask for; the atomicity the spec
-- requires is already the migrator's.
--
-- `SPRINT-21-DDL-NOTES.md` at the repo root states the order to apply it in,
-- how to verify it, what it cannot fix, and the one thing an operator has to do
-- afterwards.
--
-- **No new permission keys**, so the `role_permissions` `permission` CHECK is
-- untouched — the trap STATE.md §5o records. Nothing here is a new kind of
-- thing a school would grant separately; it is the same tables, told the truth.

-- ── Step 1: a guardian is never linked to a child's directory row ────────
--
-- Re-pointed to the `parent` row at the same school carrying the same
-- `lower(email)`, and set to NULL where there is no such row.
--
-- NULL is the deliberate answer rather than "leave it alone". A wrong link is
-- worse than no link: `student_guardians.school_user_id` is what the parent
-- portal follows to decide which children a signed-in person may see, so a link
-- left pointing at a child is one family reading another child's attendance,
-- results and fee ledger. No link shows an empty portal and an administrator
-- one click from fixing it, which is a bad day rather than a breach.
--
-- Matched on the address and not on the phone. The phone is precisely the
-- column that was wrong — it is how the two rows got confused in the first
-- place — and matching on it would re-point the link straight back at the same
-- mistake.
UPDATE "student_guardians" AS sg
   SET "school_user_id" = (
         SELECT p."id"
           FROM "school_users" p
          WHERE p."location_id" = wrong."location_id"
            AND p."role" = 'parent'
            AND p."email" IS NOT NULL
            AND p."email" <> ''
            AND wrong."email" IS NOT NULL
            AND wrong."email" <> ''
            AND lower(p."email") = lower(wrong."email")
          -- Oldest first. There may be two only while the index in step 3 does
          -- not yet exist; after it there can be one, and an ordered pick means
          -- re-running this migration cannot choose differently the second time.
          ORDER BY p."created_at", p."id"
          LIMIT 1)
  FROM "school_users" AS wrong
 WHERE wrong."id" = sg."school_user_id"
   AND wrong."role" = 'student';--> statement-breakpoint

-- ── Step 2: give the child back their sentinel, and unbind the account ───
--
-- Only rows that are demonstrably the defect: a `student` row whose phone is
-- not the sentinel **and** whose phone or address matches a guardian's contact
-- detail at the same school. A student row with a phone of its own that no
-- guardian shares is left exactly as it is — this migration is not a tidy-up of
-- other people's data, and a school that deliberately recorded a sixth-former's
-- own mobile has done nothing wrong.
--
-- `auth_user_id` becoming NULL is the point of the whole step. Everything else
-- here is bookkeeping; unbinding is what frees the father's Supabase account to
-- bind to his own parent row the next time he signs in. It costs the child
-- nothing, because that account was never the child's.
--
-- It does mean the affected person must sign in with an emailed code rather
-- than a saved password once: `getSchoolUserByUid` answers null for an unbound
-- uid, and `otp/verify` is the only path that binds one. The DDL notes say so.
UPDATE "school_users" AS su
   SET "phone" = 'student:' || sp."student_id",
       "email" = NULL,
       "auth_user_id" = NULL,
       "updated_at" = now()
  FROM "student_profiles" AS sp
 WHERE sp."school_user_id" = su."id"
   AND su."role" = 'student'
   AND su."phone" <> 'student:' || sp."student_id"
   AND EXISTS (
         SELECT 1
           FROM "student_guardians" sg
          WHERE sg."location_id" = su."location_id"
            AND (sg."phone" = su."phone"
                 OR (su."email" IS NOT NULL
                     AND su."email" <> ''
                     AND sg."email" IS NOT NULL
                     AND lower(sg."email") = lower(su."email"))));--> statement-breakpoint

-- ── Step 3: and now nothing can do it again ──────────────────────────────
--
-- Partial, on `lower(email)`, and scoped to the active.
--
--   · `lower()` because one inbox is one inbox. A constraint that admitted
--     `Father@Example.com` beside `father@example.com` would only ever catch
--     the careful, and every sign-in path resolves the address case-insensitively
--     from Sprint 21 on;
--   · `email IS NOT NULL AND email <> ''` because the column is nullable and a
--     school with forty staff who have no address on file is normal, not a
--     school with thirty-nine duplicates;
--   · `is_active` because a teacher who left in June and is re-hired in
--     September must not be blocked by her own archived membership. A leaver is
--     history, and history does not get to hold an address.
--
-- **If this refuses to build, steps 1 and 2 missed a duplicate.** That is the
-- migration telling the truth rather than the constraint arriving broken: the
-- whole file rolls back, nothing is half-repaired, and the query in the DDL
-- notes names the rows to look at. Do not weaken the index to get past it.
CREATE UNIQUE INDEX IF NOT EXISTS "school_users_location_email_active_idx"
    ON "school_users" USING btree ("location_id", lower("email"))
 WHERE "email" IS NOT NULL AND "email" <> '' AND "is_active";
