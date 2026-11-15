# thermo-automation-service

Automates the Daikin thermostats at one house. Every 3 minutes it reads each thermostat, records
what it reported and runs the automations against that reading. It also serves the SPA
([thermo-automation-web](../web)) and pushes live updates to it.

## How it works

```plaintext
TickService (every TICK_INTERVAL_MINUTES, never overlapping)
  1. Daikin GET /devices: the selected location's thermostats (auto-picked if there's only one)
  2. Daikin GET /devices/:id for each, once
  3. a row per thermostat in thermo.device_status_records (kept forever, for Redash)
  4. decide() from thermo-automation-contracts, per thermostat ─► Daikin PUT /devices/:id/msp
  5. LiveService publishes a snapshot ─► /api/stream (SSE) ─► the SPA
```

An automation is a window (days, start and end in the house's timezone) with a min and/or max
temperature and a buffer. Per thermostat, on each tick (see `decide` in
[control.ts](../contracts/src/lib/control.ts), and its tests):

- **Emergency heat** is never touched. Equipment that can't run AUTO is only monitored.
- **Paused** thermostats are never touched (readings are still recorded). Pausing is how to keep
  HEAT or COOL set by hand during a window.
- **Inside a window**: out of range while OFF ─► AUTO with its setpoints on the range's bounds (a
  missing bound goes to the thermostat's limit). Once the temperature is the buffer inside the
  range ─► OFF. Setpoints changed while in AUTO are set back. HEAT or COOL set by hand is taken
  over: AUTO if out of range, otherwise OFF. Overlapping windows: the tightest bounds and the
  largest buffer win, with the buffer shrunk if the range is too narrow for it.
- **When a window ends**: AUTO ─► OFF, once. `thermo.device_states.was_in_window` catches the moment
  (adjacent windows have none), so a window ending while the service is down is still handled.
- **Outside every window**: never touched, so a thermostat put in AUTO, HEAT or COOL by hand stays
  that way until a window starts.
- A write that fails shows on the device ("Couldn't start") and is tried again next tick.

The SPA can also set a thermostat's mode and setpoints by hand (`POST /api/devices/:id/control`).
Only the fields that changed are sent. They're merged into a fresh read of the thermostat, checked
against its limits, and written in the same queue as ticks, so the two never overlap. Nothing is
paused: during a window, the next tick takes over whatever mode was set (except emergency heat).

Every write to a thermostat is tracked as `thermo_automation-action` (hand-made ones as
`thermo_automation-manual_change`), and failed ticks as `thermo_automation-tick_failed`. The SPA shows the last tick's status from `/api/status` (also in
every snapshot), which resets on restart.

Settings (location, timezone, °F/°C) are a single row. Automations, records and device states are
tagged with the location, so switching houses leaves the old one's automations for when you switch
back.

## Development

1. `nx setup environment` writes `.env.local` (see [.env.example](.env.example)).
1. Apply the `thermo` migrations to your local DB (`nx migrate:run postgres-utils`).
1. `nx serve thermo-automation-service` (port 3009) and `nx dev thermo-automation-web` (port
   4210, proxies `/api` to the service).

`DAIKIN_BASE_URL` points the client at a stand-in API, and `TICK_INTERVAL_MINUTES=0.1` makes ticks
come every 6 seconds.

Tests: `nx test thermo-automation-contracts` (the decision) and `nx test thermo-automation-web` (the
pause input parser).
