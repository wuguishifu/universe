'use client';

import {
  ArrowDownIcon,
  ArrowUpIcon,
  MinusIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useId, useState } from 'react';

import { Button, cn, Input, Label } from '@libs/web-ui';
import type { Id } from '@platform/convex-contracts';

import {
  describeScoring,
  errorMessage,
  multiplierLabel,
  ordinal,
} from './format';
import type { PartyEvent } from './types';

/** Numbers are kept as strings while editing so a field can be briefly empty. */
export type EventDraft = {
  key: number;
  /** Set for events that already exist; new events get one when saved. */
  id?: Id<'gameEvents'>;
  name: string;
  placePoints: string[];
  minimumPoints: string;
  /** One multiplier per round. */
  roundMultipliers: string[];
  roundMode: RoundMode;
  /** What a round placement earns in 'standings' mode. Kept while in 'perRound' so toggling back is lossless. */
  roundPlacePoints: string[];
  roundMinimumPoints: string;
  resultCount: number;
  /** Results already recorded in each round, to warn before a round is removed. */
  roundResultCounts: number[];
};

export type PartyFormValues = {
  name: string;
  events: {
    _id?: Id<'gameEvents'>;
    name: string;
    placePoints: number[];
    minimumPoints: number;
    roundMultipliers: number[];
    roundMode: RoundMode;
    roundScoring?: { placePoints: number[]; minimumPoints: number };
  }[];
};

export type RoundMode = PartyEvent['roundMode'];

/** Mirrors MAX_ROUNDS in the Convex game validators. */
const MAX_ROUNDS = 20;

const DEFAULT_SCORING = { placePoints: ['10', '5', '2'], minimumPoints: '1' };
const DEFAULT_ROUND_SCORING = {
  placePoints: ['3', '2', '1'],
  minimumPoints: '0',
};

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
    roundMultipliers: ['1'],
    roundMode: 'perRound',
    roundPlacePoints: [
      ...(copyScoringFrom?.roundPlacePoints ??
        DEFAULT_ROUND_SCORING.placePoints),
    ],
    roundMinimumPoints:
      copyScoringFrom?.roundMinimumPoints ??
      DEFAULT_ROUND_SCORING.minimumPoints,
    resultCount: 0,
    roundResultCounts: [0],
  };
}

export function draftFromEvent(event: PartyEvent): EventDraft {
  return {
    key: nextKey++,
    id: event._id,
    name: event.name,
    placePoints: event.placePoints.map(String),
    minimumPoints: String(event.minimumPoints),
    roundMultipliers: event.roundMultipliers.map(String),
    roundMode: event.roundMode,
    roundPlacePoints: (
      event.roundScoring?.placePoints.map(String) ??
      DEFAULT_ROUND_SCORING.placePoints
    ).slice(),
    roundMinimumPoints: event.roundScoring
      ? String(event.roundScoring.minimumPoints)
      : DEFAULT_ROUND_SCORING.minimumPoints,
    resultCount: event.results.length,
    roundResultCounts: event.roundMultipliers.map(
      (_, round) => event.results.filter((r) => r.round === round).length,
    ),
  };
}

function parseNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Points allow one decimal place, like 2.5. */
function parsePoints(value: string): number | null {
  const n = parseNumber(value);
  // Tolerance for float noise: 2.3 * 10 isn't exactly 23.
  return n !== null && Math.abs(n * 10 - Math.round(n * 10)) < 1e-9 ? n : null;
}

function parseMultiplier(value: string): number | null {
  const n = parseNumber(value);
  return n !== null && n > 0 ? n : null;
}

function parseAll<T>(values: string[], parse: (v: string) => T | null) {
  const parsed = values.map(parse);
  return parsed.every((v) => v !== null)
    ? parsed.filter((v) => v !== null)
    : null;
}

/** Shared by creating and editing a party. `onSubmit` throws to show an error. */
export function PartyForm({
  initialName = '',
  initialEvents,
  submitLabel,
  submittingLabel,
  onSubmit,
}: {
  initialName?: string;
  initialEvents?: EventDraft[];
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (values: PartyFormValues) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [events, setEvents] = useState<EventDraft[]>(
    () => initialEvents ?? [newEvent()],
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const updateEvent = (key: number, patch: Partial<EventDraft>) =>
    setEvents((prev) =>
      prev.map((event) => (event.key === key ? { ...event, ...patch } : event)),
    );

  const moveEvent = (index: number, offset: -1 | 1) =>
    setEvents((prev) => {
      const target = index + offset;
      const moving = prev[index];
      const other = prev[target];
      if (!moving || !other) return prev;
      const next = [...prev];
      next[index] = other;
      next[target] = moving;
      return next;
    });

  const removeEvent = (event: EventDraft) => {
    if (
      event.resultCount > 0 &&
      !window.confirm(
        `Remove "${event.name}"? Its ${event.resultCount} recorded ${event.resultCount === 1 ? 'result' : 'results'} will be deleted when you save.`,
      )
    ) {
      return;
    }
    setEvents((prev) => prev.filter((e) => e.key !== event.key));
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError('Give your party a name.');

    const parsed: PartyFormValues['events'] = [];
    for (const [i, event] of events.entries()) {
      const label = event.name.trim() || `Event ${i + 1}`;
      if (!event.name.trim()) return setError(`${label} needs a name.`);
      const placePoints = parseAll(event.placePoints, parsePoints);
      const minimumPoints = parsePoints(event.minimumPoints);
      if (placePoints === null || minimumPoints === null) {
        return setError(
          `Fill in every point value for "${label}" (up to 1 decimal place).`,
        );
      }
      const roundMultipliers = parseAll(
        event.roundMultipliers,
        parseMultiplier,
      );
      if (roundMultipliers === null) {
        return setError(
          `Every round multiplier for "${label}" needs to be above 0.`,
        );
      }
      let roundScoring: PartyFormValues['events'][number]['roundScoring'];
      if (event.roundMode === 'standings') {
        const roundPlacePoints = parseAll(event.roundPlacePoints, parsePoints);
        const roundMinimumPoints = parsePoints(event.roundMinimumPoints);
        if (roundPlacePoints === null || roundMinimumPoints === null) {
          return setError(`Fill in every round point value for "${label}".`);
        }
        roundScoring = {
          placePoints: roundPlacePoints,
          minimumPoints: roundMinimumPoints,
        };
      }
      parsed.push({
        _id: event.id,
        name: event.name,
        placePoints,
        minimumPoints,
        roundMultipliers,
        roundMode: event.roundMode,
        roundScoring,
      });
    }

    setSubmitting(true);
    try {
      await onSubmit({ name, events: parsed });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
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
            count={events.length}
            event={event}
            onChange={(patch) => updateEvent(event.key, patch)}
            onRemove={() => removeEvent(event)}
            onMove={(offset) => moveEvent(i, offset)}
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
        {submitting ? submittingLabel : submitLabel}
      </Button>
    </form>
  );
}

function EventEditor({
  index,
  count,
  event,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  count: number;
  event: EventDraft;
  onChange: (patch: Partial<EventDraft>) => void;
  onRemove: () => void;
  onMove: (offset: -1 | 1) => void;
}) {
  const id = useId();

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
        <div className="flex">
          {count > 1 && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label={`Move event ${index + 1} up`}
                disabled={index === 0}
                onClick={() => onMove(-1)}
                className="text-muted-foreground"
              >
                <ArrowUpIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label={`Move event ${index + 1} down`}
                disabled={index === count - 1}
                onClick={() => onMove(1)}
                className="text-muted-foreground"
              >
                <ArrowDownIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label={`Remove event ${index + 1}`}
                onClick={onRemove}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2Icon />
              </Button>
            </>
          )}
        </div>
      </div>

      <PlacePointsEditor
        title={
          event.roundMode === 'standings'
            ? 'Points for final standings'
            : 'Points per place'
        }
        hint={
          event.resultCount > 0
            ? `${event.resultCount} ${event.resultCount === 1 ? 'result' : 'results'} recorded. Changing points updates everyone's scores.`
            : undefined
        }
        placePoints={event.placePoints}
        minimumPoints={event.minimumPoints}
        onChange={({ placePoints, minimumPoints }) =>
          onChange({ placePoints, minimumPoints })
        }
      />

      <RoundsEditor event={event} onChange={onChange} />
    </fieldset>
  );
}

function PlacePointsEditor({
  title,
  hint,
  placePoints,
  minimumPoints,
  onChange,
}: {
  title: string;
  hint?: string;
  placePoints: string[];
  minimumPoints: string;
  onChange: (scoring: { placePoints: string[]; minimumPoints: string }) => void;
}) {
  const setPoints = (patch: {
    placePoints?: string[];
    minimumPoints?: string;
  }) => onChange({ placePoints, minimumPoints, ...patch });

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {placePoints.map((points, i) => (
          <PointsInput
            key={i}
            label={ordinal(i + 1)}
            value={points}
            onChange={(value) =>
              setPoints({
                placePoints: placePoints.map((p, j) => (j === i ? value : p)),
              })
            }
          />
        ))}
        <PointsInput
          label="Others"
          value={minimumPoints}
          onChange={(value) => setPoints({ minimumPoints: value })}
          muted
        />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            setPoints({ placePoints: [...placePoints, minimumPoints] })
          }
        >
          <PlusIcon /> Place
        </Button>
        {placePoints.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPoints({ placePoints: placePoints.slice(0, -1) })}
          >
            <MinusIcon /> Place
          </Button>
        )}
      </div>
    </div>
  );
}

const ROUND_MODES: { value: RoundMode; label: string; description: string }[] =
  [
    {
      value: 'perRound',
      label: 'Every round counts',
      description: "Each round's points go straight to the party total.",
    },
    {
      value: 'standings',
      label: 'Rounds decide the winner',
      description:
        'Rounds earn round points. The totals rank everyone, and the event pays out on that ranking.',
    },
  ];

function RoundModeToggle({
  value,
  onChange,
}: {
  value: RoundMode;
  onChange: (mode: RoundMode) => void;
}) {
  const selected = ROUND_MODES.find((mode) => mode.value === value);
  return (
    <div className="space-y-1.5">
      <div
        role="radiogroup"
        aria-label="How rounds are scored"
        className="grid grid-cols-2 gap-1 rounded-lg border bg-background p-1"
      >
        {ROUND_MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={mode.value === value}
            onClick={() => onChange(mode.value)}
            className={cn(
              'rounded-md px-2 py-1.5 text-sm font-semibold transition-colors',
              mode.value === value
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {mode.label}
          </button>
        ))}
      </div>
      {selected && (
        <p className="text-xs text-muted-foreground">{selected.description}</p>
      )}
    </div>
  );
}

function RoundsEditor({
  event,
  onChange,
}: {
  event: EventDraft;
  onChange: (patch: Partial<EventDraft>) => void;
}) {
  const count = event.roundMultipliers.length;
  const standings = event.roundMode === 'standings';
  // A lone round with a non-1 multiplier still needs to be visible, or it'd apply silently.
  const showMultipliers = count > 1 || event.roundMultipliers[0] !== '1';
  // The mode only matters with several rounds, but stays visible if it's already been changed.
  const showMode = count > 1 || standings;

  const addRound = () =>
    onChange({
      roundMultipliers: [...event.roundMultipliers, '1'],
      roundResultCounts: [...event.roundResultCounts, 0],
    });

  const removeRound = () => {
    const recorded = event.roundResultCounts[count - 1] ?? 0;
    if (
      recorded > 0 &&
      !window.confirm(
        `Remove round ${count}? Its ${recorded} recorded ${recorded === 1 ? 'result' : 'results'} will be deleted when you save.`,
      )
    ) {
      return;
    }
    onChange({
      roundMultipliers: event.roundMultipliers.slice(0, -1),
      roundResultCounts: event.roundResultCounts.slice(0, -1),
    });
  };

  const setMultiplier = (i: number, value: string) =>
    onChange({
      roundMultipliers: event.roundMultipliers.map((m, j) =>
        j === i ? value : m,
      ),
    });

  // Preview what boosted rounds are worth, once the numbers are valid.
  const placePoints = parseAll(
    standings ? event.roundPlacePoints : event.placePoints,
    parsePoints,
  );
  const minimumPoints = parsePoints(
    standings ? event.roundMinimumPoints : event.minimumPoints,
  );
  const previews =
    placePoints && minimumPoints !== null
      ? event.roundMultipliers.flatMap((value, round) => {
          const multiplier = parseMultiplier(value);
          if (multiplier === null || multiplier === 1) return [];
          return [
            {
              round,
              multiplier,
              scoring: describeScoring(
                { placePoints, minimumPoints },
                multiplier,
              ),
            },
          ];
        })
      : [];

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Rounds</p>
          <p className="text-xs text-muted-foreground">
            Each round is placed separately. Multipliers scale{' '}
            {standings ? 'round points' : 'the points'}.
          </p>
        </div>
        <div className="flex shrink-0 items-center rounded-lg border bg-background">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove a round"
            disabled={count <= 1}
            onClick={removeRound}
          >
            <MinusIcon />
          </Button>
          <span className="w-6 text-center font-semibold tabular-nums">
            {count}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Add a round"
            disabled={count >= MAX_ROUNDS}
            onClick={addRound}
          >
            <PlusIcon />
          </Button>
        </div>
      </div>

      {showMode && (
        <RoundModeToggle
          value={event.roundMode}
          onChange={(roundMode) => onChange({ roundMode })}
        />
      )}

      {standings && (
        <PlacePointsEditor
          title="Round points per place"
          placePoints={event.roundPlacePoints}
          minimumPoints={event.roundMinimumPoints}
          onChange={(scoring) =>
            onChange({
              roundPlacePoints: scoring.placePoints,
              roundMinimumPoints: scoring.minimumPoints,
            })
          }
        />
      )}

      {showMultipliers && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {event.roundMultipliers.map((multiplier, i) => (
            <PointsInput
              key={i}
              label={count > 1 ? `Round ${i + 1} ×` : 'Points ×'}
              value={multiplier}
              onChange={(value) => setMultiplier(i, value)}
              decimal
            />
          ))}
        </div>
      )}

      {previews.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {previews.map(({ round, multiplier, scoring }) => (
            <li key={round}>
              <span className="font-semibold text-foreground">
                {count > 1 ? `Round ${round + 1}` : 'Points'} (
                {multiplierLabel(multiplier)})
              </span>
              : {scoring}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PointsInput({
  label,
  value,
  onChange,
  muted,
  decimal,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  muted?: boolean;
  /** Allow any fraction (multipliers). Otherwise one decimal place, like 2.5. */
  decimal?: boolean;
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
        inputMode="decimal"
        step={decimal ? 'any' : 0.1}
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 [appearance:textfield] bg-transparent text-right text-base font-semibold tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </div>
  );
}
