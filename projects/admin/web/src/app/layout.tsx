import './globals.css';

import type { Metadata } from 'next';
import { Geist } from 'next/font/google';

import { ConvexAuthClientProvider } from '@libs/web-auth';
import { ConvexAuthNextjsServerProvider } from '@libs/web-auth/server';
import { cn } from '@libs/web-ui';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });

export const metadata: Metadata = {
  title: 'Admin',
  description: 'Who can use which app',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en">
        <body className={cn(geist.variable, 'min-h-svh')}>
          <ConvexAuthClientProvider>{children}</ConvexAuthClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
