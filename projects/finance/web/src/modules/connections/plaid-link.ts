'use client';

// Plaid Link from Plaid's CDN script, the same one the sandbox uses. Plaid requires loading it
// from cdn.plaid.com rather than bundling it.

const SCRIPT_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

export type PlaidLinkError = {
  error_code: string;
  error_message: string;
  display_message: string | null;
};

type PlaidHandler = { open: () => void; destroy: () => void };

type PlaidGlobal = {
  create: (config: {
    token: string;
    onSuccess: (publicToken: string) => void;
    onExit: (error: PlaidLinkError | null) => void;
  }) => PlaidHandler;
};

declare global {
  interface Window {
    Plaid?: PlaidGlobal;
  }
}

let scriptPromise: Promise<PlaidGlobal> | undefined;
let currentHandler: PlaidHandler | undefined;

function loadPlaid(): Promise<PlaidGlobal> {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  scriptPromise ??= new Promise<PlaidGlobal>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.Plaid
        ? resolve(window.Plaid)
        : reject(new Error("Plaid Link didn't load"));
    script.onerror = () => {
      scriptPromise = undefined;
      script.remove();
      reject(new Error("Couldn't load Plaid Link"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Opens Link with a link token from finance-service. Resolves once it's open. */
export async function openPlaidLink(
  token: string,
  handlers: {
    onSuccess: (publicToken: string) => void;
    onExit: (error: PlaidLinkError | null) => void;
  },
): Promise<void> {
  const plaid = await loadPlaid();
  currentHandler?.destroy();
  currentHandler = plaid.create({ token, ...handlers });
  currentHandler.open();
}
