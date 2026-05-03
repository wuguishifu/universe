import Image from 'next/image';
import { LinkItem, LinksSection } from './links/links-section';

const navLinks: LinkItem[] = [
  { href: '/', label: 'home' },
  { href: '/the-list', label: 'the list' },
  { href: 'https://github.com/wuguishifu', label: 'github', target: '_blank' },
  {
    href: 'https://linkedin.com/in/bo-bramer',
    label: 'linkedin',
    target: '_blank',
  },
] as const;

export function Tp() {
  return (
    <LinksSection title="tp" links={navLinks}>
      <Image
        src="/mushrooms/green/17.png"
        width={64}
        height={64}
        alt="green mushrooms"
        unoptimized
        className="absolute -right-4 -bottom-1"
      />
    </LinksSection>
  );
}
