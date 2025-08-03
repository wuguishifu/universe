import { Content, isFilled } from '@prismicio/client';
import Image from 'next/image';
import { FC } from 'react';

import {
  CarouselContainer,
  CarouselContent,
  CarouselIndicator,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '../../components/ui/carousel';
import { cn } from '../../lib/utils';
import { backgroundClass } from '../background';
import { SliceComponentPropsWithContext } from '../context';

export type CarouselProps = SliceComponentPropsWithContext<Content.CarouselSlice>;

const Carousel: FC<CarouselProps> = ({ slice, context }) => {
  const colorScheme = context.colorScheme;
  const showBackground = slice.primary.background;

  return (
    <section
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      className={cn('w-full flex justify-center', {
        [backgroundClass(colorScheme)]: showBackground,
      })}
    >
      <div className="flex flex-col items-center w-full max-w-screen-xl py-2">
        <CarouselContainer className="w-[95%] md:w-[75%]" opts={{ loop: true }}>
          <CarouselContent className="rounded-lg">
            {slice.primary.contents.map((item, index) => (
              <CarouselItem key={index}>
                <div className="aspect-video relative w-full">
                  {isFilled.image(item.image) ? (
                    <Image
                      src={item.image.url}
                      alt={item.image.alt ?? ''}
                      fill={true}
                      className="object-contain rounded-lg"
                    />
                  ) : null}
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselNext />
          <CarouselPrevious />
          <CarouselIndicator />
        </CarouselContainer>
      </div>
    </section>
  );
};

export default Carousel;
