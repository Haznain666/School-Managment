CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"role" text NOT NULL,
	"permission" text NOT NULL,
	"is_granted" boolean NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_check" CHECK (role IN ('school_admin', 'branch_admin', 'principal', 'vice_principal', 'coordinator', 'teacher', 'student', 'parent', 'accountant', 'hr_manager', 'marketing')),
	CONSTRAINT "role_permissions_permission_check" CHECK (permission IN ('users.read', 'users.write', 'admissions.read', 'admissions.write', 'fees.read', 'fees.write', 'academics.read', 'academics.write', 'attendance.mark', 'hr.read', 'hr.write', 'payroll.read', 'payroll.write', 'settings.read', 'settings.write', 'permissions.manage'))
);
--> statement-breakpoint
ALTER TABLE "school_users" DROP CONSTRAINT "school_users_role_check";--> statement-breakpoint
ALTER TABLE "school_invitations" DROP CONSTRAINT "school_invitations_role_check";--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_updated_by_school_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."school_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_permissions_location_id_idx" ON "role_permissions" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_location_role_permission_idx" ON "role_permissions" USING btree ("location_id","role","permission");--> statement-breakpoint
ALTER TABLE "school_users" ADD CONSTRAINT "school_users_role_check" CHECK (role IN ('school_admin', 'branch_admin', 'principal', 'vice_principal', 'coordinator', 'teacher', 'student', 'parent', 'accountant', 'hr_manager', 'marketing'));--> statement-breakpoint
ALTER TABLE "school_invitations" ADD CONSTRAINT "school_invitations_role_check" CHECK (role IN ('school_admin', 'branch_admin', 'principal', 'vice_principal', 'coordinator', 'teacher', 'student', 'parent', 'accountant', 'hr_manager', 'marketing'));