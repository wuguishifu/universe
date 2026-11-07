'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@libs/ui-web';

import { NavGroup, NavItem } from './types';

export function AppSidebarGroup({ group }: { group: NavGroup }) {
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel>
        <span className="truncate">{group.label}</span>
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {group.items.map((item) => (
            <AppSidebarItem key={item.id} item={item} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function AppSidebarItem({ item }: { item: NavItem }) {
  const pathname = usePathname();

  if (item.children && item.children.length > 0) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton tooltip={item.label} asChild>
          <Link href={item.href}>
            <item.icon />
            <span>{item.label}</span>
          </Link>
        </SidebarMenuButton>
        <SidebarMenuSub>
          {item.children.map((child) => (
            <SidebarMenuSubItem key={child.label}>
              <SidebarMenuSubButton asChild isActive={pathname === child.href}>
                <Link href={child.href}>{child.label}</Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </SidebarMenuItem>
    );
  }

  if (!item.href) return null;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={item.label}
        isActive={pathname === item.href}
        asChild
      >
        <Link href={item.href}>
          <item.icon />
          {item.label}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
