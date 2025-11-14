import { cn } from '@wuguishifu/ui-web';
import { PropsWithChildren } from 'react';

type SectionProps = PropsWithChildren<{
  className?: string;
}>;

export function Section({ children, className }: SectionProps) {
  return <div className={cn('border-[1.5px] border-gray-400/20 rounded-sm py-2 px-4', className)}>{children}</div>;
}
