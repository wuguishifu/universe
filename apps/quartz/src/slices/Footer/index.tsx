import { Content, isFilled } from '@prismicio/client';
import { buttonVariants, cn } from '@universe/ui-web';
import { ExternalLink } from 'lucide-react';
import Image from 'next/image';
import { FC } from 'react';

import { RichText } from '../../components/text/text';
import { animation } from '../animation';
import { backgroundClass } from '../background';
import { SliceComponentPropsWithContext } from '../context';

export type FooterProps = SliceComponentPropsWithContext<Content.FooterSlice>;

const Footer: FC<FooterProps> = ({ slice, context }) => {
  const sliceIndex = context.sliceIds.indexOf(slice.id);
  const image = isFilled.image(slice.primary.image)
    ? slice.primary.image
    : null;
  const buttonLink = isFilled.link(slice.primary.button_link)
    ? slice.primary.button_link
    : null;

  return (
    <section
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      className={cn('w-full', {
        [backgroundClass(context.colorScheme, { useDarkClass: true })]:
          slice.primary.background,
        [animation(sliceIndex)]: slice.primary.animate,
      })}
    >
      <div
        className={cn(
          'flex w-full max-w-7xl mx-auto items-center px-8 md:gap-16 py-2',
          slice.primary.swapped
            ? 'flex-col-reverse md:flex-row-reverse'
            : 'flex-col md:flex-row',
        )}
      >
        <div className="flex-1 flex flex-col items-center justify-center">
          {image && (
            <Image
              src={image.url}
              alt={image.alt ?? ''}
              width={image.dimensions.width}
              height={image.dimensions.height}
              className="py-2"
            />
          )}
        </div>
        <div className="flex-1 flex flex-col justify-center text-lg text-secondary-foreground">
          <RichText content={slice.primary.content} />
          <div className="flex justify-center md:justify-start mt-8 md:mt-4">
            {buttonLink && (
              <a
                href={buttonLink.url}
                target="_blank"
                className={cn(buttonVariants({ variant: 'default' }))}
              >
                <span className="text-lg">{buttonLink.text}</span>
                <ExternalLink className="ml-2 size-4" />
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Footer;
