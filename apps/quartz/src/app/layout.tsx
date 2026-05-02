import { cn } from '@universe/ui-web';
import type { Metadata } from 'next';
import { ThemeProvider } from 'next-themes';
import { Nunito } from 'next/font/google';
import Script from 'next/script';
import { Toaster } from 'sonner';

import { Navbar } from '../components/navbar/navbar';
import './globals.css';

const nunito = Nunito({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Bo',
  description: 'Created by Bo Bramer',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Need to use `suppressHydrationWarning` to avoid hydration errors with the ThemeProvider
  // https://github.com/pacocoursey/next-themes?tab=readme-ov-file#with-app
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          async
          defer
          src="https://static.cdn.prismic.io/prismic.js?new=true&repo=wuguishifu-portfolio"
        />
      </head>
      <body
        className={cn(
          nunito.className,
          'min-h-screen bg-background antialiased w-full relative flex flex-col',
        )}
        id="portal"
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <Toaster richColors />
          <Navbar />
          <main className="bg-background flex-1 w-full flex flex-col items-center justify-center">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
