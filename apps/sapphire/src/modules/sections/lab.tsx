import Link from 'next/link';
import { Section } from '../layout/section';

const labLinks = [
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

export function Lab() {
  return (
    <Section>
      <h2>/lab</h2>
      <div className="text-lg flex flex-col leading-6 mt-4 font-smooch">
        {labLinks.map((link) => (
          <div key={link.href}>
            <Link href={link.href} target={link.target}>
              <span className="cursor-pointer hover:underline">
                {link.label}
              </span>
            </Link>
          </div>
        ))}
      </div>
    </Section>
  );
}
