CREATE TABLE "academic_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"name" text NOT NULL,
	"start_month" integer NOT NULL,
	"start_year" integer NOT NULL,
	"end_month" integer NOT NULL,
	"end_year" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_years_start_month_check" CHECK ("academic_years"."start_month" BETWEEN 1 AND 12),
	CONSTRAINT "academic_years_end_month_check" CHECK ("academic_years"."end_month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"curriculum_level" text NOT NULL,
	"sort_order" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grades_curriculum_level_check" CHECK ("grades"."curriculum_level" IN ('MATRIC', 'O_LEVELS', 'A_LEVELS', 'MIXED'))
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"grade_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"school_user_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"date_of_birth" date,
	"gender" text,
	"b_form_cnic" text,
	"blood_group" text,
	"nationality" text DEFAULT 'Pakistani' NOT NULL,
	"religion" text,
	"previous_school" text,
	"medical_notes" text,
	"photo_url" text,
	"ghl_contact_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_profiles_school_user_id_unique" UNIQUE("school_user_id"),
	CONSTRAINT "student_profiles_gender_check" CHECK ("student_profiles"."gender" IS NULL OR "student_profiles"."gender" IN ('male', 'female', 'other')),
	CONSTRAINT "student_profiles_blood_group_check" CHECK ("student_profiles"."blood_group" IS NULL OR "student_profiles"."blood_group" IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'))
);
--> statement-breakpoint
CREATE TABLE "student_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"roll_number" text,
	"enrollment_date" date DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_enrollments_status_check" CHECK ("student_enrollments"."status" IN ('active', 'transferred', 'withdrawn', 'graduated'))
);
--> statement-breakpoint
CREATE TABLE "student_guardians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"school_user_id" uuid,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"cnic" text,
	"occupation" text,
	"is_primary_contact" boolean DEFAULT false NOT NULL,
	"ghl_contact_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_guardians_relationship_check" CHECK ("student_guardians"."relationship" IN ('father', 'mother', 'guardian', 'sibling', 'other'))
);
--> statement-breakpoint
CREATE TABLE "admission_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"branch_id" uuid,
	"academic_year_id" uuid,
	"grade_id" uuid,
	"student_name" text NOT NULL,
	"student_dob" date,
	"student_gender" text,
	"previous_school" text,
	"guardian_name" text NOT NULL,
	"guardian_relationship" text NOT NULL,
	"guardian_phone" text NOT NULL,
	"guardian_email" text,
	"guardian_cnic" text,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"reviewed_by_uid" text,
	"reviewed_at" timestamp with time zone,
	"converted_to_student_profile_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_applications_status_check" CHECK ("admission_applications"."status" IN ('pending', 'reviewing', 'accepted', 'rejected', 'waitlisted'))
);
--> statement-breakpoint
CREATE TABLE "school_id_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"last_sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "school_code" text;--> statement-breakpoint
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_school_user_id_school_users_id_fk" FOREIGN KEY ("school_user_id") REFERENCES "public"."school_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_school_user_id_school_users_id_fk" FOREIGN KEY ("school_user_id") REFERENCES "public"."school_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_converted_to_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("converted_to_student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_id_sequences" ADD CONSTRAINT "school_id_sequences_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_id_sequences" ADD CONSTRAINT "school_id_sequences_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academic_years_location_id_idx" ON "academic_years" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "academic_years_location_id_is_active_idx" ON "academic_years" USING btree ("location_id","is_active");--> statement-breakpoint
CREATE INDEX "grades_location_id_idx" ON "grades" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "grades_branch_id_idx" ON "grades" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grades_branch_id_sort_order_idx" ON "grades" USING btree ("branch_id","sort_order");--> statement-breakpoint
CREATE INDEX "sections_location_id_idx" ON "sections" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "sections_grade_id_academic_year_id_idx" ON "sections" USING btree ("grade_id","academic_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_grade_id_academic_year_id_name_idx" ON "sections" USING btree ("grade_id","academic_year_id","name");--> statement-breakpoint
CREATE INDEX "student_profiles_location_id_idx" ON "student_profiles" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "student_profiles_school_user_id_idx" ON "student_profiles" USING btree ("school_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_profiles_location_id_student_id_idx" ON "student_profiles" USING btree ("location_id","student_id");--> statement-breakpoint
CREATE INDEX "student_enrollments_location_id_idx" ON "student_enrollments" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "student_enrollments_section_id_idx" ON "student_enrollments" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "student_enrollments_academic_year_id_idx" ON "student_enrollments" USING btree ("academic_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_enrollments_location_id_profile_year_idx" ON "student_enrollments" USING btree ("location_id","student_profile_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "student_guardians_location_id_idx" ON "student_guardians" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "student_guardians_student_profile_id_idx" ON "student_guardians" USING btree ("student_profile_id");--> statement-breakpoint
CREATE INDEX "student_guardians_school_user_id_idx" ON "student_guardians" USING btree ("school_user_id");--> statement-breakpoint
CREATE INDEX "admission_applications_location_id_idx" ON "admission_applications" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "admission_applications_location_id_status_idx" ON "admission_applications" USING btree ("location_id","status");--> statement-breakpoint
CREATE INDEX "admission_applications_branch_id_idx" ON "admission_applications" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_id_sequences_location_id_academic_year_id_idx" ON "school_id_sequences" USING btree ("location_id","academic_year_id");