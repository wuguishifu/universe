import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';

import { App } from './app';
import { persistor, store } from './store';

import './styles.css';

// Follow the system theme, including changes while the app is open.
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () =>
  document.documentElement.classList.toggle('dark', darkQuery.matches);
applyTheme();
darkQuery.addEventListener('change', applyTheme);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Provider store={store}>
        {/* Settings load from disk quickly; nothing's shown until they have. */}
        <PersistGate loading={null} persistor={persistor}>
          <App />
        </PersistGate>
      </Provider>
    </StrictMode>,
  );
}
