import { z } from 'zod';

export const displayUnitSchema = z.enum(['F', 'C']);
export type DisplayUnit = z.infer<typeof displayUnitSchema>;

const timeZoneSchema = z.string().refine((timeZone) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}, 'Not an IANA timezone');

export const settingsSchema = z.object({
  /**
   * The house this instance automates. The Daikin API identifies locations only by name.
   * Null until one is picked (or auto-picked when the account has exactly one).
   */
  locationId: z.string().nullable(),
  /** IANA timezone automation windows are read in. */
  timezone: timeZoneSchema,
  displayUnit: displayUnitSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsSchema = settingsSchema.partial().extend({
  locationId: z.string().min(1).optional(),
});
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;

export const locationSchema = z.object({
  id: z.string(),
  devices: z.object({ id: z.string(), name: z.string() }).array(),
});
export type Location = z.infer<typeof locationSchema>;
