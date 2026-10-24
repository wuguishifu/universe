// Run with `nx test thermo-automation-contracts` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type ControlInput,
  type ControlReading,
  type ControlRule,
  decide,
  fitSetpoints,
  houseClock,
  isRuleActive,
  mergeRules,
  Mode,
  ModeLimit,
} from './control.ts';

const EVERY_DAY = 0b1111111;
const FRIDAY = 1 << 5;

const rule = (overrides: Partial<ControlRule> = {}): ControlRule => ({
  id: 1,
  daysMask: EVERY_DAY,
  startsAt: '08:00',
  endsAt: '20:00',
  minTemperatureC: 20,
  maxTemperatureC: 25,
  bufferC: 1,
  ...overrides,
});

const reading = (overrides: Partial<ControlReading> = {}): ControlReading => ({
  mode: Mode.Off,
  modeLimit: ModeLimit.All,
  heatSetpointC: 18,
  coolSetpointC: 28,
  setpointDeltaC: 2,
  setpointMinimumC: 10,
  setpointMaximumC: 32,
  indoorTemperatureC: 22,
  ...overrides,
});

/** Wednesday at noon, inside the default rule's window. */
const input = (overrides: Partial<ControlInput> = {}): ControlInput => ({
  reading: reading(),
  rules: [rule()],
  clock: { weekday: 3, minuteOfDay: 12 * 60 },
  paused: false,
  wasInWindow: true,
  ...overrides,
});

const at = (weekday: ControlInput['clock']['weekday'], time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return { weekday, minuteOfDay: hours * 60 + minutes };
};

describe('isRuleActive', () => {
  it('includes the start and excludes the end', () => {
    assert.equal(isRuleActive(rule(), at(3, '08:00')), true);
    assert.equal(isRuleActive(rule(), at(3, '19:59')), true);
    assert.equal(isRuleActive(rule(), at(3, '20:00')), false);
  });

  it('treats equal start and end as all day', () => {
    const allDay = rule({ startsAt: '00:00', endsAt: '00:00' });
    assert.equal(isRuleActive(allDay, at(3, '00:00')), true);
    assert.equal(isRuleActive(allDay, at(3, '23:59')), true);
  });

  it('only runs on the days in the mask', () => {
    const fridays = rule({ daysMask: FRIDAY });
    assert.equal(isRuleActive(fridays, at(5, '12:00')), true);
    assert.equal(isRuleActive(fridays, at(4, '12:00')), false);
  });

  it('gives the hours after midnight of an overnight window to the day it started', () => {
    const fridayNights = rule({
      daysMask: FRIDAY,
      startsAt: '22:00',
      endsAt: '06:00',
    });
    assert.equal(isRuleActive(fridayNights, at(5, '23:00')), true);
    assert.equal(isRuleActive(fridayNights, at(6, '05:59')), true);
    assert.equal(isRuleActive(fridayNights, at(6, '06:00')), false);
    assert.equal(isRuleActive(fridayNights, at(5, '05:00')), false);
    assert.equal(isRuleActive(fridayNights, at(6, '23:00')), false);
  });

  it('wraps Saturday night into Sunday morning', () => {
    const saturdayNights = rule({
      daysMask: 1 << 6,
      startsAt: '22:00',
      endsAt: '06:00',
    });
    assert.equal(isRuleActive(saturdayNights, at(0, '03:00')), true);
  });
});

describe('mergeRules', () => {
  it('takes the tightest bounds and the largest buffer, in any order', () => {
    const rules = [
      rule({ minTemperatureC: 19, maxTemperatureC: 24, bufferC: 0.5 }),
      rule({ minTemperatureC: 21, maxTemperatureC: null, bufferC: 1.5 }),
      rule({ minTemperatureC: null, maxTemperatureC: 26, bufferC: 1 }),
    ];
    const expected = { minTemperatureC: 21, maxTemperatureC: 24, bufferC: 1.5 };
    assert.deepEqual(mergeRules(rules), expected);
    assert.deepEqual(mergeRules([...rules].reverse()), expected);
  });

  it('leaves a side unbounded when no rule sets it', () => {
    assert.deepEqual(
      mergeRules([rule({ minTemperatureC: null, maxTemperatureC: 24 })]),
      { minTemperatureC: null, maxTemperatureC: 24, bufferC: 1 },
    );
  });
});

describe('fitSetpoints', () => {
  it("pushes a missing bound to the thermostat's limit", () => {
    assert.deepEqual(
      fitSetpoints(
        { minTemperatureC: null, maxTemperatureC: 24, bufferC: 0 },
        reading(),
      ),
      { heatSetpointC: 10, coolSetpointC: 24, bufferC: 0 },
    );
    assert.deepEqual(
      fitSetpoints(
        { minTemperatureC: 20, maxTemperatureC: null, bufferC: 0 },
        reading(),
      ),
      { heatSetpointC: 20, coolSetpointC: 32, bufferC: 0 },
    );
  });

  it("clamps to the thermostat's limits", () => {
    assert.deepEqual(
      fitSetpoints(
        { minTemperatureC: 5, maxTemperatureC: 40, bufferC: 0 },
        reading(),
      ),
      { heatSetpointC: 10, coolSetpointC: 32, bufferC: 0 },
    );
  });

  it("rounds the bounds to the thermostat's step, toward the inside of the range", () => {
    assert.deepEqual(
      // 62 °F and 68.5 °F.
      fitSetpoints(
        { minTemperatureC: 16.666667, maxTemperatureC: 20.277779, bufferC: 0 },
        reading(),
      ),
      { heatSetpointC: 17, coolSetpointC: 20, bufferC: 0 },
    );
  });

  it('leaves bounds already on a step alone', () => {
    assert.deepEqual(
      fitSetpoints(
        { minTemperatureC: 18.000001, maxTemperatureC: 23.499999, bufferC: 0 },
        reading(),
      ),
      { heatSetpointC: 18, coolSetpointC: 23.5, bufferC: 0 },
    );
  });

  it('aims the setpoints inside the range by the buffer', () => {
    assert.deepEqual(
      fitSetpoints(
        { minTemperatureC: 20, maxTemperatureC: 25, bufferC: 1 },
        reading(),
      ),
      { heatSetpointC: 21, coolSetpointC: 24, bufferC: 1 },
    );
    assert.deepEqual(
      fitSetpoints(
        { minTemperatureC: 20, maxTemperatureC: null, bufferC: 1 },
        reading(),
      ),
      { heatSetpointC: 21, coolSetpointC: 32, bufferC: 1 },
    );
  });

  it("shrinks the buffer to keep the setpoints the thermostat's gap apart", () => {
    // 25 - 20 leaves 3 °C for the buffer on both sides once the 2 °C gap is taken out.
    assert.deepEqual(
      fitSetpoints(
        { minTemperatureC: 20, maxTemperatureC: 25, bufferC: 2 },
        reading(),
      ),
      { heatSetpointC: 21.5, coolSetpointC: 23.5, bufferC: 1.5 },
    );
    assert.deepEqual(
      fitSetpoints(
        { minTemperatureC: 20, maxTemperatureC: 22, bufferC: 1.5 },
        reading(),
      ),
      { heatSetpointC: 20, coolSetpointC: 22, bufferC: 0 },
    );
  });

  it('lowers the heat setpoint when the bounds cross or are too close', () => {
    assert.deepEqual(
      fitSetpoints(
        { minTemperatureC: 24, maxTemperatureC: 23, bufferC: 0 },
        reading(),
      ),
      { heatSetpointC: 21, coolSetpointC: 23, bufferC: 0 },
    );
    assert.deepEqual(
      fitSetpoints(
        { minTemperatureC: 22, maxTemperatureC: 23, bufferC: 0 },
        reading(),
      ),
      { heatSetpointC: 21, coolSetpointC: 23, bufferC: 0 },
    );
  });
});

describe('decide', () => {
  describe('inside a window', () => {
    it('starts AUTO with the target setpoints when an OFF device is out of range', () => {
      const decision = decide(
        input({ reading: reading({ indoorTemperatureC: 19.5 }) }),
      );
      assert.equal(decision.state, 'automating');
      assert.deepEqual(decision.action, {
        kind: 'start',
        mode: Mode.Auto,
        heatSetpointC: 21,
        coolSetpointC: 24,
      });
      assert.deepEqual(decision.activeRuleIds, [1]);
    });

    it('leaves an OFF device alone while it is in range', () => {
      const decision = decide(
        input({ reading: reading({ indoorTemperatureC: 20.5 }) }),
      );
      assert.equal(decision.state, 'idle');
      assert.equal(decision.action, null);
    });

    it('keeps AUTO running until the temperature is past the buffer', () => {
      const decision = decide(
        input({
          reading: reading({
            mode: Mode.Auto,
            heatSetpointC: 21,
            coolSetpointC: 24,
            indoorTemperatureC: 20.5,
          }),
        }),
      );
      assert.equal(decision.state, 'automating');
      assert.equal(decision.action, null);
    });

    it('turns AUTO off once the temperature is inside the range by the buffer', () => {
      const decision = decide(
        input({
          reading: reading({
            mode: Mode.Auto,
            heatSetpointC: 21,
            coolSetpointC: 24,
            indoorTemperatureC: 21,
          }),
        }),
      );
      assert.equal(decision.state, 'idle');
      assert.deepEqual(decision.action, {
        kind: 'stop',
        mode: Mode.Off,
        heatSetpointC: 21,
        coolSetpointC: 24,
      });
    });

    it('turns AUTO off once a thermostat holding its setpoint reports just short of it', () => {
      const holding = (indoorTemperatureC: number) =>
        decide(
          input({
            reading: reading({
              mode: Mode.Auto,
              heatSetpointC: 21,
              coolSetpointC: 24,
              indoorTemperatureC,
            }),
          }),
        ).action?.kind;
      assert.equal(holding(20.8), 'stop');
      assert.equal(holding(24.2), 'stop');
      assert.equal(holding(20.7), undefined);
    });

    it('can turn AUTO off when one window sets the minimum and another the maximum', () => {
      const rules = [
        rule({ id: 1, minTemperatureC: 20, maxTemperatureC: null, bufferC: 1.5 }),
        rule({ id: 2, minTemperatureC: null, maxTemperatureC: 22, bufferC: 1.5 }),
      ];
      const started = decide(
        input({ rules, reading: reading({ indoorTemperatureC: 19 }) }),
      ).action;
      assert.ok(started);
      const decision = decide(
        input({
          rules,
          reading: reading({
            mode: Mode.Auto,
            heatSetpointC: started.heatSetpointC,
            coolSetpointC: started.coolSetpointC,
            indoorTemperatureC: started.heatSetpointC,
          }),
        }),
      );
      assert.equal(decision.action?.kind, 'stop');
    });

    it('takes over a device someone put in AUTO by hand', () => {
      const decision = decide(
        input({
          wasInWindow: false,
          reading: reading({ mode: Mode.Auto, indoorTemperatureC: 26 }),
        }),
      );
      assert.equal(decision.action?.kind, 'reapply');
      assert.equal(decision.action?.coolSetpointC, 24);
    });

    it('re-applies setpoints that drifted while running AUTO', () => {
      const decision = decide(
        input({
          reading: reading({
            mode: Mode.Auto,
            heatSetpointC: 21,
            coolSetpointC: 23,
            indoorTemperatureC: 25.5,
          }),
        }),
      );
      assert.deepEqual(decision.action, {
        kind: 'reapply',
        mode: Mode.Auto,
        heatSetpointC: 21,
        coolSetpointC: 24,
      });
    });

    it('ignores setpoints within the tolerance', () => {
      const decision = decide(
        input({
          reading: reading({
            mode: Mode.Auto,
            heatSetpointC: 21.1,
            coolSetpointC: 23.9,
            indoorTemperatureC: 25.5,
          }),
        }),
      );
      assert.equal(decision.action, null);
    });

    for (const [name, mode] of [
      ['HEAT', Mode.Heat],
      ['COOL', Mode.Cool],
      ['emergency heat', Mode.EmergencyHeat],
    ] as const) {
      it(`never touches a device in ${name}`, () => {
        const decision = decide(
          input({ reading: reading({ mode, indoorTemperatureC: 15 }) }),
        );
        assert.equal(decision.state, 'manual');
        assert.equal(decision.action, null);
      });
    }

    it('never touches a paused device', () => {
      const decision = decide(
        input({ paused: true, reading: reading({ indoorTemperatureC: 15 }) }),
      );
      assert.equal(decision.state, 'paused');
      assert.equal(decision.action, null);
    });

    it("never touches equipment that can't run AUTO", () => {
      for (const modeLimit of [ModeLimit.HeatOnly, ModeLimit.CoolOnly]) {
        const decision = decide(
          input({ reading: reading({ modeLimit, indoorTemperatureC: 15 }) }),
        );
        assert.equal(decision.state, 'unsupported');
        assert.equal(decision.action, null);
      }
    });

    it('uses the merged target of overlapping windows', () => {
      const decision = decide(
        input({
          rules: [
            rule({ id: 1, minTemperatureC: 20, maxTemperatureC: 25 }),
            rule({
              id: 2,
              startsAt: '11:00',
              endsAt: '13:00',
              minTemperatureC: 22,
              maxTemperatureC: null,
              bufferC: 0.5,
            }),
          ],
          reading: reading({ indoorTemperatureC: 21 }),
        }),
      );
      assert.deepEqual(decision.activeRuleIds, [1, 2]);
      assert.equal(decision.action?.kind, 'start');
      // Min 22 (rule 2) and max 25 (rule 1) only leave room for a 0.5 °C buffer.
      assert.equal(decision.action?.heatSetpointC, 22.5);
      assert.equal(decision.target?.bufferC, 0.5);
    });
  });

  describe('when a window ends', () => {
    const afterWindow = { clock: at(3, '20:00'), wasInWindow: true };

    it('turns AUTO off once, keeping the setpoints', () => {
      const decision = decide(
        input({
          ...afterWindow,
          reading: reading({
            mode: Mode.Auto,
            heatSetpointC: 20,
            coolSetpointC: 25,
          }),
        }),
      );
      assert.equal(decision.inWindow, false);
      assert.equal(decision.state, 'inactive');
      assert.deepEqual(decision.action, {
        kind: 'window_end',
        mode: Mode.Off,
        heatSetpointC: 20,
        coolSetpointC: 25,
      });
    });

    it('does nothing to a device that is already off', () => {
      assert.equal(decide(input(afterWindow)).action, null);
    });

    it('does nothing to a device in manual mode', () => {
      const decision = decide(
        input({ ...afterWindow, reading: reading({ mode: Mode.Heat }) }),
      );
      assert.equal(decision.action, null);
    });

    it('does nothing while paused, which uses up the edge', () => {
      const decision = decide(
        input({
          ...afterWindow,
          paused: true,
          reading: reading({ mode: Mode.Auto }),
        }),
      );
      assert.equal(decision.action, null);
      assert.equal(decision.inWindow, false);
    });

    it('fires when the only active automation is disabled mid-window', () => {
      const decision = decide(
        input({ rules: [], reading: reading({ mode: Mode.Auto }) }),
      );
      assert.equal(decision.action?.kind, 'window_end');
    });

    it('sees no edge between adjacent windows', () => {
      const decision = decide(
        input({
          clock: at(3, '12:00'),
          rules: [
            rule({ id: 1, startsAt: '07:00', endsAt: '12:00' }),
            rule({ id: 2, startsAt: '12:00', endsAt: '18:00' }),
          ],
          reading: reading({
            mode: Mode.Auto,
            heatSetpointC: 21,
            coolSetpointC: 24,
            indoorTemperatureC: 20.5,
          }),
        }),
      );
      assert.equal(decision.inWindow, true);
      assert.deepEqual(decision.activeRuleIds, [2]);
      assert.equal(decision.action, null);
    });
  });

  describe('outside every window', () => {
    it('leaves a device someone put in AUTO alone', () => {
      const decision = decide(
        input({
          clock: at(3, '22:00'),
          wasInWindow: false,
          reading: reading({ mode: Mode.Auto, indoorTemperatureC: 30 }),
        }),
      );
      assert.equal(decision.state, 'inactive');
      assert.equal(decision.action, null);
    });
  });
});

describe('houseClock', () => {
  it('reads the weekday and time in the given timezone', () => {
    // Saturday 2026-10-17 02:30 UTC is Friday 21:30 in Chicago (CDT).
    const instant = new Date('2026-10-17T02:30:00Z');
    assert.deepEqual(houseClock(instant, 'America/Chicago'), {
      weekday: 5,
      minuteOfDay: 21 * 60 + 30,
    });
    assert.deepEqual(houseClock(instant, 'UTC'), {
      weekday: 6,
      minuteOfDay: 2 * 60 + 30,
    });
  });

  it('reports midnight as minute 0', () => {
    assert.equal(
      houseClock(new Date('2026-10-17T00:00:00Z'), 'UTC').minuteOfDay,
      0,
    );
  });
});
