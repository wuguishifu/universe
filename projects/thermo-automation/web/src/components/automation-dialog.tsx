import { useEffect, useId, useState } from 'react';
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
  Switch,
} from '@libs/ui-web';
import {
  type Automation,
  type AutomationInput,
  automationInputSchema,
  type DisplayUnit,
} from '@projects/thermo-automation-contracts';
import { api, expect } from '../lib/api';
import {
  DAY_LABELS,
  DAY_PRESETS,
  EVERY_DAY,
  isDaySelected,
  toggleDay,
} from '../lib/days';
import {
  deltaFromDisplay,
  deltaToDisplay,
  fromDisplay,
  roundBound,
  toDisplay,
} from '../lib/temperature';
import { useApiMutation } from '../lib/use-api-mutation';

type Draft = {
  daysMask: number;
  startsAt: string;
  endsAt: string;
  /** Text in the display unit, so a blank field means no limit. */
  min: string;
  max: string;
  buffer: string;
  enabled: boolean;
};

const toDraft = (
  automation: Automation | undefined,
  unit: DisplayUnit,
): Draft => {
  const temperature = (celsius: number | null) =>
    celsius == null ? '' : String(roundBound(toDisplay(celsius, unit)));
  if (!automation) {
    return {
      daysMask: EVERY_DAY,
      startsAt: '08:00',
      endsAt: '22:00',
      min: '',
      max: '',
      buffer: unit === 'F' ? '1' : '0.5',
      enabled: true,
    };
  }
  return {
    daysMask: automation.daysMask,
    startsAt: automation.startsAt,
    endsAt: automation.endsAt,
    min: temperature(automation.minTemperatureC),
    max: temperature(automation.maxTemperatureC),
    buffer: String(
      Math.round(deltaToDisplay(automation.bufferC, unit) * 10) / 10,
    ),
    enabled: automation.enabled,
  };
};

const toInput = (
  draft: Draft,
  deviceId: string,
  unit: DisplayUnit,
): AutomationInput => {
  const temperature = (text: string) =>
    text.trim() === '' ? null : fromDisplay(Number(text), unit);
  return {
    deviceId,
    daysMask: draft.daysMask,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    minTemperatureC: temperature(draft.min),
    maxTemperatureC: temperature(draft.max),
    bufferC: deltaFromDisplay(Number(draft.buffer || 0), unit),
    enabled: draft.enabled,
  };
};

export function AutomationDialog({
  open,
  onOpenChange,
  deviceId,
  deviceName,
  automation,
  unit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceId: string;
  deviceName: string;
  /** Edits this one, or creates a new one when missing. */
  automation?: Automation;
  unit: DisplayUnit;
}) {
  const ids = {
    startsAt: useId(),
    endsAt: useId(),
    min: useId(),
    max: useId(),
    buffer: useId(),
    enabled: useId(),
  };
  const [draft, setDraft] = useState(() => toDraft(automation, unit));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(toDraft(automation, unit));
    setError(null);
  }, [open, automation, unit]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const close = () => onOpenChange(false);
  const save = useApiMutation(
    (body: AutomationInput) =>
      automation
        ? expect(
            api.automations.update({ params: { id: automation.id }, body }),
            200,
          )
        : expect(api.automations.create({ body }), 201),
    { onSuccess: close },
  );

  const submit = () => {
    const parsed = automationInputSchema.safeParse(
      toInput(draft, deviceId, unit),
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the fields');
      return;
    }
    setError(null);
    save.mutate(parsed.data);
  };

  const windowHint =
    draft.startsAt === draft.endsAt
      ? 'Same start and end: runs all day.'
      : draft.startsAt > draft.endsAt
        ? 'Ends the next morning. It runs on the nights that start on the days picked.'
        : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {automation ? 'Edit automation' : 'New automation'}
          </DialogTitle>
          <DialogDescription>
            {deviceName}: when the temperature leaves the range during the
            window, the thermostat runs AUTO until it's back inside by the
            buffer.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium leading-none">
              Days
            </legend>
            <div className="flex gap-1.5">
              {DAY_LABELS.map((label, day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={isDaySelected(draft.daysMask, day)}
                  aria-label={
                    [
                      'Sunday',
                      'Monday',
                      'Tuesday',
                      'Wednesday',
                      'Thursday',
                      'Friday',
                      'Saturday',
                    ][day]
                  }
                  onClick={() =>
                    set('daysMask', toggleDay(draft.daysMask, day))
                  }
                  className={cn(
                    'h-9 w-9 rounded-full text-sm font-medium transition-colors',
                    isDaySelected(draft.daysMask, day)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              {DAY_PRESETS.map(({ label, mask }) => (
                <button
                  key={label}
                  type="button"
                  className={cn(
                    'underline-offset-4 hover:underline',
                    draft.daysMask === mask
                      ? 'font-medium text-foreground'
                      : 'text-primary',
                  )}
                  onClick={() => set('daysMask', mask)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor={ids.startsAt}>From</Label>
                <Input
                  id={ids.startsAt}
                  type="time"
                  value={draft.startsAt}
                  onChange={(event) => set('startsAt', event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={ids.endsAt}>Until</Label>
                <Input
                  id={ids.endsAt}
                  type="time"
                  value={draft.endsAt}
                  onChange={(event) => set('endsAt', event.target.value)}
                  required
                />
              </div>
            </div>
            {windowHint && (
              <p className="text-xs text-muted-foreground">{windowHint}</p>
            )}
          </div>

          <div className="grid gap-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label htmlFor={ids.min}>Min °{unit}</Label>
                <Input
                  id={ids.min}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={draft.min}
                  onChange={(event) => set('min', event.target.value)}
                  placeholder="None"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={ids.max}>Max °{unit}</Label>
                <Input
                  id={ids.max}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={draft.max}
                  onChange={(event) => set('max', event.target.value)}
                  placeholder="None"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={ids.buffer}>Buffer °{unit}</Label>
                <Input
                  id={ids.buffer}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={draft.buffer}
                  onChange={(event) => set('buffer', event.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave a side blank for no limit. The thermostat only takes 0.5 °C
              steps, so its setpoint is rounded toward the middle of the range.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id={ids.enabled}
              checked={draft.enabled}
              onCheckedChange={(checked) => set('enabled', checked)}
            />
            <Label htmlFor={ids.enabled}>Enabled</Label>
          </div>

          {error && (
            <p className="text-sm text-critical" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : automation ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
