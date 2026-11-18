-- Hand-written: values move to the platform's own units (spec 2026-11-18-adapter-schicht, section 9).
UPDATE "measurements" SET "value_num" = round("value_num" * 100 / 254)
  WHERE "capability" = 'brightness' AND "value_num" IS NOT NULL;--> statement-breakpoint
UPDATE "measurements" SET "value_num" = round(1000000 / "value_num")
  WHERE "capability" = 'color_temp' AND "value_num" > 0;--> statement-breakpoint
UPDATE "hardware" SET "last_state" = "last_state" || jsonb_build_object('state', "last_state"->>'state' = 'ON')
  WHERE "last_state"->>'state' IN ('ON', 'OFF');--> statement-breakpoint
UPDATE "device_state" SET "state" = "state" || jsonb_build_object('state', "state"->>'state' = 'ON')
  WHERE "state"->>'state' IN ('ON', 'OFF');--> statement-breakpoint
UPDATE "hardware" SET "last_state" = "last_state" || jsonb_build_object('brightness', round(("last_state"->>'brightness')::numeric * 100 / 254))
  WHERE jsonb_typeof("last_state"->'brightness') = 'number';--> statement-breakpoint
UPDATE "device_state" SET "state" = "state" || jsonb_build_object('brightness', round(("state"->>'brightness')::numeric * 100 / 254))
  WHERE jsonb_typeof("state"->'brightness') = 'number';--> statement-breakpoint
UPDATE "hardware" SET "last_state" = "last_state" || jsonb_build_object('color_temp', round(1000000 / ("last_state"->>'color_temp')::numeric))
  WHERE jsonb_typeof("last_state"->'color_temp') = 'number' AND ("last_state"->>'color_temp')::numeric > 0;--> statement-breakpoint
UPDATE "device_state" SET "state" = "state" || jsonb_build_object('color_temp', round(1000000 / ("state"->>'color_temp')::numeric))
  WHERE jsonb_typeof("state"->'color_temp') = 'number' AND ("state"->>'color_temp')::numeric > 0;--> statement-breakpoint
UPDATE "capabilities" SET "unit" = '%', "min" = 0, "max" = 100, "step" = NULL, "is_setting" = false,
  "native" = "native" || jsonb_build_object('max', coalesce("max", 254))
  WHERE "key" = 'brightness';--> statement-breakpoint
UPDATE "capabilities" SET "unit" = 'K',
  "min" = CASE WHEN "max" > 0 THEN round(1000000 / "max") ELSE 1000 END,
  "max" = CASE WHEN "min" > 0 THEN round(1000000 / "min") ELSE 10000 END,
  "step" = NULL, "is_setting" = false
  WHERE "key" = 'color_temp';--> statement-breakpoint
UPDATE "capabilities" SET "is_setting" = false WHERE "key" = 'state';
