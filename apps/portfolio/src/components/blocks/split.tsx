import Image from 'next/image';

import { cn } from '../../lib/utils';

type SplitProps = {
  text: 'left' | 'right';
  sectionTitle?: string;
  sectionImage: string | Readonly<React.ReactNode>;
  shadow?: boolean;
  background?: string;
  animationDelay?: number;
  children: Readonly<React.ReactNode>;
  suppressAnimation?: boolean;
};

export default function Split({
  text,
  sectionTitle,
  sectionImage,
  shadow = false,
  background,
  animationDelay = 0,
  children,
  suppressAnimation = false,
}: SplitProps) {
  return (
    <div
      style={{ animationDelay: `${animationDelay}ms` }}
      className={cn(
        'flex flex-col items-center animate-fade-in w-full fill-mode-both px-8',
        background && `${background} py-8`,
        suppressAnimation && 'animate-none',
      )}
    >
      <div
        className={cn(
          'w-full flex flex-col md:gap-16 max-w-screen-xl',
          text === 'left' ? 'md:flex-row' : 'md:flex-row-reverse',
        )}
      >
        <div className="flex-1 flex flex-col justify-center">
          {sectionTitle && <div className={cn('text-4xl md:text-5xl font-bold')}>{sectionTitle}</div>}
          {children}
        </div>
        <div className="flex-1 flex-col items-center justify-center flex">
          {typeof sectionImage === 'string' ? (
            <Image className={cn('rounded-lg', shadow && 'float')} src={sectionImage} alt={`${sectionTitle} image`} />
          ) : (
            sectionImage
          )}
        </div>
      </div>
    </div>
  );
}
