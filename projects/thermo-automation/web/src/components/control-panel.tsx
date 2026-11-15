import { Flame, Info, Minus, Plus, Snowflake } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { Button, cn, Spinner } from '@libs/ui-web';
import {
  type DeviceSnapshot,
  type DisplayUnit,
  type ManualControl,
  manualControlProblem,
  manualModes,
  Mode,
  modeLabels,
  type Reading,
  type Setpoints,
  setpointsInUse,
  stepSetpoint,
} from '@projects/thermo-automation-contracts';

import { api, expect } from '../lib/api';
import { formatSetpoint } from '../lib/temperature';
import { useApiMutation } from '../lib/use-api-mutation';

/** Closer than this to the thermostat's value counts as unchanged. */
const SAME_EPSILON_C = 0.01;

/**
 * The fields of `draft` that the draft's mode uses and that differ from the thermostat. Untouched
 * fields aren't in the draft, so they follow the live reading.
 */
function changesOf(draft: ManualControl, reading: Reading): ManualControl {
  const mode = draft.mode ?? reading.mode;
  const changes: ManualControl = {};
  if (draft.mode !== undefined && draft.mode !== reading.mode) {
    changes.mode = draft.mode;
  }
  for (const key of setpointsInUse(mode)) {
    const value = draft[key];
    if (
      value !== undefined &&
      Math.abs(value - reading[key]) >= SAME_EPSILON_C
    ) {
      changes[key] = value;
    }
  }
  return changes;
}

function SetpointStepper({
  label,
  icon,
  value,
  changed,
  unit,
  disabled,
  onStep,
}: {
  label: string;
  icon: ReactNode;
  value: number;
  changed: boolean;
  unit: DisplayUnit;
  disabled: boolean;
  /** Null when that direction would leave the thermostat's limits. */
  onStep: (direction: 1 | -1) => (() => void) | null;
}) {
  const down = onStep(-1);
  const up = onStep(1);
  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex w-20 items-center gap-1.5 text-sm text-muted-foreground">
        {icon}
        {label}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label={`Lower ${label.toLowerCase()} setpoint`}
        disabled={disabled || !down}
        onClick={() => down?.()}
      >
        <Minus className="h-4 w-4" />
      </Button>
      <span
        className={cn(
          'w-20 text-center text-lg tabular-nums',
          changed && 'font-semibold text-primary',
        )}
        aria-live="polite"
      >
        {formatSetpoint(value, unit)}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label={`Raise ${label.toLowerCase()} setpoint`}
        disabled={disabled || !up}
        onClick={() => up?.()}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** Set the mode and setpoints by hand. Nothing is sent until Apply. */
export function ControlPanel({
  device,
  reading,
  unit,
}: {
  device: DeviceSnapshot;
  reading: Reading;
  unit: DisplayUnit;
}) {
  const [draft, setDraft] = useState<ManualControl>({});
  const control = useApiMutation(
    (body: ManualControl) =>
      expect(
        api.devices.control({ params: { deviceId: device.id }, body }),
        204,
      ),
    { onSuccess: () => setDraft({}) },
  );

  const changes = changesOf(draft, reading);
  const dirty = Object.keys(changes).length > 0;
  const mode = draft.mode ?? reading.mode;
  const setpoints: Setpoints = {
    heatSetpointC: draft.heatSetpointC ?? reading.heatSetpointC,
    coolSetpointC: draft.coolSetpointC ?? reading.coolSetpointC,
  };
  const inUse = setpointsInUse(mode);
  const problem = dirty
    ? manualControlProblem(reading, changes, (celsius) =>
        formatSetpoint(celsius, unit),
      )
    : null;
  const mayBeOverridden =
    dirty &&
    mode !== Mode.EmergencyHeat &&
    device.inWindow &&
    !device.pausedUntil &&
    device.state !== 'unsupported';
  const disabled = control.isPending;

  const stepper = (key: keyof Setpoints) => (direction: 1 | -1) => {
    const next = stepSetpoint(setpoints, key, direction, mode, reading);
    if (!next) return null;
    // Only what moved, so a setpoint the step didn't touch keeps following the reading.
    const moved: ManualControl = {};
    if (next.heatSetpointC !== setpoints.heatSetpointC) {
      moved.heatSetpointC = next.heatSetpointC;
    }
    if (next.coolSetpointC !== setpoints.coolSetpointC) {
      moved.coolSetpointC = next.coolSetpointC;
    }
    return () => setDraft((previous) => ({ ...previous, ...moved }));
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && !problem) control.mutate(changes);
      }}
    >
      <div
        role="radiogroup"
        aria-label="Mode"
        className="inline-flex w-fit flex-wrap rounded-md border p-0.5"
      >
        {manualModes(reading.modeLimit, reading.mode).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            disabled={disabled}
            onClick={() =>
              setDraft((previous) => ({ ...previous, mode: option }))
            }
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50',
              mode === option
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {modeLabels[option]}
          </button>
        ))}
      </div>

      {inUse.length > 0 && (
        <div className="flex flex-col gap-2">
          {inUse.includes('heatSetpointC') && (
            <SetpointStepper
              label="Heat"
              icon={<Flame className="h-4 w-4 text-heat" aria-hidden />}
              value={setpoints.heatSetpointC}
              changed={changes.heatSetpointC !== undefined}
              unit={unit}
              disabled={disabled}
              onStep={stepper('heatSetpointC')}
            />
          )}
          {inUse.includes('coolSetpointC') && (
            <SetpointStepper
              label="Cool"
              icon={<Snowflake className="h-4 w-4 text-cool" aria-hidden />}
              value={setpoints.coolSetpointC}
              changed={changes.coolSetpointC !== undefined}
              unit={unit}
              disabled={disabled}
              onStep={stepper('coolSetpointC')}
            />
          )}
        </div>
      )}

      {problem && <p className="text-xs text-warning">{problem}</p>}
      {mayBeOverridden && (
        <p className="flex gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          An automation window is active, so the next run may override this.
          Pause automations first to keep it.
        </p>
      )}

      {dirty && (
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={disabled || !!problem}>
            {control.isPending && <Spinner className="mr-1.5" />}
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => setDraft({})}
          >
            Reset
          </Button>
        </div>
      )}
    </form>
  );
}
