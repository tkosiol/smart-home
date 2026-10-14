CREATE TABLE "gateways" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'z2m' NOT NULL,
	"topic_prefix" text NOT NULL,
	"bridge_status" text DEFAULT 'unknown' NOT NULL,
	"z2m_status" text DEFAULT 'unknown' NOT NULL,
	"status_changed_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"cert_fingerprint" text NOT NULL,
	"cert_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "gateways_id_check" CHECK ("gateways"."id" ~ '^gw-[a-z0-9]{8}$'),
	CONSTRAINT "gateways_kind_check" CHECK ("gateways"."kind" in ('z2m')),
	CONSTRAINT "gateways_bridge_status_check" CHECK ("gateways"."bridge_status" in ('online', 'offline', 'unknown')),
	CONSTRAINT "gateways_z2m_status_check" CHECK ("gateways"."z2m_status" in ('online', 'offline', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "gateways" ADD CONSTRAINT "gateways_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gateways_household_id_idx" ON "gateways" USING btree ("household_id");