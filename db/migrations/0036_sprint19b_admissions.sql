-- Sprint 19b — admissions: campus calendars, documents and the guardian's address.
--
-- Three blocks, one migration, and every one of them expand-only: one new join
-- table, one new table, and three new nullable columns with no default. No
-- existing column is altered, no row is rewritten, and nothing serving today
-- reads any of it — so this is safe to apply while the *old* build is still up,
-- which is the order it will actually be applied in.
--
-- The opposite order is not safe, and the failure is not subtle. Blocks 1 and 2
-- are both read on screens that already exist:
--
--   • `listAcademicYears` selects from `academic_year_branches` on every render
--     of /dashboard/admissions/academic-years, of the promotion screen and of
--     the enrolment wizard's year picker;
--   • the student profile selects from `student_documents` on every render.
--
-- A build deployed ahead of this migration takes all of those down at once with
-- `relation "academic_year_branches" does not exist` — the §5aw failure, two
-- sprints on, and the reason `0029` and `0035` carry the banners they do.
-- `SPRINT-19B-DDL-NOTES.md` at the repo root states it in full, screen by
-- screen, with the order to apply it in.
--
-- **No new permission keys.** 19b reuses `admissions.read` / `admissions.write`
-- for the calendar, `students.read` / `students.update` for documents and
-- `exams.read` for the academic history, so the `role_permissions` CHECK is
-- untouched. That is deliberate: a permission is a question a school has to
-- answer on the permissions screen, and none of these is a new *kind* of thing
-- a school would want to grant separately from what it already grants.
--
-- ── Block 1: academic_year_branches ──────────────────────────────────────
-- A school group's campuses do not share a calendar. An April–March campus and
-- an August–July campus both exist inside one tenant, and before this the year
-- picker offered every campus's sessions to every campus's clerk with nothing
-- to tell them apart. Enrolling a Lahore child into the Karachi session is not
-- an error any constraint can catch — both rows are valid — and it surfaces
-- months later as a report card printed against the wrong term window.
--
-- **A year with no rows here is school-wide**, which is every academic year at
-- every school on the day this deploys. Absence means "all of them", so nothing
-- is backfilled and no existing year changes meaning. It is decision D1's
-- "null means shared" expressed as a join table, because a year can run at two
-- campuses out of three and one column cannot say that.
--
-- Rejected: a nullable `academic_years.branch_id`. It would have been one
-- column and one index instead of a table, and it cannot express the two-of-
-- three case at all — which is the case a group with a separate O-Levels campus
-- has on day one.
--
-- ON DELETE CASCADE on **both** parents, and that is deliberately *not* the
-- SET NULL rule `0035` used for the nine catalogue tables. A catalogue row
-- whose campus is deleted is still the school's grading scheme, so it becomes
-- shared. A row here says only "this year runs at this campus"; with the campus
-- gone the statement is not school-wide, it is meaningless, and SET NULL is not
-- even available — the column is NOT NULL, because a row naming no campus is
-- the absence this table encodes by having no row at all.
--
-- ── Block 2: student_documents ───────────────────────────────────────────
-- The paperwork a school already keeps in a filing cabinet: a B-Form, a birth
-- certificate, the last school's leaving certificate. Ten per student, 5 MB
-- each, PNG or JPEG only.
--
-- The two CHECKs on size and title are belt-and-braces over limits the route
-- already enforces, and they are worth the DDL because the row and the object
-- are two records of the same fact stored in two systems. A `size_bytes` that
-- cannot be true means they have stopped describing each other, and the row is
-- the one nobody can check by looking at it.
--
-- `content_type` is restricted to the two canonical types and never to
-- `image/jpg`, which is not a media type — it is what some Windows browsers
-- send. The route stores what the *bytes* say, not what the upload claimed, so
-- a file whose header said `image/jpg` lands here as `image/jpeg`.
--
-- ── Block 3: student_guardians address, latitude, longitude ──────────────
-- Item 18, and the shape is copied from `branches` on purpose: `text` plus two
-- `double precision` columns, filled by `AddressAutocomplete`, both coordinates
-- null whenever the operator typed the address by hand. That is the common case
-- in Pakistan and it is not a degraded one — Mapbox's data there is cities and
-- localities, so most real addresses produce no suggestion at all.
--
-- **Never required, and no NOT NULL is ever coming.** CLAUDE.md's "blank is
-- always allowed" rule is written about the CNIC and the reasoning transfers
-- whole: an admissions desk with a queue in front of it will invent an answer
-- to get past a required field, and an invented address on a fee notice is
-- worse than an absent one.

-- ─────────────────────────────────────────────────────────────────────────
-- Block 1 — academic_year_branches
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "academic_year_branches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL,
  "academic_year_id" uuid NOT NULL,
  "branch_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "academic_year_branches" ADD CONSTRAINT "academic_year_branches_location_id_schools_location_id_fk"
    FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "academic_year_branches" ADD CONSTRAINT "academic_year_branches_academic_year_id_academic_years_id_fk"
    FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "academic_year_branches" ADD CONSTRAINT "academic_year_branches_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- Saying the same thing twice is not saying it twice. The run writer leans on
-- this: a run interrupted half way and re-run must not bank a second row for a
-- campus it has already attached.
CREATE UNIQUE INDEX IF NOT EXISTS "academic_year_branches_year_branch_idx" ON "academic_year_branches" USING btree ("academic_year_id", "branch_id");--> statement-breakpoint
-- Tenant-first, like every read in this repository.
CREATE INDEX IF NOT EXISTS "academic_year_branches_location_year_idx" ON "academic_year_branches" USING btree ("location_id", "academic_year_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academic_year_branches_location_branch_idx" ON "academic_year_branches" USING btree ("location_id", "branch_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- Block 2 — student_documents
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "student_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL,
  "student_profile_id" uuid NOT NULL,
  "title" text NOT NULL,
  "storage_path" text NOT NULL,
  "download_url" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "uploaded_by_uid" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "student_documents_content_type_check" CHECK ("content_type" IN ('image/png', 'image/jpeg')),
  CONSTRAINT "student_documents_title_check" CHECK (char_length(btrim("title")) BETWEEN 1 AND 120),
  CONSTRAINT "student_documents_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 5242880)
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_location_id_schools_location_id_fk"
    FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_student_profile_id_student_profiles_id_fk"
    FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "student_documents_location_student_idx" ON "student_documents" USING btree ("location_id", "student_profile_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- Block 3 — the guardian's address
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "student_guardians" ADD COLUMN IF NOT EXISTS "address" text;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD COLUMN IF NOT EXISTS "latitude" double precision;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD COLUMN IF NOT EXISTS "longitude" double precision;
