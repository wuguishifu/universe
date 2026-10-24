import { useQuery } from '@tanstack/react-query';
import { Fan, Flame, Snowflake, TriangleAlert } from 'lucide-react';

import {
  type Automation,
  type DeviceSnapshot,
  EquipmentStatus,
  equipmentStatusLabels,
  type Settings,
} from '@projects/thermo-automation-contracts';

import { api, expect } from '../lib/api';
import { formatDelta, formatTemperature } from '../lib/temperature';

import { AutomationList, describeRange } from './automation-list';
import { ControlPanel } from './control-panel';
import { PauseControl } from './pause-control';
import { Sparkline } from './sparkline';
import { StateBadge } from './state-badge';

function EquipmentIcon({ status }: { status: number }) {
  if (status === EquipmentStatus.Heat) {
    return <Flame className="h-4 w-4 text-heat" aria-hidden />;
  }
  if (
    status === EquipmentStatus.Cool ||
    status === EquipmentStatus.OvercoolForDehumidifying
  ) {
    return <Snowflake className="h-4 w-4 text-cool" aria-hidden />;
  }
  if (status === EquipmentStatus.Fan) {
    return <Fan className="h-4 w-4 text-muted-foreground" aria-hidden />;
  }
  return null;
}

export function DeviceCard({
  device,
  automations,
  settings,
  lastTickAt,
  now,
}: {
  device: DeviceSnapshot;
  automations: Automation[];
  settings: Settings;
  /** Refetches the history after every tick. */
  lastTickAt: string | null;
  now: number;
}) {
  const unit = settings.displayUnit;
  const { reading, target } = device;

  const history = useQuery({
    queryKey: ['history', settings.locationId, device.id, lastTickAt],
    queryFn: () =>
      expect(
        api.devices.history({
          params: { deviceId: device.id },
          query: { hours: 24 },
        }),
        200,
      ),
    placeholderData: (previous) => previous,
  });

  return (
    <section className="flex flex-col gap-5 rounded-lg border bg-card p-5 text-card-foreground">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{device.name}</h2>
          <p className="text-xs text-muted-foreground">{device.model}</p>
        </div>
        <StateBadge device={device} />
      </header>

      {reading ? (
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <div className="text-6xl font-semibold leading-none tracking-tight tabular-nums">
              {formatTemperature(reading.indoorTemperatureC, unit, {
                withUnit: false,
              })}
              <span className="align-top text-2xl font-medium text-muted-foreground">
                °{unit}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Indoor · {Math.round(reading.indoorHumidity)}% humidity
            </p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Equipment</dt>
            <dd className="flex items-center gap-1.5">
              <EquipmentIcon status={reading.equipmentStatus} />
              {equipmentStatusLabels[reading.equipmentStatus] ??
                `Status ${reading.equipmentStatus}`}
            </dd>
            <dt className="text-muted-foreground">Outdoor</dt>
            <dd className="tabular-nums">
              {formatTemperature(reading.outdoorTemperatureC, unit)} ·{' '}
              {Math.round(reading.outdoorHumidity)}%
            </dd>
          </dl>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {device.readError
            ? "Couldn't read this thermostat."
            : 'Waiting for the first reading…'}
        </p>
      )}

      {reading && (
        <ControlPanel device={device} reading={reading} unit={unit} />
      )}

      {[device.readError, device.actionError].map(
        (error) =>
          error && (
            <p key={error} className="flex gap-2 text-xs text-warning">
              <TriangleAlert
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                aria-hidden
              />
              <span className="break-words">{error}</span>
            </p>
          ),
      )}

      {target && device.state !== 'unsupported' && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Keeping it {describeRange(target, unit)}
          {target.bufferC > 0 && (
            <span className="text-muted-foreground">
              {' '}
              (buffer {formatDelta(target.bufferC, unit)})
            </span>
          )}
        </p>
      )}

      <div className={history.isFetching && history.data ? 'opacity-80' : ''}>
        <Sparkline
          points={history.data ?? []}
          unit={unit}
          timeZone={settings.timezone}
          now={now}
        />
      </div>

      {device.state !== 'unsupported' && (
        <PauseControl device={device} timeZone={settings.timezone} />
      )}

      <AutomationList device={device} automations={automations} unit={unit} />
    </section>
  );
}
