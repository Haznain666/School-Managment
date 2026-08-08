-- GoHighLevel stops being the tenant identity.
--
-- `schools.location_id` began as the GHL Location ID, which meant no school
-- could be created without a GHL sub-account. GHL is now an opt-in per-school
-- integration, so the two roles that column was playing are split:
--
--   location_id      the tenant key. Foreign key on 43 tables. Now set to the
--                    school's own `id` at creation. Keeps its name because
--                    renaming it touches ~1,241 places for cosmetics.
--   ghl_location_id  the GHL sub-account, null until a school connects one.
--                    This is the value that goes to the GoHighLevel API.
--
-- Backfilled for existing rows: every school that exists today was created
-- when the two were the same thing, so its location_id *is* its GHL sub-account
-- and copying it across preserves that. Schools created from now on get a null
-- until an operator connects GHL from the Super Admin panel.
--
-- Written by hand for the same reason 0011 and 0012 were: drizzle-kit generate
-- cannot run non-interactively here. The snapshot was derived from 0012 by
-- applying exactly this change.

ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "ghl_location_id" text;
--> statement-breakpoint
UPDATE "schools" SET "ghl_location_id" = "location_id" WHERE "ghl_location_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_ghl_location_id_unique" UNIQUE ("ghl_location_id");
