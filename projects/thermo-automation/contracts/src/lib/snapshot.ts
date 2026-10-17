import { z } from 'zod';
import { automationSchema } from './automations';
import { settingsSchema } from './settings';

export const controlActionKindSchema = z.enum([
  'start',
  'stop',
  'reapply',
  'window_end',
]);

export const controlStateSchema = z.enum([
  'unsupported',
  'paused',
  'manual',
  'automating',
  'idle',
  'inactive',
]);

export const readingSchema = z.object({
  mode: z.number(),
  modeLimit: z.number(),
  equipmentStatus: z.number(),
  heatSetpointC: z.number(),
  coolSetpointC: z.number(),
  setpointDeltaC: z.number(),
  setpointMinimumC: z.number(),
  setpointMaximumC: z.number(),
  indoorTemperatureC: z.number(),
  indoorHumidity: z.number(),
  outdoorTemperatureC: z.number(),
  outdoorHumidity: z.number(),
  readAt: z.iso.datetime(),
});
export type Reading = z.infer<typeof readingSchema>;

export const deviceSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  /** Null until the first successful read. */
  reading: readingSchema.nullable(),
  /** Why the last read failed, if it did. */
  readError: z.string().nullable(),
  pausedUntil: z.iso.datetime().nullable(),
  /** What the device will be in once `pendingAction` (if any) is done. */
  state: controlStateSchema.nullable(),
  /**
   * An action the automations call for that hasn't happened yet: either the last attempt failed
   * (see `actionError`), or something changed since the last tick and the next one will do it.
   */
  pendingAction: controlActionKindSchema.nullable(),
  /** Why the last attempt at `pendingAction` failed. */
  actionError: z.string().nullable(),
  inWindow: z.boolean(),
  activeAutomationIds: z.number().array(),
  target: z
    .object({
      minTemperatureC: z.number().nullable(),
      maxTemperatureC: z.number().nullable(),
      bufferC: z.number(),
      heatSetpointC: z.number(),
      coolSetpointC: z.number(),
    })
    .nullable(),
});
export type DeviceSnapshot = z.infer<typeof deviceSnapshotSchema>;

export const tickStatusSchema = z.object({
  lastTickAt: z.iso.datetime().nullable(),
  lastSuccessAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
  consecutiveFailures: z.number(),
  tickIntervalMs: z.number(),
});
export type TickStatus = z.infer<typeof tickStatusSchema>;

/** Everything the page shows. Sent on GET /api/snapshot and over the /api/stream SSE stream. */
export const snapshotSchema = z.object({
  settings: settingsSchema,
  devices: deviceSnapshotSchema.array(),
  automations: automationSchema.array(),
  status: tickStatusSchema,
  generatedAt: z.iso.datetime(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const historyPointSchema = z.object({
  recordedAt: z.iso.datetime(),
  mode: z.number(),
  equipmentStatus: z.number(),
  indoorTemperatureC: z.number(),
  heatSetpointC: z.number(),
  coolSetpointC: z.number(),
});
export type HistoryPoint = z.infer<typeof historyPointSchema>;

/** The SSE event names on /api/stream. */
export const StreamEvent = {
  Snapshot: 'snapshot',
  /** Sent between snapshots so idle proxies keep the connection open. */
  Ping: 'ping',
} as const;
