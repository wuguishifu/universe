import { Content, isFilled } from '@prismicio/client';
import Image from 'next/image';
import { FC } from 'react';

import { cn } from '@libs/web-ui';

import {
  Simplify,
  SplitSliceDefaultPrimarySectionsItem,
} from '../../../prismicio-types';
import { RichText } from '../../components/text/text';
import { animation } from '../animation';
import { backgroundClass } from '../background';
import { SliceComponentPropsWithContext } from '../context';

export type SplitProps = SliceComponentPropsWithContext<Content.SplitSlice>;

const Split: FC<SplitProps> = ({ slice, context }) => {
  const sliceIndex = context.sliceIds.indexOf(slice.id);

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
      <div className="flex flex-col items-center w-full px-8 md:flex-row md:gap-16 max-w-7xl mx-auto py-2">
        {slice.primary.sections.map((section, index) => (
          <Section key={index} section={section} />
        ))}
      </div>
    </section>
  );
};

function Section({
  section,
}: {
  section: Simplify<SplitSliceDefaultPrimarySectionsItem>;
}) {
  const image = isFilled.image(section.image) ? section.image : null;
  const content = isFilled.richText(section.content) ? section.content : null;

  // default to image
  if (image) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center">
        <Image
          src={image.url}
          width={image.dimensions.width}
          height={image.dimensions.height}
          alt={image.alt ?? ''}
        />
      </div>
    );
  }

  if (content) {
    return (
      <div className="flex-1 flex flex-col items-start justify-center text-lg text-foreground">
        <RichText content={content} />
      </div>
    );
  }

  return <div className="flex-1" />;
}

export default Split;
