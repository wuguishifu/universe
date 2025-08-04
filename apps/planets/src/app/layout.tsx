import { Metadata } from 'next';
import { Nunito } from 'next/font/google';
import { Toaster } from 'sonner';

import { cn } from '@wuguishifu/ui-web';

import './global.css';

const nunito = Nunito({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Planets',
  description: 'Generate some planets',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-black">
      <body className={cn(nunito.className, 'min-h-screen bg-black antialiased w-full relative flex flex-col')}>
        <Toaster richColors />
        <main>{children}</main>
      </body>
    </html>
  );
}
