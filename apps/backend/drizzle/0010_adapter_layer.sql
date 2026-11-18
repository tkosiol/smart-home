ALTER TABLE "hardware" RENAME COLUMN "ieee_address" TO "external_id";--> statement-breakpoint
ALTER TABLE "hardware" RENAME COLUMN "friendly_name" TO "name";--> statement-breakpoint
ALTER TABLE "hardware" RENAME COLUMN "definition" TO "native";--> statement-breakpoint
ALTER TABLE "hardware" ADD COLUMN "address" text;--> statement-breakpoint
UPDATE "hardware" SET "address" = "name";--> statement-breakpoint
ALTER TABLE "hardware" RENAME COLUMN "interview_state" TO "setup_state";--> statement-breakpoint
UPDATE "hardware" SET "setup_state" = CASE "setup_state"
  WHEN 'SUCCESSFUL' THEN 'ready'
  WHEN 'FAILED' THEN 'failed'
  WHEN 'PENDING' THEN 'pairing'
  WHEN 'IN_PROGRESS' THEN 'pairing'
  ELSE 'unknown' END;--> statement-breakpoint
ALTER TABLE "hardware" ALTER COLUMN "setup_state" SET DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE "hardware" ADD CONSTRAINT "hardware_setup_state_check" CHECK ("hardware"."setup_state" in ('pairing', 'ready', 'failed', 'unknown'));--> statement-breakpoint
ALTER INDEX "hardware_gateway_id_ieee_address_idx" RENAME TO "hardware_gateway_id_external_id_idx";--> statement-breakpoint
DROP INDEX "hardware_gateway_id_friendly_name_idx";--> statement-breakpoint
CREATE INDEX "hardware_gateway_id_address_idx" ON "hardware" USING btree ("gateway_id","address");--> statement-breakpoint
ALTER TABLE "capabilities" ADD COLUMN "native" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "capabilities" SET "native" = jsonb_build_object('property', "key");--> statement-breakpoint
ALTER TABLE "gateways" RENAME COLUMN "z2m_status" TO "service_status";--> statement-breakpoint
ALTER TABLE "gateways" RENAME CONSTRAINT "gateways_z2m_status_check" TO "gateways_service_status_check";
