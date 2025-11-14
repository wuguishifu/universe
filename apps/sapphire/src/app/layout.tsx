import './globals.css';

import { cn } from '@wuguishifu/ui-web';
import { Jersey_15 } from 'next/font/google';

import { ParallaxBackground } from './components/ParallaxBackground';

const jersey = Jersey_15({
  subsets: ['latin'],
  variable: '--font-jersey',
  style: 'normal',
  weight: '400',
});

export const metadata = {
  title: 'son of bo',
  description: 'i hope you enjoy your stay',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={cn(jersey.variable)}>
        <ParallaxBackground />
        <div className="crt-container" />
        {children}
      </body>
    </html>
  );
}
