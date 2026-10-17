import { Pause, Play } from 'lucide-react';
import { useId, useState } from 'react';
import { Button, Input } from '@libs/ui-web';
import type { DeviceSnapshot } from '@projects/thermo-automation-contracts';
import { api, expect } from '../lib/api';
import { formatHouseTime, parsePauseInput } from '../lib/house-time';
import { useApiMutation } from '../lib/use-api-mutation';

/** Leave a thermostat alone for a while: "1h30", "1.5h", "tomorrow at 5pm"… */
export function PauseControl({
  device,
  timeZone,
}: {
  device: DeviceSnapshot;
  timeZone: string;
}) {
  const inputId = useId();
  const [text, setText] = useState('');
  const until = parsePauseInput(text, { now: new Date(), timeZone });

  const pause = useApiMutation(
    (until: Date) =>
      expect(
        api.devices.pause({
          params: { deviceId: device.id },
          body: { until: until.toISOString() },
        }),
        200,
      ),
    { onSuccess: () => setText('') },
  );
  const resume = useApiMutation(() =>
    expect(api.devices.resume({ params: { deviceId: device.id } }), 204),
  );

  if (device.pausedUntil) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-warning/10 px-3 py-2 text-sm">
        <span className="inline-flex items-center gap-2">
          <Pause className="h-4 w-4 text-warning" aria-hidden />
          Automations paused until{' '}
          {formatHouseTime(device.pausedUntil, timeZone)}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => resume.mutate(undefined)}
          disabled={resume.isPending}
        >
          <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Resume now
        </Button>
      </div>
    );
  }

  return (
    <form
      className="grid grid-cols-1 gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (until) pause.mutate(until);
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        Pause automations
      </label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Pause for 1h30, until tomorrow 5pm…"
          autoComplete="off"
          className="h-9"
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={!until || pause.isPending}
        >
          <Pause className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Pause
        </Button>
      </div>
      {text.trim() && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {until
            ? `Until ${formatHouseTime(until, timeZone)}`
            : "Couldn't read that. Try 1h30, 90m or tomorrow at 5pm."}
        </p>
      )}
    </form>
  );
}
