import { LucideIcon } from 'lucide-react';

export type NavSubItem = {
  label: string;
  href: string;
};

export type NavItem = {
  id: string;
  icon: LucideIcon;
  label: string;
  href: string;
  children?: NavSubItem[];
};

export type NavGroup = {
  id: string;
  label: string;
  href: string;
  items: NavItem[];
};
