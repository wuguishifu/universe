'use client';

import { SiGithub, SiMaildotru } from '@icons-pack/react-simple-icons';
import { Menu, Moon, Sun, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import {
  Button,
  cn,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  LinkedIn,
} from '@universe/ui-web';

export function NavbarMobile() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const toggleDarkMode = () => setTheme(theme === 'light' ? 'dark' : 'light');

  const closeDrawer = () => setOpen(false);

  return (
    <nav className="w-full flex justify-between items-center px-4 py-2 bg-background select-none">
      <Link href="/">
        <h1 className="m-0">Bo Bramer</h1>
      </Link>

      <Drawer open={open} onOpenChange={setOpen} direction="right">
        <DrawerTrigger asChild>
          <Button variant="ghost" size="sm">
            <Menu size={20} />
          </Button>
        </DrawerTrigger>

        <DrawerContent>
          <DrawerHeader className="flex flex-row items-center justify-between">
            <DrawerTitle>Menu</DrawerTitle>
            <DrawerClose asChild>
              <Button variant="ghost" size="sm">
                <X size={20} />
              </Button>
            </DrawerClose>
          </DrawerHeader>

          <div className="flex flex-col p-4 gap-4">
            {/* Navigation Links */}
            <Link
              href="/"
              onClick={closeDrawer}
              className={cn(
                'text-lg px-4 py-3 rounded-md hover:bg-accent transition-colors font-medium',
                pathname === '/' ? 'bg-accent' : '',
              )}
            >
              Home
            </Link>

            <Link
              href="/about"
              onClick={closeDrawer}
              className={cn(
                'text-lg px-4 py-3 rounded-md hover:bg-accent transition-colors font-medium',
                pathname.startsWith('/about') ? 'bg-accent' : '',
              )}
            >
              About
            </Link>

            <Link
              href="/projects"
              onClick={closeDrawer}
              className={cn(
                'text-lg px-4 py-3 rounded-md hover:bg-accent transition-colors font-medium',
                pathname.startsWith('/projects') ? 'bg-accent' : '',
              )}
            >
              Projects
            </Link>

            {/* <Link
              href="/resume"
              onClick={closeDrawer}
              className="text-lg px-4 py-3 rounded-md hover:bg-accent transition-colors font-medium"
            >
              Resume
            </Link> */}

            {/* Divider */}
            <div className="border-t border-border my-4" />

            {/* Social Links and Theme Toggle */}
            <div className="flex flex-col gap-3">
              <Link
                href="mailto:bramer.bo@gmail.com"
                onClick={closeDrawer}
                className="flex items-center gap-3 px-4 py-3 rounded-md hover:bg-accent transition-colors"
              >
                <SiMaildotru className="opacity-80" size={20} />
                <span>Email</span>
              </Link>

              <Link
                href="https://github.com/wuguishifu/"
                onClick={closeDrawer}
                target="_blank"
                className="flex items-center gap-3 px-4 py-3 rounded-md hover:bg-accent transition-colors"
              >
                <SiGithub className="opacity-80" size={20} />
                <span>GitHub</span>
              </Link>

              <Link
                href="https://linkedin.com/in/bo-bramer"
                onClick={closeDrawer}
                target="_blank"
                className="flex items-center gap-3 px-4 py-3 rounded-md hover:bg-accent transition-colors"
              >
                <LinkedIn />
                <span>LinkedIn</span>
              </Link>

              <button
                onClick={() => {
                  toggleDarkMode();
                  closeDrawer();
                }}
                className="flex items-center gap-3 px-4 py-3 rounded-md hover:bg-accent transition-colors text-left"
              >
                <Moon className="opacity-80 block dark:hidden" size={20} />
                <Sun className="opacity-80 hidden dark:block" size={20} />
                <span className="block dark:hidden">Dark Mode</span>
                <span className="hidden dark:block">Light Mode</span>
              </button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </nav>
  );
}
