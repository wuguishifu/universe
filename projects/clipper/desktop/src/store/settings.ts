import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * The user's settings. Persisted (see store/index.ts), and sent to the recorder whenever they
 * change. Mirrored by `Settings` in src-tauri/src/settings.rs, which reads the persisted copy at
 * launch: keep the defaults the same in both.
 */
export type SettingsState = {
  audio: {
    /** A track of the app being recorded. Recording the display records desktop audio instead. */
    game: boolean;
    /** A track of Discord, which waits for Discord to start if it isn't running. */
    discord: boolean;
    microphone: boolean;
    /** The chosen input device's ID, or null for Windows' default. */
    microphoneDevice: string | null;
    /** Its name, to show while it's unplugged (and so isn't listed). */
    microphoneDeviceName: string | null;
  };
};

const initialState: SettingsState = {
  audio: {
    game: true,
    discord: true,
    microphone: false,
    microphoneDevice: null,
    microphoneDeviceName: null,
  },
};

type AudioTrack = 'game' | 'discord' | 'microphone';

export const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setAudioTrack(
      state,
      action: PayloadAction<{ track: AudioTrack; on: boolean }>,
    ) {
      state.audio[action.payload.track] = action.payload.on;
    },
    /** Null for Windows' default. */
    setMicrophoneDevice(
      state,
      action: PayloadAction<{ id: string; name: string } | null>,
    ) {
      state.audio.microphoneDevice = action.payload?.id ?? null;
      state.audio.microphoneDeviceName = action.payload?.name ?? null;
    },
  },
});

export const { setAudioTrack, setMicrophoneDevice } = settingsSlice.actions;
