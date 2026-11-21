import './globals.css';

import type { Metadata, Viewport } from 'next';
import { Fraunces, Nunito } from 'next/font/google';

import { cn } from '@libs/ui-web';

import { ConvexClientProvider } from '../modules/convex/components/convex-client-provider';

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
    <html lang="en">
      <body className={cn(display.variable, body.variable, 'min-h-dvh')}>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
