// No imports, so `nx test thermo-automation-contracts` can load this with Node's type stripping.

/** Thermostat modes, as the Daikin API reports and accepts them. */
export const Mode = {
  Off: 0,
  Heat: 1,
  Cool: 2,
  Auto: 3,
  EmergencyHeat: 4,
} as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

/** Which modes the equipment allows. `None` means there's no limit. */
export const ModeLimit = {
  None: 0,
  All: 1,
  HeatOnly: 2,
  CoolOnly: 3,
} as const;

/** 0 is Sunday, like `Date.getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** An enabled automation, as the decision needs it. */
export type ControlRule = {
  id: number;
  /** Bit `1 << weekday` is set for each day the window starts on. */
  daysMask: number;
  /** "HH:MM" (or "HH:MM:SS") in the house's timezone. Equal to `endsAt` means all day. */
  startsAt: string;
  endsAt: string;
  minTemperatureC: number | null;
  maxTemperatureC: number | null;
  bufferC: number;
};

export type ControlReading = {
  mode: number;
  modeLimit: number;
  heatSetpointC: number;
  coolSetpointC: number;
  /** The smallest gap the thermostat allows between the heat and cool setpoints. */
  setpointDeltaC: number;
  setpointMinimumC: number;
  setpointMaximumC: number;
  indoorTemperatureC: number;
};

/** The house's local time. */
export type HouseClock = { weekday: Weekday; minuteOfDay: number };

export type ControlInput = {
  reading: ControlReading;
  /** The device's enabled automations. */
  rules: ControlRule[];
  clock: HouseClock;
  paused: boolean;
  /** Whether the last successful tick was inside a window. */
  wasInWindow: boolean;
};

export type ControlState =
  /** The equipment can't run AUTO, so the device is only monitored. */
  | 'unsupported'
  | 'paused'
  /** In emergency heat, or in HEAT or COOL outside every window: someone is driving it by hand. */
  | 'manual'
  /** In a window and running AUTO. */
  | 'automating'
  /** In a window and off, because it's in range. */
  | 'idle'
  /** Outside every window. */
  | 'inactive';

export type ControlActionKind = 'start' | 'stop' | 'reapply' | 'window_end';

export type ControlAction = {
  kind: ControlActionKind;
  mode: Mode;
  heatSetpointC: number;
  coolSetpointC: number;
};

export type ControlTarget = {
  /** The merged bounds of the active automations. Null is unbounded. */
  minTemperatureC: number | null;
  maxTemperatureC: number | null;
  /**
   * The largest of their buffers, shrunk if the range is too narrow for it (see fitSetpoints). AUTO
   * is turned off once the temperature is this far inside the range.
   */
  bufferC: number;
  /** What AUTO is set to, after fitting the bounds to the thermostat's limits. */
  heatSetpointC: number;
  coolSetpointC: number;
};

export type ControlDecision = {
  inWindow: boolean;
  activeRuleIds: number[];
  target: ControlTarget | null;
  action: ControlAction | null;
  /** The device's state once `action` (if any) is applied. */
  state: ControlState;
};

/** Setpoints closer than this to the target aren't re-applied. */
const SETPOINT_TOLERANCE_C = 0.25;

/** Thermostats take setpoints in 0.5 °C steps. */
const SETPOINT_STEP_C = 0.5;

/** Bounds within this of a step count as on it, so float noise doesn't push them a whole step. */
const STEP_EPSILON_C = 0.01;

const snapUp = (value: number) =>
  Math.ceil((value - STEP_EPSILON_C) / SETPOINT_STEP_C) * SETPOINT_STEP_C;
const snapDown = (value: number) =>
  Math.floor((value + STEP_EPSILON_C) / SETPOINT_STEP_C) * SETPOINT_STEP_C;

export function parseTimeOfDay(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function isDayInMask(mask: number, day: number): boolean {
  return (mask & (1 << day)) !== 0;
}

/**
 * Overnight windows (start after end) belong to the day they start on, so a Friday 22:00–06:00
 * window covers Saturday morning.
 */
export function isRuleActive(rule: ControlRule, clock: HouseClock): boolean {
  const start = parseTimeOfDay(rule.startsAt);
  const end = parseTimeOfDay(rule.endsAt);
  const today = isDayInMask(rule.daysMask, clock.weekday);
  const minute = clock.minuteOfDay;

  if (start === end) {
    return today;
  }
  if (start < end) {
    return today && minute >= start && minute < end;
  }
  const yesterday = isDayInMask(rule.daysMask, (clock.weekday + 6) % 7);
  return (today && minute >= start) || (yesterday && minute < end);
}

/** The tightest bounds win. The buffer is the largest, so the order of the rules doesn't matter. */
export function mergeRules(rules: ControlRule[]) {
  let minTemperatureC: number | null = null;
  let maxTemperatureC: number | null = null;
  let bufferC = 0;
  for (const rule of rules) {
    if (rule.minTemperatureC != null) {
      minTemperatureC = Math.max(
        minTemperatureC ?? -Infinity,
        rule.minTemperatureC,
      );
    }
    if (rule.maxTemperatureC != null) {
      maxTemperatureC = Math.min(
        maxTemperatureC ?? Infinity,
        rule.maxTemperatureC,
      );
    }
    bufferC = Math.max(bufferC, rule.bufferC);
  }
  return { minTemperatureC, maxTemperatureC, bufferC };
}

/**
 * AUTO needs both setpoints. They go on the range's bounds, rounded to the thermostat's step
 * toward the inside of the range. The buffer never moves them: some thermostats keep running past
 * their setpoint, so AUTO is turned off once the temperature is the buffer inside the range (see
 * decide), and the buffer is what keeps that from flapping. A missing bound is pushed to the
 * thermostat's limit so AUTO never acts on that side.
 *
 * The buffer shrinks (possibly to 0) to leave the thermostat's setpoint gap between where AUTO
 * turns off on either side, as when one window's minimum and another's maximum overlap. The heat
 * setpoint gives way if the setpoints are closer than the thermostat allows.
 */
export function fitSetpoints(
  bounds: {
    minTemperatureC: number | null;
    maxTemperatureC: number | null;
    bufferC: number;
  },
  reading: ControlReading,
) {
  const { minTemperatureC: min, maxTemperatureC: max } = bounds;
  const {
    setpointMinimumC: lowest,
    setpointMaximumC: highest,
    setpointDeltaC: delta,
  } = reading;
  const clamp = (value: number) => Math.min(highest, Math.max(lowest, value));

  const bufferC =
    min != null && max != null
      ? Math.min(bounds.bufferC, Math.max(0, (max - min - delta) / 2))
      : bounds.bufferC;

  const coolSetpointC = clamp(max == null ? highest : snapDown(max));
  let heatSetpointC = clamp(min == null ? lowest : snapUp(min));
  if (heatSetpointC > coolSetpointC - delta) {
    heatSetpointC = coolSetpointC - delta;
  }
  return { heatSetpointC, coolSetpointC, bufferC };
}

export function isAutoSupported(modeLimit: number): boolean {
  return modeLimit !== ModeLimit.HeatOnly && modeLimit !== ModeLimit.CoolOnly;
}

/** A change made by hand from the page. Fields left out keep the thermostat's current value. */
export type ManualControl = {
  mode?: Mode;
  heatSetpointC?: number;
  coolSetpointC?: number;
};

export type Setpoints = { heatSetpointC: number; coolSetpointC: number };

type SetpointLimits = Pick<
  ControlReading,
  'setpointDeltaC' | 'setpointMinimumC' | 'setpointMaximumC'
>;

/** The modes offered by hand. Emergency heat only while it's already on, so it can be left. */
export function manualModes(modeLimit: number, currentMode: number): Mode[] {
  const modes: Mode[] = [Mode.Off];
  if (modeLimit !== ModeLimit.CoolOnly) modes.push(Mode.Heat);
  if (modeLimit !== ModeLimit.HeatOnly) modes.push(Mode.Cool);
  if (isAutoSupported(modeLimit)) modes.push(Mode.Auto);
  if (currentMode === Mode.EmergencyHeat) modes.push(Mode.EmergencyHeat);
  return modes;
}

/** The setpoints a mode acts on. The others are kept as they are. */
export function setpointsInUse(mode: number): (keyof Setpoints)[] {
  switch (mode) {
    case Mode.Heat:
    case Mode.EmergencyHeat:
      return ['heatSetpointC'];
    case Mode.Cool:
      return ['coolSetpointC'];
    case Mode.Auto:
      return ['heatSetpointC', 'coolSetpointC'];
    default:
      return [];
  }
}

/**
 * Moves one setpoint a step, snapping an off-grid value onto the grid in that direction. In AUTO
 * the other is pushed along to keep them `setpointDeltaC` apart, as the thermostat does. Null when
 * that would leave the thermostat's limits.
 */
export function stepSetpoint(
  setpoints: Setpoints,
  which: keyof Setpoints,
  direction: 1 | -1,
  mode: number,
  limits: SetpointLimits,
): Setpoints | null {
  const step = (value: number) =>
    direction > 0
      ? snapDown(value) + SETPOINT_STEP_C
      : snapUp(value) - SETPOINT_STEP_C;
  let { heatSetpointC: heat, coolSetpointC: cool } = setpoints;
  const tooClose = () =>
    mode === Mode.Auto && cool - heat < limits.setpointDeltaC - STEP_EPSILON_C;

  if (which === 'heatSetpointC') {
    heat = step(heat);
    if (tooClose()) cool = snapUp(heat + limits.setpointDeltaC);
  } else {
    cool = step(cool);
    if (tooClose()) heat = snapDown(cool - limits.setpointDeltaC);
  }

  const inLimits = (value: number) =>
    value >= limits.setpointMinimumC - STEP_EPSILON_C &&
    value <= limits.setpointMaximumC + STEP_EPSILON_C;
  return inLimits(heat) && inLimits(cool)
    ? { heatSetpointC: heat, coolSetpointC: cool }
    : null;
}

/**
 * Why the thermostat can't take `change` on top of `reading`, or null if it can. Nothing is
 * adjusted to make it fit: only what was asked for is ever written.
 */
export function manualControlProblem(
  reading: Pick<ControlReading, 'mode' | 'modeLimit'> &
    Setpoints &
    SetpointLimits,
  change: ManualControl,
  formatTemperature: (celsius: number) => string,
): string | null {
  if (
    change.mode !== undefined &&
    !manualModes(reading.modeLimit, reading.mode).includes(change.mode)
  ) {
    return "This thermostat can't be set to that mode";
  }

  const { setpointMinimumC: lowest, setpointMaximumC: highest } = reading;
  for (const setpoint of [change.heatSetpointC, change.coolSetpointC]) {
    if (
      setpoint !== undefined &&
      (setpoint < lowest - STEP_EPSILON_C ||
        setpoint > highest + STEP_EPSILON_C)
    ) {
      return `Setpoints have to be between ${formatTemperature(lowest)} and ${formatTemperature(highest)}`;
    }
  }

  const heat = change.heatSetpointC ?? reading.heatSetpointC;
  const cool = change.coolSetpointC ?? reading.coolSetpointC;
  if (
    (change.mode ?? reading.mode) === Mode.Auto &&
    cool - heat < reading.setpointDeltaC - STEP_EPSILON_C
  ) {
    return (
      'The heat and cool setpoints need to be further apart. The thermostat is at ' +
      `${formatTemperature(reading.heatSetpointC)}–${formatTemperature(reading.coolSetpointC)} now.`
    );
  }
  return null;
}

export function decide({
  reading,
  rules,
  clock,
  paused,
  wasInWindow,
}: ControlInput): ControlDecision {
  const active = rules.filter((rule) => isRuleActive(rule, clock));
  const inWindow = active.length > 0;
  const activeRuleIds = active.map(({ id }) => id);

  let target: ControlTarget | null = null;
  if (inWindow) {
    const bounds = mergeRules(active);
    target = { ...bounds, ...fitSetpoints(bounds, reading) };
  }

  const result = (
    state: ControlState,
    action: ControlAction | null = null,
  ): ControlDecision => ({ inWindow, activeRuleIds, target, action, state });

  if (!isAutoSupported(reading.modeLimit)) {
    return result('unsupported');
  }
  if (paused) {
    return result('paused');
  }
  // Emergency heat (or a mode this doesn't know) is never touched: it's for when the heat pump
  // can't be relied on, which AUTO would use.
  const handSet = reading.mode === Mode.Heat || reading.mode === Mode.Cool;
  if (reading.mode !== Mode.Off && reading.mode !== Mode.Auto && !handSet) {
    return result('manual');
  }

  // Only the moment a window ends: after that, a device left in AUTO is the user's business. So is
  // HEAT or COOL outside a window, until one starts.
  if (!target) {
    if (handSet) {
      return result('manual');
    }
    if (wasInWindow && reading.mode === Mode.Auto) {
      return result('inactive', {
        kind: 'window_end',
        mode: Mode.Off,
        heatSetpointC: reading.heatSetpointC,
        coolSetpointC: reading.coolSetpointC,
      });
    }
    return result('inactive');
  }

  const temperature = reading.indoorTemperatureC;
  const { minTemperatureC: min, maxTemperatureC: max, bufferC } = target;
  const outOfRange =
    (min != null && temperature < min) || (max != null && temperature > max);
  // Back inside the range by the buffer. The thermostat may have gone past its setpoint to get
  // here, which is the point: some never stop on their own.
  const comfortable =
    (min == null || temperature >= min + bufferC) &&
    (max == null || temperature <= max - bufferC);

  const runAuto = (kind: ControlActionKind): ControlAction => ({
    kind,
    mode: Mode.Auto,
    heatSetpointC: target.heatSetpointC,
    coolSetpointC: target.coolSetpointC,
  });

  const turnOff: ControlAction = {
    kind: 'stop',
    mode: Mode.Off,
    heatSetpointC: reading.heatSetpointC,
    coolSetpointC: reading.coolSetpointC,
  };

  if (reading.mode === Mode.Off) {
    return outOfRange ? result('automating', runAuto('start')) : result('idle');
  }

  // HEAT or COOL set by hand inside a window is taken over as if it were OFF. The buffer doesn't
  // apply: it's only there to stop AUTO the service started from flapping. Pause to keep it.
  if (handSet) {
    return outOfRange
      ? result('automating', runAuto('start'))
      : result('idle', turnOff);
  }

  if (comfortable) {
    return result('idle', turnOff);
  }

  const drifted =
    Math.abs(reading.heatSetpointC - target.heatSetpointC) >=
      SETPOINT_TOLERANCE_C ||
    Math.abs(reading.coolSetpointC - target.coolSetpointC) >=
      SETPOINT_TOLERANCE_C;
  return drifted
    ? result('automating', runAuto('reapply'))
    : result('automating');
}

const WEEKDAYS: Record<string, Weekday> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** The weekday and minute of the day at `instant` in `timeZone` (IANA, e.g. "America/Chicago"). */
export function houseClock(instant: Date, timeZone: string): HouseClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: WEEKDAYS[part('weekday')] ?? 0,
    minuteOfDay: Number(part('hour')) * 60 + Number(part('minute')),
  };
}
