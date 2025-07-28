import { cn } from '../../lib/utils';

type TextProps = {
  children: Readonly<React.ReactNode>;
  background?: string;
  animationDelay?: number;
  suppressAnimation?: boolean;
};

export default function Text({ children, background, animationDelay = 0, suppressAnimation = false }: TextProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center animate-fade-in w-full fill-mode-both px-8',
        background && `${background} py-8`,
        suppressAnimation && 'animate-none',
      )}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className="max-w-screen-lg">{children}</div>
    </div>
  );
}
