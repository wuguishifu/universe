'use client';

import Image from 'next/image';
import Link from 'next/link';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@libs/ui-web';

import { AppSidebarGroup } from './app-sidebar-group';
import { groups } from './groups';

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="gap-2.5" asChild>
              <Link href="/">
                <Image
                  src="/mushroom.png"
                  alt="wuguishifu"
                  width={32}
                  height={32}
                  priority
                  unoptimized
                  className="size-8 shrink-0 pixelated"
                />
                <div>
                  <span className="text-lg">wuguishifu</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {groups.map((group) => (
          <AppSidebarGroup key={group.id} group={group} />
        ))}
      </SidebarContent>
      <SidebarFooter></SidebarFooter>
    </Sidebar>
  );
}
