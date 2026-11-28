'use client';

import { ConvexAuthNextjsProvider } from '@convex-dev/auth/nextjs';
import { ConvexReactClient } from 'convex/react';
import type { ReactNode } from 'react';

let client: ConvexReactClient | undefined;

function convexClient(): ConvexReactClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) {
      throw new Error('Missing NEXT_PUBLIC_CONVEX_URL environment variable');
    }
    client = new ConvexReactClient(url);
  }
  return client;
}

/**
 * Convex with Convex Auth, for the client. Goes inside `ConvexAuthNextjsServerProvider` (from
 * `@libs/web-auth/server`) in the root layout:
 *
 *   <ConvexAuthNextjsServerProvider>
 *     <html><body><ConvexAuthClientProvider>{children}</ConvexAuthClientProvider></body></html>
 *   </ConvexAuthNextjsServerProvider>
 */
export function ConvexAuthClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ConvexAuthNextjsProvider client={convexClient()}>
      {children}
    </ConvexAuthNextjsProvider>
  );
}
