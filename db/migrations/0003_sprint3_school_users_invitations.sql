CREATE TABLE "school_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"firebase_uid" text,
	"email" text,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"branch_id" uuid,
	"avatar_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"invited_by_uid" text,
	"invited_at" timestamp with time zone,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_users_firebase_uid_unique" UNIQUE("firebase_uid"),
	CONSTRAINT "school_users_role_check" CHECK (role IN ('school_admin', 'branch_admin', 'teacher', 'student', 'parent', 'accountant', 'hr_manager'))
);
--> statement-breakpoint
CREATE TABLE "school_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text NOT NULL,
	"role" text NOT NULL,
	"branch_id" uuid,
	"invited_by_uid" text NOT NULL,
	"token" text NOT NULL,
	"whatsapp_sent" boolean DEFAULT false NOT NULL,
	"email_sent" boolean DEFAULT false NOT NULL,
	"whatsapp_message_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_invitations_token_unique" UNIQUE("token"),
	CONSTRAINT "school_invitations_role_check" CHECK (role IN ('school_admin', 'branch_admin', 'teacher', 'student', 'parent', 'accountant', 'hr_manager'))
);
--> statement-breakpoint
ALTER TABLE "school_users" ADD CONSTRAINT "school_users_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_users" ADD CONSTRAINT "school_users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_invitations" ADD CONSTRAINT "school_invitations_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_invitations" ADD CONSTRAINT "school_invitations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_users_location_id_idx" ON "school_users" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "school_users_firebase_uid_idx" ON "school_users" USING btree ("firebase_uid");--> statement-breakpoint
CREATE INDEX "school_users_location_id_role_idx" ON "school_users" USING btree ("location_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "school_users_location_id_phone_idx" ON "school_users" USING btree ("location_id","phone");--> statement-breakpoint
CREATE INDEX "school_invitations_location_id_idx" ON "school_invitations" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "school_invitations_token_idx" ON "school_invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "school_invitations_expires_at_idx" ON "school_invitations" USING btree ("expires_at");