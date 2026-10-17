import { z } from 'zod';

const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');

const temperatureSchema = z.number().min(0).max(40).nullable();

export const automationInputSchema = z
  .object({
    deviceId: z.string().min(1),
    /** Bit `1 << weekday` (0 = Sunday) for each day the window starts on. */
    daysMask: z.number().int().min(1).max(0b1111111),
    /** "HH:MM" in the house's timezone. Equal to `endsAt` means all day; before it, overnight. */
    startsAt: timeOfDaySchema,
    endsAt: timeOfDaySchema,
    minTemperatureC: temperatureSchema,
    maxTemperatureC: temperatureSchema,
    /** How far back inside the range the temperature has to get before AUTO is turned off. */
    bufferC: z.number().min(0).max(5),
    enabled: z.boolean(),
  })
  .refine(
    ({ minTemperatureC, maxTemperatureC }) =>
      minTemperatureC != null || maxTemperatureC != null,
    { message: 'Set a minimum, a maximum, or both', path: ['minTemperatureC'] },
  )
  .refine(
    ({ minTemperatureC, maxTemperatureC, bufferC }) =>
      minTemperatureC == null ||
      maxTemperatureC == null ||
      minTemperatureC + 2 * bufferC < maxTemperatureC,
    {
      message: 'The minimum plus twice the buffer has to be below the maximum',
      path: ['maxTemperatureC'],
    },
  );
export type AutomationInput = z.infer<typeof automationInputSchema>;

export const automationSchema = z.object({
  id: z.number(),
  locationId: z.string(),
  deviceId: z.string(),
  daysMask: z.number(),
  startsAt: z.string(),
  endsAt: z.string(),
  minTemperatureC: z.number().nullable(),
  maxTemperatureC: z.number().nullable(),
  bufferC: z.number(),
  enabled: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Automation = z.infer<typeof automationSchema>;
