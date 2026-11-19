ALTER TABLE "gateways" DROP CONSTRAINT "gateways_kind_check";--> statement-breakpoint
ALTER TABLE "gateways" ADD CONSTRAINT "gateways_kind_check" CHECK ("gateways"."kind" in ('z2m', 'ha'));