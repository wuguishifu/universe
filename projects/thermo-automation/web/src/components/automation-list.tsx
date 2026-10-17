import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Switch } from '@libs/ui-web';
import type {
  Automation,
  AutomationInput,
  DeviceSnapshot,
  DisplayUnit,
} from '@projects/thermo-automation-contracts';
import { api, expect } from '../lib/api';
import { describeDays } from '../lib/days';
import { formatBound, formatDelta } from '../lib/temperature';
import { useApiMutation } from '../lib/use-api-mutation';
import { AutomationDialog } from './automation-dialog';

/** "08:00" → "8:00 AM", in the reader's locale. */
const formatClock = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, hours, minutes)));
};

export const describeRange = (
  {
    minTemperatureC: min,
    maxTemperatureC: max,
  }: { minTemperatureC: number | null; maxTemperatureC: number | null },
  unit: DisplayUnit,
) => {
  if (min != null && max != null) {
    return `${formatBound(min, unit, { withUnit: false })}–${formatBound(max, unit)}`;
  }
  if (min != null) return `at least ${formatBound(min, unit)}`;
  if (max != null) return `at most ${formatBound(max, unit)}`;
  return 'no limits';
};

const toInput = ({
  deviceId,
  daysMask,
  startsAt,
  endsAt,
  minTemperatureC,
  maxTemperatureC,
  bufferC,
  enabled,
}: Automation): AutomationInput => ({
  deviceId,
  daysMask,
  startsAt,
  endsAt,
  minTemperatureC,
  maxTemperatureC,
  bufferC,
  enabled,
});

function AutomationRow({
  automation,
  active,
  unit,
  onEdit,
}: {
  automation: Automation;
  active: boolean;
  unit: DisplayUnit;
  onEdit: () => void;
}) {
  const setEnabled = useApiMutation((enabled: boolean) =>
    expect(
      api.automations.update({
        params: { id: automation.id },
        body: { ...toInput(automation), enabled },
      }),
      200,
    ),
  );
  const remove = useApiMutation(() =>
    expect(api.automations.remove({ params: { id: automation.id } }), 204),
  );

  const timeRange =
    automation.startsAt === automation.endsAt
      ? 'All day'
      : `${formatClock(automation.startsAt)} – ${formatClock(automation.endsAt)}`;

  return (
    <li className="flex items-center gap-3 py-2.5">
      <Switch
        checked={automation.enabled}
        onCheckedChange={(enabled) => setEnabled.mutate(enabled)}
        disabled={setEnabled.isPending}
        aria-label={automation.enabled ? 'Disable' : 'Enable'}
      />
      <div
        className={
          automation.enabled
            ? 'min-w-0 flex-1'
            : 'min-w-0 flex-1 text-muted-foreground'
        }
      >
        <div className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
          <span className="tabular-nums">{timeRange}</span>
          {active && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Active now
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {describeDays(automation.daysMask)} ·{' '}
          {describeRange(automation, unit)}
          {automation.bufferC > 0 &&
            ` · buffer ${formatDelta(automation.bufferC, unit)}`}
        </div>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        onClick={onEdit}
        aria-label="Edit"
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 text-muted-foreground hover:text-critical"
        disabled={remove.isPending}
        onClick={() => {
          if (confirmDelete()) remove.mutate(undefined);
        }}
        aria-label="Delete"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

const confirmDelete = () => globalThis.confirm('Delete this automation?');

export function AutomationList({
  device,
  automations,
  unit,
}: {
  device: DeviceSnapshot;
  automations: Automation[];
  unit: DisplayUnit;
}) {
  const [editing, setEditing] = useState<Automation | 'new' | null>(null);

  return (
    <div className="grid grid-cols-1 gap-1">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Automations</h3>
        <Button
          size="sm"
          variant="ghost"
          className="h-8"
          onClick={() => setEditing('new')}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          Add
        </Button>
      </div>
      {automations.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          None yet. Add one to keep this thermostat in a range during a window.
        </p>
      ) : (
        <ul className="divide-y">
          {automations.map((automation) => (
            <AutomationRow
              key={automation.id}
              automation={automation}
              active={device.activeAutomationIds.includes(automation.id)}
              unit={unit}
              onEdit={() => setEditing(automation)}
            />
          ))}
        </ul>
      )}
      <AutomationDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        deviceId={device.id}
        deviceName={device.name}
        automation={editing === 'new' || editing === null ? undefined : editing}
        unit={unit}
      />
    </div>
  );
}
