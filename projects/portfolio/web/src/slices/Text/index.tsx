import { Content, isFilled } from '@prismicio/client';
import { FC } from 'react';
import { cn } from '@universe/ui-web';

import { RichText } from '../../components/text/text';
import { animation } from '../animation';
import { backgroundClass } from '../background';
import { SliceComponentPropsWithContext } from '../context';

export type TextProps = SliceComponentPropsWithContext<Content.TextSlice>;

const Text: FC<TextProps> = ({ slice, context }) => {
  const sliceIndex = context.sliceIds.indexOf(slice.id);
  const content = isFilled.richText(slice.primary.content)
    ? slice.primary.content
    : null;

  return (
    <section
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      className={cn('flex flex-col items-center w-full px-8', {
        [backgroundClass(context.colorScheme, { useDarkClass: true })]:
          slice.primary.background,
        [animation(sliceIndex)]: slice.primary.animate,
      })}
    >
      <div className="max-w-5xl text-foreground text-lg py-2 text-left">
        {content && <RichText content={content} />}
      </div>
    </section>
  );
};

export default Text;
