import './globals.css';

import { ClerkProvider } from '@clerk/nextjs';
import { Metadata } from 'next';
import { Jersey_15, Source_Code_Pro } from 'next/font/google';
import localFont from 'next/font/local';
import { cn } from '@universe/ui-web';

import { ConvexClientProvider } from '../modules/convex/components/convex-client-provider';
import { RainCanvas } from '../modules/rain/rain-canvas';
import { ParallaxBackground } from './components/parallax-background';
import { SideColumn } from './components/side-column';

const vga = localFont({
  src: [
    {
      path: '../../public/fonts/perfect_dos_vga_437/Perfect-DOS-VGA-437.ttf',
      weight: '400',
    },
  ],
  variable: '--font-vga',
});

const jersey = Jersey_15({
  subsets: ['latin'],
  variable: '--font-jersey',
  style: 'normal',
  weight: '400',
});

const scp = Source_Code_Pro({
  subsets: ['latin'],
  variable: '--font-scp',
  style: 'normal',
  weight: '400',
});

export const metadata: Metadata = {
  title: 'wuguishifu',
  description: 'i hope you enjoy your stay',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body
          className={cn(
            jersey.variable,
            vga.variable,
            scp.variable,
            'text-white',
          )}
        >
          <ConvexClientProvider>
            <ParallaxBackground />
            <RainCanvas />
            <div className="crt-container" />
            <div className="flex max-w-4xl mx-auto h-full mt-20 gap-2">
              <div className="flex-3 space-y-2">{children}</div>
              <div className="flex-1 space-y-2">
                <SideColumn />
              </div>
            </div>
          </ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
