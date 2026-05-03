import './globals.css';

import { Jersey_15, Smooch_Sans } from 'next/font/google';
import { cn } from '@universe/ui-web';

import { RainCanvas } from '../modules/rain/rain-canvas';
import { ParallaxBackground } from './components/parallax-background';
import { SideColumn } from './components/side-column';

const jersey = Jersey_15({
  subsets: ['latin'],
  variable: '--font-jersey',
  style: 'normal',
  weight: '400',
});

const smooch = Smooch_Sans({
  subsets: ['latin'],
  variable: '--font-smooch',
  style: 'normal',
  weight: '400',
});

export const metadata = {
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
      <body className={cn(jersey.variable, smooch.variable, 'text-white')}>
        <ParallaxBackground />
        <RainCanvas />
        <div className="crt-container" />
        <div className="flex max-w-4xl mx-auto h-full mt-20 gap-2">
          <div className="flex-3 space-y-2">{children}</div>
          <div className="flex-1 space-y-2">
            <SideColumn />
          </div>
        </div>
      </body>
    </html>
  );
}
