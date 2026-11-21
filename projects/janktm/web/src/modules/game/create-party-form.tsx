'use client';

import { useMutation } from 'convex/react';
import { MinusIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { Button, cn, Input, Label } from '@libs/ui-web';
import { api } from '@platform/convex-contracts';

import { errorMessage, ordinal } from './format';

/** Numbers are kept as strings while editing so a field can be briefly empty. */
type EventDraft = {
  key: number;
  name: string;
  placePoints: string[];
  minimumPoints: string;
};

const DEFAULT_SCORING = { placePoints: ['10', '5', '2'], minimumPoints: '1' };

let nextKey = 0;
function newEvent(copyScoringFrom?: EventDraft): EventDraft {
  return {
    key: nextKey++,
    name: '',
    placePoints: [
      ...(copyScoringFrom?.placePoints ?? DEFAULT_SCORING.placePoints),
    ],
    minimumPoints:
      copyScoringFrom?.minimumPoints ?? DEFAULT_SCORING.minimumPoints,
  };
}

function parsePoints(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function CreatePartyForm() {
  const router = useRouter();
  const createParty = useMutation(api.game.parties.create);
  const [name, setName] = useState('');
  const [events, setEvents] = useState<EventDraft[]>(() => [newEvent()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const updateEvent = (key: number, patch: Partial<EventDraft>) =>
    setEvents((prev) =>
      prev.map((event) => (event.key === key ? { ...event, ...patch } : event)),
    );

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError('Give your party a name.');

    const parsed = [];
    for (const [i, event] of events.entries()) {
      const label = event.name.trim() || `Event ${i + 1}`;
      if (!event.name.trim()) return setError(`${label} needs a name.`);
      const placePoints = event.placePoints.map(parsePoints);
      const minimumPoints = parsePoints(event.minimumPoints);
      if (placePoints.some((p) => p === null) || minimumPoints === null) {
        return setError(`Fill in every point value for "${label}".`);
      }
      parsed.push({
        name: event.name,
        placePoints: placePoints.filter((p) => p !== null),
        minimumPoints,
      });
    }

    setSubmitting(true);
    try {
      const { code } = await createParty({ name, events: parsed });
      router.push(`/game/${code}?created=1`);
    } catch (e) {
      setError(errorMessage(e));
      setSubmitting(false);
    }
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="party-name">Party name</Label>
        <Input
          id="party-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Thanksgiving 2026"
          className="h-11 bg-card text-base"
        />
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-xl font-semibold">Events</h2>
        {events.map((event, i) => (
          <EventEditor
            key={event.key}
            index={i}
            event={event}
            canRemove={events.length > 1}
            onChange={(patch) => updateEvent(event.key, patch)}
            onRemove={() =>
              setEvents((prev) => prev.filter((e) => e.key !== event.key))
            }
          />
        ))}
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full border-dashed"
          onClick={() =>
            setEvents((prev) => [...prev, newEvent(prev[prev.length - 1])])
          }
        >
          <PlusIcon /> Add event
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        className="h-12 w-full text-base"
        disabled={submitting}
      >
        {submitting ? 'Creating…' : 'Create party'}
      </Button>
    </form>
  );
}

function EventEditor({
  index,
  event,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  event: EventDraft;
  canRemove: boolean;
  onChange: (patch: Partial<EventDraft>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const setPlace = (i: number, value: string) =>
    onChange({
      placePoints: event.placePoints.map((p, j) => (j === i ? value : p)),
    });

  return (
    <fieldset className="space-y-4 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-2">
          <Label htmlFor={`${id}-name`}>Event {index + 1}</Label>
          <Input
            id={`${id}-name`}
            value={event.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Mario Kart, Pie eating, Trivia…"
            className="h-10 text-base"
          />
        </div>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label={`Remove event ${index + 1}`}
            onClick={onRemove}
            className="text-muted-foreground"
          >
            <Trash2Icon />
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Points per place</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {event.placePoints.map((points, i) => (
            <PointsInput
              key={i}
              label={ordinal(i + 1)}
              value={points}
              onChange={(value) => setPlace(i, value)}
            />
          ))}
          <PointsInput
            label="Others"
            value={event.minimumPoints}
            onChange={(minimumPoints) => onChange({ minimumPoints })}
            muted
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              onChange({
                placePoints: [...event.placePoints, event.minimumPoints],
              })
            }
          >
            <PlusIcon /> Place
          </Button>
          {event.placePoints.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({ placePoints: event.placePoints.slice(0, -1) })
              }
            >
              <MinusIcon /> Place
            </Button>
          )}
        </div>
      </div>
    </fieldset>
  );
}

function PointsInput({
  label,
  value,
  onChange,
  muted,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  muted?: boolean;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-2.5 py-1.5',
        muted ? 'border-dashed bg-muted/50' : 'bg-background',
      )}
    >
      <label
        htmlFor={id}
        className="shrink-0 text-xs font-semibold text-muted-foreground uppercase"
      >
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 [appearance:textfield] bg-transparent text-right text-base font-semibold tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </div>
  );
}
