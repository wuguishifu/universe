import './globals.css';

import { cn } from '@universe/ui-web';
import { Jersey_15, Smooch_Sans } from 'next/font/google';

import { RainCanvas } from '../modules/rain/rain-canvas';
import { ParallaxBackground } from './components/parallax-background';

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
        {children}
      </body>
    </html>
  );
}
