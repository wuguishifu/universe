import { RefreshCw } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useId, useState } from 'react';

import { Button, Switch } from '@libs/ui-web';

import { LevelMeter, useLevels } from '../../components/level-meter';
import { TrackStateNote } from '../../components/track-list';
import {
  type CaptureStatus,
  commands,
  type InputDevice,
} from '../../lib/commands';
import { selectSettings, useAppDispatch, useAppSelector } from '../../store';
import { setAudioTrack, setMicrophoneDevice } from '../../store/settings';

const WINDOWS_DEFAULT = '';

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <div className="bg-card divide-y rounded-lg border">{children}</div>
    </section>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-4 p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {title}
        </label>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <Switch
        id={id}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={onChange}
      />
    </div>
  );
}

function MicrophonePicker({ status }: { status: CaptureStatus | undefined }) {
  const dispatch = useAppDispatch();
  const { audio } = useAppSelector(selectSettings);
  const levels = useLevels();
  const id = useId();

  const [devices, setDevices] = useState<InputDevice[]>([]);
  const refresh = useCallback(() => {
    commands.listMicrophones().then(setDevices, () => setDevices([]));
  }, []);
  useEffect(refresh, [refresh]);

  const windowsDefault = devices.find((d) => d.isDefault);
  const chosenMissing =
    audio.microphoneDevice !== null &&
    !devices.some((d) => d.id === audio.microphoneDevice);
  // The microphone's track, if it's being recorded right now.
  const micIndex =
    status?.tracks.findIndex((t) => t.kind === 'microphone') ?? -1;

  return (
    <div className="flex flex-col gap-3 p-4">
      <label htmlFor={id} className="text-sm font-medium">
        Microphone
      </label>
      <div className="flex items-center gap-2">
        <select
          id={id}
          className="bg-background focus-visible:ring-ring h-9 min-w-0 flex-1 rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          value={audio.microphoneDevice ?? WINDOWS_DEFAULT}
          onFocus={refresh}
          onChange={(e) => {
            const device = devices.find((d) => d.id === e.target.value);
            dispatch(
              setMicrophoneDevice(
                device ? { id: device.id, name: device.name } : null,
              ),
            );
          }}
        >
          <option value={WINDOWS_DEFAULT}>
            Windows default
            {windowsDefault ? ` (${windowsDefault.name})` : ''}
          </option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          {chosenMissing && audio.microphoneDevice && (
            <option value={audio.microphoneDevice}>
              {audio.microphoneDeviceName ?? 'Chosen microphone'} (not
              connected)
            </option>
          )}
        </select>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Refresh microphones"
          title="Refresh microphones"
          onClick={refresh}
        >
          <RefreshCw aria-hidden />
        </Button>
      </div>
      {micIndex >= 0 ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Level</span>
          <LevelMeter
            peak={levels[micIndex]}
            label="Microphone"
            className="w-40"
          />
          <TrackStateNote state={status?.trackStates[micIndex]} />
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Switch on microphone audio above to record it, and to see its level
          here.
        </p>
      )}
    </div>
  );
}

/** The Audio settings page: which tracks are recorded, and from which microphone. */
export function AudioSettings({
  status,
}: {
  status: CaptureStatus | undefined;
}) {
  const dispatch = useAppDispatch();
  const { audio } = useAppSelector(selectSettings);
  const toggle = (track: 'game' | 'discord' | 'microphone') => (on: boolean) =>
    dispatch(setAudioTrack({ track, on }));

  return (
    <>
      <header>
        <h1 className="text-xl font-semibold">Audio</h1>
      </header>

      <Section
        title="Recording audio"
        description={
          <>
            Each is its own track in a clip, and saved clips start with a mix of
            them. Recording the whole screen records desktop audio (with the
            game and Discord in it) and your microphone instead. Changing these
            starts the replay buffer over.
          </>
        }
      >
        <ToggleRow
          title="Game audio"
          description="The app you're recording."
          checked={audio.game}
          onChange={toggle('game')}
        />
        <ToggleRow
          title="Discord audio"
          description="Voice chat, separate from the game. If Discord isn't open, the track is silent until it is, without recording starting over."
          checked={audio.discord}
          onChange={toggle('discord')}
        />
        <ToggleRow
          title="Microphone audio"
          description="Your microphone, chosen below."
          checked={audio.microphone}
          onChange={toggle('microphone')}
        />
      </Section>

      <Section
        title="Microphone"
        description="Clipper always records the microphone chosen here. If it isn't connected, its track is silent until it is."
      >
        <MicrophonePicker status={status} />
      </Section>
    </>
  );
}
