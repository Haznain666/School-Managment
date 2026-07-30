CREATE TABLE "schools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"city" text NOT NULL,
	"address" text,
	"phone" text,
	"email" text,
	"principal_name" text,
	"logo_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schools_location_id_unique" UNIQUE("location_id"),
	CONSTRAINT "schools_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "school_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"module_key" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"enabled_at" timestamp with time zone,
	"enabled_by" text,
	CONSTRAINT "school_modules_module_key_check" CHECK (module_key IN ('admissions', 'fee_management', 'academics', 'lms', 'hr_payroll', 'accounts', 'event_mgmt', 'transport', 'library', 'hostel'))
);
--> statement-breakpoint
CREATE TABLE "school_branding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"logo_url" text,
	"logo_storage_path" text,
	"selected_palette" integer DEFAULT 0 NOT NULL,
	"palette_0" jsonb,
	"palette_1" jsonb,
	"palette_2" jsonb,
	"custom_css_vars" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_branding_location_id_unique" UNIQUE("location_id")
);
--> statement-breakpoint
ALTER TABLE "branches" DROP CONSTRAINT "branches_secondary_path_check";--> statement-breakpoint
ALTER TABLE "ghl_tokens" DROP CONSTRAINT "ghl_tokens_location_id_school_subdomains_location_id_fk";
--> statement-breakpoint
ALTER TABLE "branches" DROP CONSTRAINT "branches_location_id_school_subdomains_location_id_fk";
--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_location_id_school_subdomains_location_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_location_id_school_subdomains_location_id_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_location_id_school_subdomains_location_id_fk";
--> statement-breakpoint
ALTER TABLE "staff" DROP CONSTRAINT "staff_location_id_school_subdomains_location_id_fk";
--> statement-breakpoint
DROP INDEX "branches_location_id_status_idx";--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "curriculum_level" text NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "max_grade" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "is_main_branch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "school_modules" ADD CONSTRAINT "school_modules_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_branding" ADD CONSTRAINT "school_branding_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schools_location_id_idx" ON "schools" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "schools_slug_idx" ON "schools" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "schools_is_active_idx" ON "schools" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "schools_city_idx" ON "schools" USING btree ("city");--> statement-breakpoint
CREATE INDEX "school_modules_location_id_idx" ON "school_modules" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_modules_location_id_module_key_idx" ON "school_modules" USING btree ("location_id","module_key");--> statement-breakpoint
CREATE INDEX "school_branding_location_id_idx" ON "school_branding" USING btree ("location_id");--> statement-breakpoint
ALTER TABLE "ghl_tokens" ADD CONSTRAINT "ghl_tokens_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branches_location_id_is_active_idx" ON "branches" USING btree ("location_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_location_id_code_idx" ON "branches" USING btree ("location_id","code");--> statement-breakpoint
ALTER TABLE "branches" DROP COLUMN "secondary_path";--> statement-breakpoint
ALTER TABLE "branches" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_curriculum_level_check" CHECK ("branches"."curriculum_level" IN ('MATRIC', 'O_LEVELS', 'A_LEVELS', 'MIXED'));