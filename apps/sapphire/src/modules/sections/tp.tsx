import Image from 'next/image';
import Link from 'next/link';
import { Section } from '../layout/section';

const navLinks = [
  { href: '/', label: 'home', target: '_blank' },
  { href: 'https://github.com/wuguishifu', label: 'github', target: '_blank' },
] as const;

export function Tp() {
  return (
    <Section>
      <h2>/tp</h2>
      <div className="text-lg flex flex-col leading-6 mt-4 font-smooch">
        {navLinks.map((link) => (
          <div key={link.href}>
            <Link href={link.href} target={link.target}>
              <span className="cursor-pointer hover:underline">
                → {link.label}
              </span>
            </Link>
          </div>
        ))}
      </div>
      <Image
        src="/mushrooms/green/17.png"
        width={64}
        height={64}
        alt="green mushrooms"
        unoptimized
        className="absolute -right-4 -bottom-2"
      />
    </Section>
  );
}
