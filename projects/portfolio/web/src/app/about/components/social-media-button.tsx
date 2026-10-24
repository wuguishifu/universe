import Link from 'next/link';

import { buttonVariants, cn } from '@libs/ui-web';

export function SocialMediaButton({
  href,
  icon,
}: {
  href: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        buttonVariants({ variant: 'default', size: 'icon' }),
        'rounded-full',
      )}
    >
      <i className={cn(icon, 'text-2xl')} />
    </Link>
  );
}
