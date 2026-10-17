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

export const formatDelta = (celsius: number, unit: DisplayUnit) =>
  `${Math.round(deltaToDisplay(celsius, unit) * 10) / 10}°${unit}`;
