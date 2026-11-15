import { useEffect, useState } from 'react';

import {
  type CaptureStatus,
  type ClipEvent,
  commands,
  onClip,
} from './lib/commands';
import { HomeScreen } from './screens/home-screen';
import { SettingsScreen } from './screens/settings-screen';

type Screen = 'home' | 'settings';

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [status, setStatus] = useState<CaptureStatus>();
  const [error, setError] = useState<string>();
  const [clips, setClips] = useState<ClipEvent[]>([]);

  useEffect(() => {
    const poll = () =>
      commands.getStatus().then(
        (s) => {
          setStatus(s);
          setError(undefined);
        },
        (e: unknown) => setError(String(e)),
      );
    poll();
    const timer = setInterval(poll, 1000);
    const stop = onClip((event) => setClips((c) => [event, ...c].slice(0, 20)));
    return () => {
      clearInterval(timer);
      stop();
    };
  }, []);

  return screen === 'settings' ? (
    <SettingsScreen status={status} onBack={() => setScreen('home')} />
  ) : (
    <HomeScreen
      status={status}
      error={error}
      clips={clips}
      onOpenSettings={() => setScreen('settings')}
    />
  );
}
