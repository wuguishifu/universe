import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';

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
      <App />
    </StrictMode>,
  );
}
