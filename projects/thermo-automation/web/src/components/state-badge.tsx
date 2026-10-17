import {
  Ban,
  CircleCheck,
  Hand,
  Hourglass,
  type LucideIcon,
  Moon,
  Pause,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { cn } from '@libs/ui-web';
import {
  type ControlActionKind,
  type DeviceSnapshot,
  modeLabels,
} from '@projects/thermo-automation-contracts';

const tones = {
  primary: 'bg-primary/10 text-primary',
  good: 'bg-good/10 text-good',
  warning: 'bg-warning/10 text-warning',
  muted: 'bg-muted text-muted-foreground',
} as const;

const actionLabels: Record<
  ControlActionKind,
  { pending: string; failed: string }
> = {
  start: { pending: 'Starting next run', failed: "Couldn't start" },
  stop: { pending: 'Turning off next run', failed: "Couldn't turn off" },
  reapply: {
    pending: 'Resetting setpoints next run',
    failed: "Couldn't reset setpoints",
  },
  window_end: { pending: 'Turning off next run', failed: "Couldn't turn off" },
};

function describe(device: DeviceSnapshot): {
  label: string;
  icon: LucideIcon;
  tone: keyof typeof tones;
  title?: string;
} {
  // `state` is where the device ends up once this happens, so it'd be wrong to show it yet.
  if (device.pendingAction) {
    const labels = actionLabels[device.pendingAction];
    return device.actionError
      ? {
          label: labels.failed,
          icon: TriangleAlert,
          tone: 'warning',
          title: `${device.actionError}\nIt'll be tried again next run.`,
        }
      : { label: labels.pending, icon: Hourglass, tone: 'muted' };
  }

  switch (device.state) {
    case 'automating':
      return { label: 'Automating', icon: Zap, tone: 'primary' };
    case 'idle':
      return { label: 'Idle (in range)', icon: CircleCheck, tone: 'good' };
    case 'manual': {
      const mode = device.reading ? modeLabels[device.reading.mode] : null;
      return {
        label: `Manual${mode ? ` (${mode})` : ''}`,
        icon: Hand,
        tone: 'muted',
        title: 'Set it to Auto or Off to hand control back to the automations.',
      };
    }
    case 'paused':
      return { label: 'Paused', icon: Pause, tone: 'warning' };
    case 'unsupported':
      return {
        label: 'Unsupported',
        icon: Ban,
        tone: 'muted',
        title: "This equipment can't run AUTO, so it's only monitored.",
      };
    case 'inactive':
      return { label: 'No active automation', icon: Moon, tone: 'muted' };
    case null:
      return { label: 'Waiting for a reading', icon: Hourglass, tone: 'muted' };
  }
}

export function StateBadge({ device }: { device: DeviceSnapshot }) {
  const { label, icon: Icon, tone, title } = describe(device);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        tones[tone],
      )}
      title={title}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}
