import { Card, CardContent, cn } from '@libs/web-ui';

/** A label, a value and a line of context. */
export function StatTile({
  label,
  value,
  detail,
  muted = false,
}: {
  label: string;
  value: string;
  detail?: React.ReactNode;
  /** For a tile with nothing in it yet. */
  muted?: boolean;
}) {
  return (
    <Card className="py-4">
      <CardContent className="space-y-1 px-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={cn(
            'text-2xl font-semibold tabular-nums',
            muted && 'text-muted-foreground',
          )}
        >
          {value}
        </p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </CardContent>
    </Card>
  );
}
