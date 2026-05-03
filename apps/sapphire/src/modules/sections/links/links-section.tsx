import Link from 'next/link';
import { HTMLAttributeAnchorTarget, PropsWithChildren } from 'react';
import { cn } from '@universe/ui-web';
import { Section } from '../../layout/section';

export type LinkItem = {
  href: string;
  label: string;
  target?: HTMLAttributeAnchorTarget;
};

export const quickLinkClassName = 'links-section-quick-link';

export function LinksSection({
  links,
  title,
  children,
}: PropsWithChildren<{
  links: LinkItem[];
  title: string;
}>) {
  return (
    <Section>
      <h3>{title}</h3>
      <div className="text-lg flex flex-col leading-6 mt-4 font-smooch">
        {links.map((link) => (
          <div key={link.href}>
            <Link href={link.href} target={link.target}>
              <span
                className={cn(
                  'cursor-pointer hover:underline transition-colors duration-1000',
                  quickLinkClassName,
                )}
              >
                → {link.label}
              </span>
            </Link>
          </div>
        ))}
      </div>
      {children}
    </Section>
  );
}
