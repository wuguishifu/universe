import {
  Carousel as _Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '../../components/ui/carousel';
import { cn } from '../../lib/utils';

type CarouselProps = {
  slides: Readonly<React.ReactNode>[];
  animationDelay?: number;
  background?: string;
  suppressAnimation?: boolean;
  suppressShadow?: boolean;
};

export default function Carousel({
  slides,
  animationDelay = 0,
  background,
  suppressAnimation = false,
  suppressShadow = false,
}: CarouselProps) {
  return (
    <div
      className={cn(
        'w-full flex justify-center animate-fade-in fill-mode-both px-12',
        background && `${background} py-8`,
        suppressAnimation && 'animate-none',
      )}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className="flex flex-col items-center w-full max-w-screen-lg">
        <_Carousel className={cn('w-[95%] md:w-[75%]', suppressShadow ? '' : 'float')} opts={{ loop: true }}>
          <CarouselContent className="rounded-lg">
            {slides.map((slide, index) => (
              <CarouselItem key={index}>{slide}</CarouselItem>
            ))}
          </CarouselContent>
          <CarouselNext />
          <CarouselPrevious />
        </_Carousel>
      </div>
    </div>
  );
}
