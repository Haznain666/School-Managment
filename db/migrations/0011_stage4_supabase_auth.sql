-- Stage 4 — Firebase Authentication → Supabase Auth.
--
-- The column is a join key to the identity provider, so renaming it is most of
-- the schema change. What the column *means* changed more than its name did:
--
--   Under Firebase each school minted its own derived account, so a uid was
--   unique across the whole table. Under Supabase one person has one account
--   (`auth.users.id`) and belongs to as many schools as they have rows here.
--   The global UNIQUE on school_users therefore has to go, replaced by a
--   per-tenant one — which is also the index `lib/school-auth.ts` reads on
--   every authenticated request.
--
-- No data migration: development only, and no Firebase user export was taken
-- (STATE.md §3). Existing values are stale uids that no longer resolve; they
-- are left in place rather than nulled so a row still records whether the
-- invitation had been accepted.
--
-- Written by hand rather than by `drizzle-kit generate`, which cannot run
-- non-interactively here: it prompts to disambiguate a rename from a drop plus
-- a create. `meta/0011_snapshot.json` was derived from 0010 by applying exactly
-- these renames, so the two agree.

ALTER TABLE "users" RENAME COLUMN "firebase_uid" TO "auth_user_id";
--> statement-breakpoint
ALTER INDEX "users_firebase_uid_idx" RENAME TO "users_auth_user_id_idx";
--> statement-breakpoint
ALTER TABLE "users" RENAME CONSTRAINT "users_firebase_uid_unique" TO "users_auth_user_id_unique";
--> statement-breakpoint
ALTER TABLE "school_users" RENAME COLUMN "firebase_uid" TO "auth_user_id";
--> statement-breakpoint
ALTER INDEX "school_users_firebase_uid_idx" RENAME TO "school_users_auth_user_id_idx";
--> statement-breakpoint
ALTER TABLE "school_users" DROP CONSTRAINT IF EXISTS "school_users_firebase_uid_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "school_users_location_id_auth_user_id_idx" ON "school_users" USING btree ("location_id","auth_user_id");
--> statement-breakpoint
ALTER TABLE "emergency_login_tokens" RENAME COLUMN "firebase_uid" TO "auth_user_id";
--> statement-breakpoint
ALTER TABLE "emergency_login_tokens" ALTER COLUMN "auth_user_id" DROP NOT NULL;
