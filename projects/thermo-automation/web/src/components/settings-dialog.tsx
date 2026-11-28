import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';

import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@libs/web-ui';
import type {
  DisplayUnit,
  Settings,
  UpdateSettings,
} from '@projects/thermo-automation-contracts';

import { api, expect } from '../lib/api';
import { useApiMutation } from '../lib/use-api-mutation';

export const browserTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

export const selectClassName =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
}) {
  const ids = { location: useId(), timezone: useId(), zones: useId() };
  const [locationId, setLocationId] = useState(settings.locationId ?? '');
  const [timezone, setTimezone] = useState(settings.timezone);
  const [displayUnit, setDisplayUnit] = useState(settings.displayUnit);

  // Start from the saved settings each time it opens.
  useEffect(() => {
    if (!open) return;
    setLocationId(settings.locationId ?? '');
    setTimezone(settings.locationId ? settings.timezone : browserTimeZone());
    setDisplayUnit(settings.displayUnit);
  }, [open, settings]);

  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => expect(api.settings.locations(), 200),
    enabled: open,
  });

  const timeZones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const deviceTimeZone = browserTimeZone();

  const save = useApiMutation(
    (body: UpdateSettings) => expect(api.settings.update({ body }), 200),
    { onSuccess: () => onOpenChange(false) },
  );

  const changes: UpdateSettings = {
    ...(locationId && locationId !== settings.locationId ? { locationId } : {}),
    ...(timezone !== settings.timezone ? { timezone } : {}),
    ...(displayUnit !== settings.displayUnit ? { displayUnit } : {}),
  };
  const switchingHouse = !!changes.locationId && !!settings.locationId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            This app runs one house at a time. Switching keeps the other house's
            automations, ready for when you switch back.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(changes);
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={ids.location}>House</Label>
            <select
              id={ids.location}
              className={selectClassName}
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              disabled={!locations.data}
            >
              {!locationId && <option value="">Pick a location…</option>}
              {settings.locationId &&
                !locations.data?.some(
                  ({ id }) => id === settings.locationId,
                ) && (
                  <option value={settings.locationId}>
                    {settings.locationId}
                  </option>
                )}
              {locations.data?.map(({ id, devices }) => (
                <option key={id} value={id}>
                  {id} ({devices.length} thermostat
                  {devices.length === 1 ? '' : 's'})
                </option>
              ))}
            </select>
            {locations.isPending && (
              <p className="text-xs text-muted-foreground">
                Loading locations from Daikin…
              </p>
            )}
            {locations.error && (
              <p className="text-xs text-critical">{locations.error.message}</p>
            )}
            {switchingHouse && (
              <p className="text-xs text-muted-foreground">
                Check the timezone below too, if the new house is somewhere
                else.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.timezone}>House timezone</Label>
            <Input
              id={ids.timezone}
              list={ids.zones}
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <datalist id={ids.zones}>
              {timeZones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Automation windows are read in this timezone.
              {timezone !== deviceTimeZone && (
                <button
                  type="button"
                  className="text-primary underline-offset-4 hover:underline"
                  onClick={() => setTimezone(deviceTimeZone)}
                >
                  Use {deviceTimeZone}
                </button>
              )}
            </div>
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium leading-none">
              Temperatures
            </legend>
            <div className="inline-flex w-fit rounded-md border p-0.5">
              {(['F', 'C'] satisfies DisplayUnit[]).map((unit) => (
                <button
                  key={unit}
                  type="button"
                  aria-pressed={displayUnit === unit}
                  onClick={() => setDisplayUnit(unit)}
                  className={cn(
                    'rounded px-4 py-1.5 text-sm font-medium transition-colors',
                    displayUnit === unit
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  °{unit}
                </button>
              ))}
            </div>
          </fieldset>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={Object.keys(changes).length === 0 || save.isPending}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
