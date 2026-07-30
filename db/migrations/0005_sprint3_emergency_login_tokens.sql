CREATE TABLE "emergency_login_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"school_user_id" uuid NOT NULL,
	"firebase_uid" text NOT NULL,
	"token" text NOT NULL,
	"created_by" text DEFAULT 'super_admin' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emergency_login_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "emergency_login_tokens" ADD CONSTRAINT "emergency_login_tokens_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_login_tokens" ADD CONSTRAINT "emergency_login_tokens_school_user_id_school_users_id_fk" FOREIGN KEY ("school_user_id") REFERENCES "public"."school_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "emergency_login_tokens_token_idx" ON "emergency_login_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "emergency_login_tokens_location_id_idx" ON "emergency_login_tokens" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "emergency_login_tokens_expires_at_idx" ON "emergency_login_tokens" USING btree ("expires_at");