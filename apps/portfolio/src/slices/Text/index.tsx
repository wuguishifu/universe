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
      className={cn('flex flex-col items-center w-full px-8 py-2', {
        [backgroundClass(colorScheme, { useDarkClass: true })]: showBackground,
      })}
    >
      <div className="max-w-screen-lg py-8 text-foreground text-lg">{content && <RichText content={content} />}</div>
    </section>
  );
};

export default Text;
