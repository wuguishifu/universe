CREATE SCHEMA "thermo";
--> statement-breakpoint
CREATE TABLE "thermo"."automations" (
	"id" serial PRIMARY KEY NOT NULL,
	"location_id" text NOT NULL,
	"device_id" text NOT NULL,
	"days_mask" smallint NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"min_temperature_c" real,
	"max_temperature_c" real,
	"buffer_c" real DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thermo"."device_states" (
	"location_id" text NOT NULL,
	"device_id" text NOT NULL,
	"paused_until" timestamp with time zone,
	"was_in_window" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_states_location_id_device_id_pk" PRIMARY KEY("location_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "thermo"."device_status_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"location_id" text NOT NULL,
	"device_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"mode" smallint NOT NULL,
	"equipment_status" smallint NOT NULL,
	"heat_setpoint_c" real NOT NULL,
	"cool_setpoint_c" real NOT NULL,
	"indoor_temperature_c" real NOT NULL,
	"indoor_humidity" real NOT NULL,
	"outdoor_temperature_c" real NOT NULL,
	"outdoor_humidity" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thermo"."settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"location_id" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"display_unit" text DEFAULT 'F' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("thermo"."settings"."id" = 1)
);
--> statement-breakpoint
CREATE INDEX "automations_location_id_device_id_idx" ON "thermo"."automations" USING btree ("location_id","device_id");--> statement-breakpoint
CREATE INDEX "device_status_records_device_id_recorded_at_idx" ON "thermo"."device_status_records" USING btree ("device_id","recorded_at");