import { LinkItem, LinksSection } from './links/links-section';

const maintenanceLinks: LinkItem[] = [
  { href: 'https://argocd.wuguishifu.dev', label: 'argocd', target: '_blank' },
  {
    href: 'https://infisical.wuguishifu.dev',
    label: 'infisical',
    target: '_blank',
  },
  {
    href: 'https://pgadmin.wuguishifu.dev',
    label: 'pgadmin',
    target: '_blank',
  },
  {
    href: 'https://backups.wuguishifu.dev',
    label: 'backups',
    target: '_blank',
  },
  { href: 'https://thermo.wuguishifu.dev', label: 'thermo', target: '_blank' },
  { href: 'https://vault.wuguishifu.dev', label: 'vault', target: '_blank' },
] as const;

export function Maintenance() {
  return <LinksSection title="maintenance" links={maintenanceLinks} />;
}
