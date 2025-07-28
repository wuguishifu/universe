import { Content, isFilled } from '@prismicio/client';
import Image from 'next/image';
import { FC } from 'react';

import { RichText } from '../../components/text/text';
import { buttonVariants } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { backgroundClass } from '../background';
import { SliceComponentPropsWithContext } from '../context';

export type FooterProps = SliceComponentPropsWithContext<Content.FooterSlice>;

const Footer: FC<FooterProps> = ({ slice, context }) => {
  const colorScheme = context.colorScheme;
  const showBackground = slice.primary.background;
  const image = isFilled.image(slice.primary.image) ? slice.primary.image : null;
  const buttonLink = isFilled.link(slice.primary.button_link) ? slice.primary.button_link : null;

  return (
    <section
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      className={cn(
        'flex flex-col items-center w-full px-8 md:flex-row md:gap-16 max-w-screen-xl',
        slice.primary.swapped ? 'flex-col-reverse md:flex-row-reverse' : 'flex-col md:flex-row',
        { [backgroundClass(colorScheme)]: showBackground },
      )}
    >
      <div className="flex-1 flex flex-col items-center justify-center">
        {image && (
          <Image
            src={image.url}
            alt={image.alt ?? ''}
            width={image.dimensions.width}
            height={image.dimensions.height}
          />
        )}
      </div>
      <div className="flex-1 flex flex-col justify-center">
        <RichText content={slice.primary.content} />
        <div>
          {buttonLink && (
            <a href={buttonLink.url} target="_blank" className={buttonVariants({ variant: 'secondary' })}>
              {buttonLink.text}
            </a>
          )}
        </div>
      </div>
    </section>
  );
};

export default Footer;
