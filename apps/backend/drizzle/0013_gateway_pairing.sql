CREATE TABLE "gateway_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"gateway_id" text,
	"code_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "gateway_pairings_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "gateways" ALTER COLUMN "cert_fingerprint" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gateways" ALTER COLUMN "cert_expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gateways" ADD COLUMN "auth" text DEFAULT 'certificate' NOT NULL;--> statement-breakpoint
ALTER TABLE "gateways" ADD COLUMN "credential_generation" integer;--> statement-breakpoint
ALTER TABLE "gateway_pairings" ADD CONSTRAINT "gateway_pairings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_pairings" ADD CONSTRAINT "gateway_pairings_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_pairings" ADD CONSTRAINT "gateway_pairings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gateway_pairings_household_id_idx" ON "gateway_pairings" USING btree ("household_id");--> statement-breakpoint
ALTER TABLE "gateways" ADD CONSTRAINT "gateways_auth_check" CHECK (("gateways"."auth" = 'certificate' and "gateways"."cert_fingerprint" is not null and "gateways"."cert_expires_at" is not null and "gateways"."credential_generation" is null) or ("gateways"."auth" = 'credentials' and "gateways"."kind" = 'ha' and "gateways"."credential_generation" is not null and "gateways"."credential_generation" >= 1 and "gateways"."cert_fingerprint" is null and "gateways"."cert_expires_at" is null));