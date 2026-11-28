import { Metadata } from 'next';
import { Nunito } from 'next/font/google';
import { ThemeProvider } from 'next-themes';

import { cn, SidebarProvider, TooltipProvider } from '@libs/web-ui';

import { AppSidebar } from '../modules/sidebar/app-sidebar';
import './globals.css';

const nunito = Nunito({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'wuguishifu',
  description: 'Created by Bo Bramer',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          nunito.className,
          'min-h-screen bg-background antialiased w-full relative flex flex-col',
        )}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={0}>
            <SidebarProvider>
              <AppSidebar />
              {children}
            </SidebarProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
