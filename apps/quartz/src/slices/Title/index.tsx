import { Content, isFilled } from '@prismicio/client';
import { cn } from '@wuguishifu/ui-web';
import Image from 'next/image';
import { FC } from 'react';

import { RichText } from '../../components/text/text';
import { animation } from '../animation';
import { backgroundClass } from '../background';
import { SliceComponentPropsWithContext } from '../context';

export type TitleProps = SliceComponentPropsWithContext<Content.TitleSlice>;

const Title: FC<TitleProps> = ({ slice, context }) => {
  const sliceIndex = context.sliceIds.indexOf(slice.id);

  const title = isFilled.keyText(slice.primary.title) ? slice.primary.title : null;
  const description = isFilled.richText(slice.primary.description) ? slice.primary.description : null;
  const image = isFilled.image(slice.primary.image) ? slice.primary.image : null;

  return (
    <section
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      className={cn('w-full', {
        [backgroundClass(context.colorScheme, { useDarkClass: true })]: slice.primary.background,
        [animation(sliceIndex)]: slice.primary.animate,
      })}
    >
      <div className="flex flex-col items-center w-full px-8 md:flex-row md:gap-16 max-w-7xl mx-auto pb-2">
        <div className="flex-1 flex-col items-center justify-center flex">
          {image && (
            <Image
              src={image.url}
              width={image.dimensions.width}
              height={image.dimensions.height}
              alt={image.alt ?? ''}
            />
          )}
        </div>
        <div className="flex-1 flex flex-col justify-center text-foreground">
          {title && <h2 className="text-3xl font-bold">{title}</h2>}
          <div className="text-lg">{description && <RichText content={description} />}</div>
        </div>
      </div>
    </section>
  );
};

export default Title;
