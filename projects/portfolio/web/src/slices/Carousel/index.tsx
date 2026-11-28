import { Content, isFilled } from '@prismicio/client';
import Image from 'next/image';
import { FC } from 'react';

import {
  Carousel as CarouselContainer,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  cn,
} from '@libs/web-ui';

import { animation } from '../animation';
import { backgroundClass } from '../background';
import { SliceComponentPropsWithContext } from '../context';

export type CarouselProps =
  SliceComponentPropsWithContext<Content.CarouselSlice>;

const Carousel: FC<CarouselProps> = ({ slice, context }) => {
  const sliceIndex = context.sliceIds.indexOf(slice.id);

  return (
    <section
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      className={cn('w-full flex justify-center', {
        [backgroundClass(context.colorScheme)]: slice.primary.background,
        [animation(sliceIndex)]: slice.primary.animate,
      })}
    >
      <div className="flex flex-col items-center w-full max-w-7xl py-2">
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
                      className="object-contain rounded-lg select-none"
                    />
                  ) : null}
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselNext className="hidden md:flex" />
          <CarouselPrevious className="hidden md:flex" />
        </CarouselContainer>
      </div>
    </section>
  );
};

export default Carousel;
