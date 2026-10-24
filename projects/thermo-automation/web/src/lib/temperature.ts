import type { DisplayUnit } from '@projects/thermo-automation-contracts';

export const toDisplay = (celsius: number, unit: DisplayUnit) =>
  unit === 'F' ? celsius * 1.8 + 32 : celsius;

export const fromDisplay = (value: number, unit: DisplayUnit) =>
  unit === 'F' ? (value - 32) / 1.8 : value;

/** For differences, like the buffer, where there's no offset. */
export const deltaToDisplay = (celsius: number, unit: DisplayUnit) =>
  unit === 'F' ? celsius * 1.8 : celsius;

export const deltaFromDisplay = (value: number, unit: DisplayUnit) =>
  unit === 'F' ? value / 1.8 : value;

/** Whole degrees in °F; halves in °C, the thermostat's step. */
export const roundForDisplay = (value: number, unit: DisplayUnit) =>
  unit === 'F' ? Math.round(value) : Math.round(value * 2) / 2;

export const formatTemperature = (
  celsius: number,
  unit: DisplayUnit,
  { withUnit = true }: { withUnit?: boolean } = {},
) =>
  `${roundForDisplay(toDisplay(celsius, unit), unit)}°${withUnit ? unit : ''}`;

/** Automation bounds are kept as entered, so they show to a tenth, not the thermostat's step. */
export const roundBound = (value: number) => Math.round(value * 10) / 10;

export const formatBound = (
  celsius: number,
  unit: DisplayUnit,
  { withUnit = true }: { withUnit?: boolean } = {},
) => `${roundBound(toDisplay(celsius, unit))}°${withUnit ? unit : ''}`;

/** To a tenth, so the thermostat's 0.5 °C steps stay apart in °F (68, 68.9, 69.8…). */
export const formatSetpoint = (
  celsius: number,
  unit: DisplayUnit,
  { withUnit = true }: { withUnit?: boolean } = {},
) =>
  `${Math.round(toDisplay(celsius, unit) * 10) / 10}°${withUnit ? unit : ''}`;

export const formatDelta = (celsius: number, unit: DisplayUnit) =>
  `${Math.round(deltaToDisplay(celsius, unit) * 10) / 10}°${unit}`;
