import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';

import './styles.css';

// Follow the system theme, including changes while the page is open (a kiosk at night).
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () =>
  document.documentElement.classList.toggle('dark', darkQuery.matches);
applyTheme();
darkQuery.addEventListener('change', applyTheme);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}
