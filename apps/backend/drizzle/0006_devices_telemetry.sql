CREATE TABLE "capabilities" (
	"hardware_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"unit" text,
	"min" double precision,
	"max" double precision,
	"step" double precision,
	"enum_values" text[],
	"readable" boolean NOT NULL,
	"writable" boolean NOT NULL,
	"is_setting" boolean NOT NULL,
	CONSTRAINT "capabilities_hardware_id_key_pk" PRIMARY KEY("hardware_id","key"),
	CONSTRAINT "capabilities_kind_check" CHECK ("capabilities"."kind" in ('numeric', 'binary', 'enum', 'text', 'composite'))
);
--> statement-breakpoint
CREATE TABLE "device_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"hardware_id" uuid NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unbound_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "device_state" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone,
	"availability" text DEFAULT 'unknown' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hardware" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gateway_id" text NOT NULL,
	"ieee_address" text NOT NULL,
	"friendly_name" text NOT NULL,
	"vendor" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"description" text,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"interview_state" text DEFAULT 'UNKNOWN' NOT NULL,
	"availability" text DEFAULT 'unknown' NOT NULL,
	"last_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	CONSTRAINT "hardware_availability_check" CHECK ("hardware"."availability" in ('online', 'offline', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"time" timestamp with time zone NOT NULL,
	"device_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"value_num" double precision,
	"value_text" text,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_hardware_id_hardware_id_fk" FOREIGN KEY ("hardware_id") REFERENCES "public"."hardware"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_bindings" ADD CONSTRAINT "device_bindings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_bindings" ADD CONSTRAINT "device_bindings_hardware_id_hardware_id_fk" FOREIGN KEY ("hardware_id") REFERENCES "public"."hardware"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_state" ADD CONSTRAINT "device_state_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hardware" ADD CONSTRAINT "hardware_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_bindings_active_device_idx" ON "device_bindings" USING btree ("device_id") WHERE "device_bindings"."unbound_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "device_bindings_active_hardware_idx" ON "device_bindings" USING btree ("hardware_id") WHERE "device_bindings"."unbound_at" is null;--> statement-breakpoint
CREATE INDEX "devices_household_id_idx" ON "devices" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hardware_gateway_id_ieee_address_idx" ON "hardware" USING btree ("gateway_id","ieee_address");--> statement-breakpoint
CREATE INDEX "hardware_gateway_id_friendly_name_idx" ON "hardware" USING btree ("gateway_id","friendly_name");--> statement-breakpoint
CREATE UNIQUE INDEX "measurements_device_capability_time_idx" ON "measurements" USING btree ("device_id","capability","time");--> statement-breakpoint
-- Hand-written: drizzle cannot express hypertables or policies. Keep this part when regenerating.
SELECT create_hypertable('measurements', by_range('time', INTERVAL '7 days'));--> statement-breakpoint
ALTER TABLE measurements SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'device_id, capability',
  timescaledb.compress_orderby = 'time DESC'
);--> statement-breakpoint
SELECT add_compression_policy('measurements', INTERVAL '7 days');--> statement-breakpoint
SELECT add_retention_policy('measurements', INTERVAL '1 year');
