import './globals.css';

import { Metadata } from 'next';
import { Jersey_15, Source_Code_Pro } from 'next/font/google';
import localFont from 'next/font/local';

import { cn } from '@libs/ui-web';

import { ParallaxBackground } from '../components/bg/parallax-background';
import { RainCanvas } from '../components/bg/rain-canvas';
import { ConvexClientProvider } from '../modules/convex/components/convex-client-provider';

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
          <div className="flex max-w-3xl mx-auto h-full mt-20 gap-2">
            <div className="space-y-2 w-full">{children}</div>
          </div>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
