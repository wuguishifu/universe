import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  pgSchema,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  time,
  timestamp,
} from 'drizzle-orm/pg-core';

export const thermoPgSchema = pgSchema('thermo');

/**
 * thermo-automation runs one house at a time, so there's a single row (id 1). Rows elsewhere are
 * tagged with the location they belong to, so switching houses leaves the old house's alone.
 */
export const thermoSettings = thermoPgSchema.table(
  'settings',
  {
    id: integer('id').primaryKey().default(1),
    /** The Daikin location's name, which is how the API identifies it. */
    locationId: text('location_id'),
    /** IANA timezone automation windows are read in. */
    timezone: text('timezone').notNull().default('UTC'),
    displayUnit: text('display_unit', { enum: ['F', 'C'] })
      .notNull()
      .default('F'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [check('settings_single_row', sql`${table.id} = 1`)],
);

export const thermoAutomations = thermoPgSchema.table(
  'automations',
  {
    id: serial('id').primaryKey(),
    locationId: text('location_id').notNull(),
    deviceId: text('device_id').notNull(),
    /** Bit `1 << weekday` (0 = Sunday) for each day the window starts on. */
    daysMask: smallint('days_mask').notNull(),
    /** In the timezone from settings. Equal means all day; starts after ends means overnight. */
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
    minTemperatureC: real('min_temperature_c'),
    maxTemperatureC: real('max_temperature_c'),
    bufferC: real('buffer_c').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('automations_location_id_device_id_idx').on(
      table.locationId,
      table.deviceId,
    ),
  ],
);

/** One row per device per tick, kept forever for Redash. */
export const thermoDeviceStatusRecords = thermoPgSchema.table(
  'device_status_records',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    locationId: text('location_id').notNull(),
    deviceId: text('device_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    mode: smallint('mode').notNull(),
    equipmentStatus: smallint('equipment_status').notNull(),
    heatSetpointC: real('heat_setpoint_c').notNull(),
    coolSetpointC: real('cool_setpoint_c').notNull(),
    indoorTemperatureC: real('indoor_temperature_c').notNull(),
    indoorHumidity: real('indoor_humidity').notNull(),
    outdoorTemperatureC: real('outdoor_temperature_c').notNull(),
    outdoorHumidity: real('outdoor_humidity').notNull(),
  },
  (table) => [
    index('device_status_records_device_id_recorded_at_idx').on(
      table.deviceId,
      table.recordedAt,
    ),
  ],
);

export const thermoDeviceStates = thermoPgSchema.table(
  'device_states',
  {
    locationId: text('location_id').notNull(),
    deviceId: text('device_id').notNull(),
    /** The app leaves the device alone until then. */
    pausedUntil: timestamp('paused_until', { withTimezone: true }),
    /** Whether the last successful tick was inside a window, to catch the moment one ends. */
    wasInWindow: boolean('was_in_window').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.locationId, table.deviceId] })],
);

export const thermoSchema = {
  settings: thermoSettings,
  automations: thermoAutomations,
  deviceStatusRecords: thermoDeviceStatusRecords,
  deviceStates: thermoDeviceStates,
};
