'use client';

import { SiGithub, SiMaildotru } from '@icons-pack/react-simple-icons';
import { Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Button,
  buttonVariants,
  cn,
  LinkedIn,
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from '@universe/ui-web';

export function NavbarDesktop() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const toggleDarkMode = () => setTheme(theme === 'light' ? 'dark' : 'light');

  return (
    <nav className="w-full flex justify-center px-8 py-2 bg-background items-center select-none">
      <Link href="/">
        <h1 className="m-0">Bo Bramer</h1>
      </Link>
      <div className="flex-1" />
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuLink
              className={cn(
                'text-md px-4 py-2 hover:underline underline-offset-4 opacity-80 font-medium',
                pathname === '/' ? 'underline' : '',
              )}
              href="/"
            >
              Home
            </NavigationMenuLink>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink
              className={cn(
                'text-md px-4 py-2 hover:underline underline-offset-4 opacity-80 font-medium',
                pathname.startsWith('/about') ? 'underline' : '',
              )}
              href="/about"
            >
              About
            </NavigationMenuLink>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink
              className={cn(
                'text-md px-4 py-2 hover:underline underline-offset-4 opacity-80 font-medium',
                pathname.startsWith('/projects') ? 'underline' : '',
              )}
              href="/projects"
            >
              Projects
            </NavigationMenuLink>
          </NavigationMenuItem>
          {/* <NavigationMenuItem>
            <NavigationMenuLink
              className="text-md px-4 py-2 hover:underline underline-offset-4 opacity-80 font-medium"
              href="/resume"
            >
              Resume
            </NavigationMenuLink>
          </NavigationMenuItem> */}
          <NavigationMenuItem>
            <Link
              href="mailto:bramer.bo@gmail.com"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              <SiMaildotru className="opacity-80" title="" size={20} />
            </Link>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <Link
              href="https://github.com/wuguishifu/"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
              target="_blank"
              rel="noopener noreferrer"
            >
              <SiGithub className="opacity-80" title="" size={20} />
            </Link>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <Link
              href="https://linkedin.com/in/bo-bramer"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
              target="_blank"
              rel="noopener noreferrer"
            >
              <LinkedIn />
            </Link>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <Button variant="ghost" size="sm" onClick={toggleDarkMode}>
              <Moon className="opacity-80 block dark:hidden" size={20} />
              <Sun className="opacity-80 hidden dark:block" size={20} />
            </Button>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    </nav>
  );
}
