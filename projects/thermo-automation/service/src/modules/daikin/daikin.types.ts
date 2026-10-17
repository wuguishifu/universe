import { z } from 'zod';

// Only the fields the app uses. See https://www.daikinone.com/openapi/documentation/index.html.

export const daikinTokenSchema = z.object({
  accessToken: z.string(),
  /** Seconds. */
  accessTokenExpiresIn: z.number(),
});

/** GET /devices: the account's locations. They have no ID, so their name is how they're told apart. */
export const daikinLocationsSchema = z
  .object({
    locationName: z.string(),
    devices: z
      .object({
        id: z.string(),
        name: z.string(),
        model: z.string(),
      })
      .array(),
  })
  .array();
export type DaikinLocation = z.infer<typeof daikinLocationsSchema>[number];
export type DaikinDevice = DaikinLocation['devices'][number];

/** GET /devices/:id. Temperatures are °C. */
export const daikinDeviceInfoSchema = z.object({
  equipmentStatus: z.number(),
  mode: z.number(),
  modeLimit: z.number(),
  heatSetpoint: z.number(),
  coolSetpoint: z.number(),
  setpointDelta: z.number(),
  setpointMinimum: z.number(),
  setpointMaximum: z.number(),
  tempIndoor: z.number(),
  humIndoor: z.number(),
  tempOutdoor: z.number(),
  humOutdoor: z.number(),
});
export type DaikinDeviceInfo = z.infer<typeof daikinDeviceInfoSchema>;
