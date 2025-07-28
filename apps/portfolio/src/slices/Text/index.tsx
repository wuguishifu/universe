import { Content, isFilled } from '@prismicio/client';
import { FC } from 'react';

import { RichText } from '../../components/text/text';
import { cn } from '../../lib/utils';
import { backgroundClass } from '../background';
import { SliceComponentPropsWithContext } from '../context';

export type TextProps = SliceComponentPropsWithContext<Content.TextSlice>;

const Text: FC<TextProps> = ({ slice, context }) => {
  const colorScheme = context.colorScheme;
  const showBackground = slice.primary.background;

  const content = isFilled.richText(slice.primary.content) ? slice.primary.content : null;

  return (
    <section
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      className={cn('flex flex-col items-center w-full px-8', {
        [backgroundClass(colorScheme)]: showBackground,
      })}
    >
      <div className="max-w-screen-lg">{content && <RichText content={content} />}</div>
    </section>
  );
};

export default Text;
