import './globals.css';

import type { Metadata, Viewport } from 'next';
import { Fraunces, Nunito } from 'next/font/google';

import { ConvexAuthClientProvider } from '@libs/web-auth';
import { ConvexAuthNextjsServerProvider } from '@libs/web-auth/server';
import { cn } from '@libs/web-ui';

const display = Fraunces({ subsets: ['latin'], variable: '--font-display' });
const body = Nunito({ subsets: ['latin'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'Game Night',
  description: 'Score tracking for game night',
};

export const viewport: Viewport = {
  themeColor: '#f7f0e4',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en">
        <body className={cn(display.variable, body.variable, 'min-h-dvh')}>
          <ConvexAuthClientProvider>{children}</ConvexAuthClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
