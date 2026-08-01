CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"color" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timetable_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"is_break" boolean DEFAULT false NOT NULL,
	"order_index" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timetable_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"room" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timetable_entries_day_of_week_check" CHECK ("timetable_entries"."day_of_week" BETWEEN 0 AND 4)
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"date" date NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"status" text NOT NULL,
	"marked_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_records_status_check" CHECK ("attendance_records"."status" IN ('present', 'absent', 'late', 'excused', 'holiday'))
);
--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_teacher_id_school_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."school_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_slot_id_timetable_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."timetable_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_enrollment_id_student_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."student_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_marked_by_school_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."school_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subjects_location_id_idx" ON "subjects" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_location_id_name_idx" ON "subjects" USING btree ("location_id","name");--> statement-breakpoint
CREATE INDEX "timetable_slots_location_id_idx" ON "timetable_slots" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_slots_location_id_order_index_idx" ON "timetable_slots" USING btree ("location_id","order_index");--> statement-breakpoint
CREATE INDEX "timetable_entries_location_section_teacher_idx" ON "timetable_entries" USING btree ("location_id","section_id","teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_entries_location_section_slot_day_idx" ON "timetable_entries" USING btree ("location_id","section_id","slot_id","day_of_week");--> statement-breakpoint
CREATE INDEX "attendance_records_location_id_date_idx" ON "attendance_records" USING btree ("location_id","date");--> statement-breakpoint
CREATE INDEX "attendance_records_location_id_student_idx" ON "attendance_records" USING btree ("location_id","student_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_records_location_date_student_idx" ON "attendance_records" USING btree ("location_id","date","student_profile_id");