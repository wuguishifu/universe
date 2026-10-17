import { CircleCheck, TriangleAlert, WifiOff } from 'lucide-react';
import { cn } from '@libs/ui-web';
import type { Health } from '../lib/status';

const toneClasses = {
  good: 'text-good border-good/30 bg-good/10',
  warning: 'text-warning border-warning/30 bg-warning/10',
  critical: 'text-critical border-critical/30 bg-critical/10',
} as const;

export function StatusPill({ health }: { health: Health }) {
  const Icon =
    health.tone === 'good'
      ? CircleCheck
      : health.label === 'Disconnected'
        ? WifiOff
        : TriangleAlert;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        toneClasses[health.tone],
      )}
      role="status"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {health.label}
    </span>
  );
}

export function StatusBanner({ health }: { health: Health }) {
  if (health.tone === 'good' || !health.detail) return null;
  return (
    <div
      className={cn(
        'flex gap-3 rounded-lg border p-4 text-sm',
        toneClasses[health.tone],
      )}
      role="alert"
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{health.label}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-foreground/80">
          {health.detail}
        </p>
      </div>
    </div>
  );
}
