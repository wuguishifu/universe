import { initClient } from '@ts-rest/core';
import { z } from 'zod';

import { type McpToolset, toolResult } from '@platform/mcp-toolkit';
import {
  automationInputSchema,
  Mode,
  thermoRootRouter,
} from '@projects/thermo-automation-contracts';

export type ThermoToolsetOptions = {
  /** thermo-automation-service's origin. The contract adds `/api`. */
  baseUrl: string;
};

const CELSIUS =
  'Temperatures are in °C; `settings.displayUnit` is how the user reads them, so answer in that unit.';
const MODES =
  'Modes are numbers: 0 off, 1 heat, 2 cool, 3 auto, 4 emergency heat.';

const modeByName = {
  off: Mode.Off,
  heat: Mode.Heat,
  cool: Mode.Cool,
  auto: Mode.Auto,
  emergency_heat: Mode.EmergencyHeat,
} as const;

const deviceId = z
  .string()
  .min(1)
  .describe('A device `id` from thermo_get_status.');
const automationId = z
  .number()
  .int()
  .describe('An automation `id` from thermo_get_status.');

const AUTOMATIONS =
  'An automation is a window in which a thermostat is kept in a temperature range: when it is OFF ' +
  'and out of range the service switches it to AUTO with setpoints aimed inside the range, and back ' +
  'to OFF once it gets there. Thermostats in HEAT, COOL or emergency heat are never touched. ' +
  '`daysMask` has bit `1 << weekday` set for each day the window starts on (0 = Sunday, so ' +
  'weekdays are 62 and every day is 127). `startsAt` and `endsAt` are "HH:MM" in the house\'s ' +
  'timezone: equal means all day, and an `endsAt` before `startsAt` runs overnight. Set ' +
  '`minTemperatureC`, `maxTemperatureC` or both (null for no bound). `bufferC` is how far back ' +
  'inside the range the temperature has to get before AUTO is turned off.';

/** thermo-automation's thermostats and automations, through its API. */
export function createThermoToolset({
  baseUrl,
}: ThermoToolsetOptions): McpToolset {
  const api = initClient(thermoRootRouter, { baseUrl });

  return {
    name: 'thermo-automation',
    register: (server) => {
      server.registerTool(
        'thermo_get_status',
        {
          title: 'Get thermostat status',
          description:
            "Everything about the house's thermostats: each device's latest reading (indoor and " +
            'outdoor temperature and humidity, mode, setpoints), whether it is paused, what the ' +
            'automations are doing with it (`state`, `pendingAction`, `target`), every automation, ' +
            "the settings and whether the service's last check succeeded. Call this first: the " +
            `other tools take ids from it. ${CELSIUS} ${MODES}`,
          annotations: { readOnlyHint: true },
        },
        () => toolResult(api.snapshot(), 200),
      );

      server.registerTool(
        'thermo_get_device_history',
        {
          title: 'Get thermostat history',
          description:
            "A thermostat's recorded readings, oldest first: one every few minutes, with the " +
            `mode, whether the equipment was running, indoor temperature and setpoints. ${CELSIUS} ${MODES}`,
          inputSchema: z.object({
            deviceId,
            hours: z
              .number()
              .int()
              .min(1)
              .max(24 * 7)
              .default(24)
              .describe('How far back to go, up to a week.'),
          }),
          annotations: { readOnlyHint: true },
        },
        ({ deviceId, hours }) =>
          toolResult(
            api.devices.history({ params: { deviceId }, query: { hours } }),
            200,
          ),
      );

      server.registerTool(
        'thermo_set_device_control',
        {
          title: 'Set thermostat mode and setpoints',
          description:
            "Change a thermostat's mode and/or setpoints by hand. Fields left out keep the " +
            "thermostat's current value. A change outside the thermostat's limits is rejected, " +
            'not adjusted. Automations are not paused: inside an automation window the next ' +
            'check (every few minutes) can switch an OFF or AUTO thermostat again, so pause it ' +
            'with thermo_pause_device to make the change stick. HEAT, COOL and emergency heat ' +
            `are never changed by automations. ${CELSIUS}`,
          inputSchema: z.object({
            deviceId,
            mode: z
              .enum(['off', 'heat', 'cool', 'auto', 'emergency_heat'])
              .optional(),
            heatSetpointC: z.number().optional(),
            coolSetpointC: z.number().optional(),
          }),
          annotations: { idempotentHint: true },
        },
        ({ deviceId, mode, heatSetpointC, coolSetpointC }) =>
          toolResult(
            api.devices.control({
              params: { deviceId },
              body: {
                mode: mode && modeByName[mode],
                heatSetpointC,
                coolSetpointC,
              },
            }),
            204,
            'Done. Call thermo_get_status to see the new reading.',
          ),
      );

      server.registerTool(
        'thermo_pause_device',
        {
          title: 'Pause automations for a thermostat',
          description:
            'Keep automations from changing a thermostat until a time. Readings are still ' +
            'recorded. Pausing again replaces the time.',
          inputSchema: z.object({
            deviceId,
            until: z.iso
              .datetime({ offset: true })
              .describe('ISO 8601, in the future.'),
          }),
          annotations: { idempotentHint: true },
        },
        ({ deviceId, until }) =>
          toolResult(
            api.devices.pause({
              params: { deviceId },
              body: { until: new Date(until).toISOString() },
            }),
            200,
          ),
      );

      server.registerTool(
        'thermo_resume_device',
        {
          title: 'Resume automations for a thermostat',
          description:
            'Undo thermo_pause_device: automations control the thermostat again from the next check.',
          inputSchema: z.object({ deviceId }),
          annotations: { idempotentHint: true },
        },
        ({ deviceId }) =>
          toolResult(api.devices.resume({ params: { deviceId } }), 204),
      );

      server.registerTool(
        'thermo_create_automation',
        {
          title: 'Create a thermostat automation',
          description: AUTOMATIONS,
          inputSchema: automationInputSchema,
        },
        (body) => toolResult(api.automations.create({ body }), 201),
      );

      server.registerTool(
        'thermo_update_automation',
        {
          title: 'Update a thermostat automation',
          description: `Replace every field of an automation. ${AUTOMATIONS}`,
          inputSchema: z.object({
            id: automationId,
            automation: automationInputSchema,
          }),
          annotations: { idempotentHint: true },
        },
        ({ id, automation }) =>
          toolResult(
            api.automations.update({ params: { id }, body: automation }),
            200,
          ),
      );

      server.registerTool(
        'thermo_delete_automation',
        {
          title: 'Delete a thermostat automation',
          description:
            'Delete an automation. To stop one for a while instead, update it with `enabled: false`.',
          inputSchema: z.object({ id: automationId }),
          annotations: { destructiveHint: true, idempotentHint: true },
        },
        ({ id }) => toolResult(api.automations.remove({ params: { id } }), 204),
      );
    },
  };
}
