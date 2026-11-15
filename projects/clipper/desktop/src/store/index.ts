import {
  combineReducers,
  configureStore,
  createListenerMiddleware,
} from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import {
  FLUSH,
  PAUSE,
  PERSIST,
  persistReducer,
  persistStore,
  PURGE,
  REGISTER,
  REHYDRATE,
} from 'redux-persist';

import { commands } from '../lib/commands';

import { settingsSlice, type SettingsState } from './settings';
import { tauriStorage } from './tauri-storage';

// `deserialize` isn't in redux-persist's types, but it's read: false keeps what's stored as it is,
// to match `serialize: false`. (This is a variable rather than an inline object so the extra
// field type-checks.)
const persistConfig = {
  key: 'settings',
  version: 1,
  storage: tauriStorage,
  serialize: false,
  deserialize: false,
};

const reducer = combineReducers({
  settings: persistReducer(persistConfig, settingsSlice.reducer),
});

// Declared before the store: the listener below calls it while persistStore() is loading the
// settings, which happens as this module is evaluated.
export function selectSettings(state: RootState): SettingsState {
  return state.settings;
}

/**
 * Sends the settings to the recorder when they change, including when they're first loaded. Not
 * before: until then they're the defaults, which would set the recorder back to them and start
 * its buffer over (twice, once it gets the real ones).
 */
const listener = createListenerMiddleware();
listener.startListening.withTypes<RootState, AppDispatch>()({
  predicate: (_action, current, previous) =>
    current.settings._persist.rehydrated &&
    current.settings !== previous.settings,
  effect: (_action, api) => {
    // Without redux-persist's `_persist`, which isn't a setting.
    const { audio } = selectSettings(api.getState());
    void commands.applySettings({ audio });
  },
});

export const store = configureStore({
  reducer,
  middleware: (getDefault) =>
    getDefault({
      // redux-persist's own actions carry functions.
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }).prepend(listener.middleware),
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
