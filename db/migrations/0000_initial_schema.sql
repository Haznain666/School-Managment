CREATE TABLE "school_subdomains" (
	"subdomain" text PRIMARY KEY NOT NULL,
	"location_id" text NOT NULL,
	"school_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"module_flags" jsonb DEFAULT '{"events":false,"hr":false,"payroll":false,"accounts":false,"lms":false}'::jsonb NOT NULL,
	"color_palette" jsonb,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_subdomains_location_id_unique" UNIQUE("location_id")
);
--> statement-breakpoint
CREATE TABLE "ghl_tokens" (
	"location_id" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token_type" text DEFAULT 'location' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"secondary_path" text,
	"address" text,
	"phone" text,
	"ghl_custom_object_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_secondary_path_check" CHECK ("branches"."secondary_path" IS NULL OR "branches"."secondary_path" IN ('matric', 'o-level', 'a-level'))
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"location_id" text NOT NULL,
	"role" text NOT NULL,
	"branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_role_check" CHECK ("user_roles"."role" IN ('super_admin', 'school_admin', 'principal', 'vice_principal', 'coordinator', 'teacher', 'hr_manager', 'accountant', 'marketing', 'student', 'parent'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"firebase_uid" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"user_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid"),
	CONSTRAINT "users_user_type_check" CHECK ("users"."user_type" IN ('staff', 'student', 'parent'))
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"branch_id" uuid,
	"user_id" uuid,
	"admission_number" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" date,
	"gender" text,
	"class_name" text,
	"section" text,
	"guardian_name" text,
	"guardian_phone" text,
	"ghl_contact_id" text,
	"status" text DEFAULT 'enrolled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_status_check" CHECK ("students"."status" IN ('enrolled', 'graduated', 'withdrawn', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"branch_id" uuid,
	"user_id" uuid NOT NULL,
	"employee_code" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"designation" text,
	"department" text,
	"employment_type" text,
	"joined_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_status_check" CHECK ("staff"."status" IN ('active', 'on_leave', 'resigned')),
	CONSTRAINT "staff_employment_type_check" CHECK ("staff"."employment_type" IS NULL OR "staff"."employment_type" IN ('full_time', 'part_time', 'contract', 'visiting'))
);
--> statement-breakpoint
ALTER TABLE "ghl_tokens" ADD CONSTRAINT "ghl_tokens_location_id_school_subdomains_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."school_subdomains"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_location_id_school_subdomains_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."school_subdomains"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_location_id_school_subdomains_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."school_subdomains"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_location_id_school_subdomains_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."school_subdomains"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_location_id_school_subdomains_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."school_subdomains"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_location_id_school_subdomains_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."school_subdomains"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_subdomains_location_id_idx" ON "school_subdomains" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "school_subdomains_status_idx" ON "school_subdomains" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ghl_tokens_location_id_idx" ON "ghl_tokens" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "ghl_tokens_expires_at_idx" ON "ghl_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "branches_location_id_idx" ON "branches" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "branches_location_id_status_idx" ON "branches" USING btree ("location_id","status");--> statement-breakpoint
CREATE INDEX "user_roles_location_id_idx" ON "user_roles" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "user_roles_user_id_idx" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_roles_location_id_role_idx" ON "user_roles" USING btree ("location_id","role");--> statement-breakpoint
CREATE INDEX "users_location_id_idx" ON "users" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_location_id_email_idx" ON "users" USING btree ("location_id","email");--> statement-breakpoint
CREATE INDEX "users_firebase_uid_idx" ON "users" USING btree ("firebase_uid");--> statement-breakpoint
CREATE INDEX "students_location_id_idx" ON "students" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "students_location_id_branch_id_idx" ON "students" USING btree ("location_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_location_id_admission_number_idx" ON "students" USING btree ("location_id","admission_number");--> statement-breakpoint
CREATE INDEX "staff_location_id_idx" ON "staff" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "staff_location_id_branch_id_idx" ON "staff" USING btree ("location_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_location_id_employee_code_idx" ON "staff" USING btree ("location_id","employee_code");