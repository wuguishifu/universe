import { House, Settings as SettingsIcon, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Toaster } from 'sonner';

import { Button, Spinner } from '@libs/web-ui';

import { DeviceCard } from './components/device-card';
import { browserTimeZone, SettingsDialog } from './components/settings-dialog';
import { StatusBanner, StatusPill } from './components/status';
import { api, expect } from './lib/api';
import { getHealth } from './lib/status';
import { useApiMutation } from './lib/use-api-mutation';
import { useLiveSnapshot } from './lib/use-live-snapshot';
import { formatAgo, useNow } from './lib/use-now';

export function App() {
  const { snapshot, connection, error } = useLiveSnapshot();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const now = useNow();
  const adoptTimeZone = useApiMutation((timezone: string) =>
    expect(api.settings.update({ body: { timezone } }), 200),
  );

  if (!snapshot) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4 text-sm text-muted-foreground">
        {error ? (
          <p className="flex items-center gap-2 text-critical">
            <TriangleAlert className="h-4 w-4" aria-hidden />
            Couldn't reach the service: {error.message}
          </p>
        ) : (
          <Spinner />
        )}
      </main>
    );
  }

  const { settings, devices, automations, status } = snapshot;
  const health = getHealth(status, connection, now, (since) =>
    formatAgo(since, now),
  );
  const deviceTimeZone = browserTimeZone();

  return (
    <main className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Thermostat
          </p>
          <h1 className="truncate text-2xl font-semibold">
            {settings.locationId ?? 'No house picked'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill health={health} />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            <SettingsIcon className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <StatusBanner health={health} />

      {settings.locationId &&
        settings.timezone === 'UTC' &&
        deviceTimeZone !== 'UTC' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
            <span>Automation windows are being read in UTC.</span>
            <Button
              size="sm"
              variant="outline"
              disabled={adoptTimeZone.isPending}
              onClick={() => adoptTimeZone.mutate(deviceTimeZone)}
            >
              Use {deviceTimeZone}
            </Button>
          </div>
        )}

      {!settings.locationId ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-10 text-center">
          <House className="h-8 w-8 text-muted-foreground" aria-hidden />
          <div>
            <h2 className="font-semibold">Pick the house to automate</h2>
            <p className="text-sm text-muted-foreground">
              Choose which Daikin location this app controls.
            </p>
          </div>
          <Button onClick={() => setSettingsOpen(true)}>Pick a house</Button>
        </div>
      ) : devices.length === 0 ? (
        <div className="flex items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-sm text-muted-foreground">
          <Spinner />
          Reading the thermostats…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {devices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              automations={automations.filter(
                ({ deviceId }) => deviceId === device.id,
              )}
              settings={settings}
              lastTickAt={status.lastTickAt}
              now={now}
            />
          ))}
        </div>
      )}

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
      />
      <Toaster theme="system" richColors position="bottom-center" />
    </main>
  );
}
