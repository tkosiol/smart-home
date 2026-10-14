CREATE TABLE "instance_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"appearance" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "instance_settings_single_row_check" CHECK ("instance_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;