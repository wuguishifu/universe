import { Content, isFilled } from '@prismicio/client';
import Image from 'next/image';
import { Simplify } from 'node_modules/@prismicio/client/dist/types/value/types';
import { FC } from 'react';

import { SplitSliceDefaultPrimarySectionsItem } from '../../../prismicio-types';
import { RichText } from '../../components/text/text';
import { cn } from '../../lib/utils';
import { backgroundClass } from '../background';
import { SliceComponentPropsWithContext } from '../context';

export type SplitProps = SliceComponentPropsWithContext<Content.SplitSlice>;

const Split: FC<SplitProps> = ({ slice, context }) => {
  const colorScheme = context.colorScheme;
  const showBackground = slice.primary.background;

  return (
    <section
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      className={cn('flex flex-col items-center w-full px-8 md:flex-row md:gap-16 max-w-screen-xl', {
        [backgroundClass(colorScheme)]: showBackground,
      })}
    >
      {slice.primary.sections.map((section, index) => (
        <Section key={index} section={section} />
      ))}
    </section>
  );
};

function Section({ section }: { section: Simplify<SplitSliceDefaultPrimarySectionsItem> }) {
  const image = isFilled.image(section.image) ? section.image : null;
  const content = isFilled.richText(section.content) ? section.content : null;

  // default to image
  if (image) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center">
        <Image src={image.url} width={image.dimensions.width} height={image.dimensions.height} alt={image.alt ?? ''} />
      </div>
    );
  }

  if (content) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center">
        <RichText content={content} />
      </div>
    );
  }

  return <div className="flex-1" />;
}

export default Split;
