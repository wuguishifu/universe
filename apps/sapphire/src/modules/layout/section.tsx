import { cn } from '@universe/ui-web';
import { PropsWithChildren } from 'react';

type SectionProps = PropsWithChildren<{
  className?: string;
}>;

export function Section({ children, className }: SectionProps) {
  return (
    <div
      className={cn(
        'section border-[1.5px] border-gray-400/20 rounded-sm py-2 px-4 blur-[0.3px]',
        className,
      )}
    >
      {children}
    </div>
  );
}
